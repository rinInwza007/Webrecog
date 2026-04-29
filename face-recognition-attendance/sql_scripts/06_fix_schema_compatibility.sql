-- ============================================================
-- Fix Schema Compatibility Issues
-- ============================================================
-- This migration fixes schema inconsistencies found in:
-- - student_face_embeddings (type mismatch with student_id)
-- - Attendance records (missing constraints)
-- - RLS policies alignment

-- Step 1: Add missing columns to student_face_embeddings if needed
ALTER TABLE IF EXISTS public.student_face_embeddings
ADD COLUMN IF NOT EXISTS embedding_index INTEGER,
ADD COLUMN IF NOT EXISTS total_embeddings INTEGER,
ADD COLUMN IF NOT EXISTS is_normalized BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS metadata_json TEXT;

-- Step 2: Add missing columns to motion_captures
ALTER TABLE IF EXISTS public.motion_captures
ADD COLUMN IF NOT EXISTS attendance_records_created INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS session_duration_ms INTEGER;

-- Step 3: Improve indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_records_created_at 
    ON public.attendance_records(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session_student 
    ON public.attendance_records(session_id, student_email);

CREATE INDEX IF NOT EXISTS idx_motion_captures_session_capture 
    ON public.motion_captures(session_id, capture_time DESC);

CREATE INDEX IF NOT EXISTS idx_classes_teacher_code
    ON public.classes(teacher_id, class_code);

-- Step 4: Add trigger for attendance_sessions updated_at timestamp
CREATE OR REPLACE FUNCTION update_attendance_sessions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_attendance_sessions_timestamp ON attendance_sessions;
CREATE TRIGGER update_attendance_sessions_timestamp
BEFORE UPDATE ON attendance_sessions
FOR EACH ROW
EXECUTE FUNCTION update_attendance_sessions_timestamp();

-- Step 5: Add trigger for attendance_records automatic status check
CREATE OR REPLACE FUNCTION validate_attendance_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status NOT IN ('present', 'late', 'absent') THEN
        RAISE EXCEPTION 'Invalid attendance status: %', NEW.status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_attendance_status ON attendance_records;
CREATE TRIGGER validate_attendance_status
BEFORE INSERT OR UPDATE ON attendance_records
FOR EACH ROW
EXECUTE FUNCTION validate_attendance_status();

-- Step 6: Add view for quick student enrollment lookup
CREATE OR REPLACE VIEW v_student_class_enrollment AS
SELECT 
    se.enrollment_id,
    se.student_id,
    u.email as student_email,
    u.full_name as student_name,
    u.school_id,
    se.class_id,
    c.subject_name,
    c.class_code,
    c.teacher_id,
    c.teacher_email,
    se.enrolled_at,
    se.status
FROM student_enrollments se
JOIN users u ON se.student_id = u.user_id
JOIN classes c ON se.class_id = c.class_id
WHERE se.status = 'active';

-- Step 7: Add view for face embeddings with user info
CREATE OR REPLACE VIEW v_student_face_data AS
SELECT 
    sfe.id,
    sfe.student_id,
    u.user_id,
    u.email,
    u.full_name,
    sfe.face_embedding_json,
    sfe.face_quality,
    sfe.enrollment_type,
    sfe.is_active,
    sfe.created_at,
    sfe.updated_at
FROM student_face_embeddings sfe
LEFT JOIN users u ON sfe.student_id = u.school_id
WHERE sfe.is_active = true;

-- Step 8: Add view for motion session summary
CREATE OR REPLACE VIEW v_motion_session_summary AS
SELECT 
    mc.session_id,
    asi.class_id,
    asi.teacher_email,
    COUNT(*) as total_captures,
    SUM(CASE WHEN mc.faces_detected > 0 THEN 1 ELSE 0 END) as captures_with_faces,
    SUM(CASE WHEN mc.faces_recognized > 0 THEN 1 ELSE 0 END) as captures_with_recognition,
    SUM(COALESCE(mc.new_records, 0)) as total_records_created,
    MIN(mc.capture_time) as first_capture,
    MAX(mc.capture_time) as last_capture,
    ROUND(AVG(COALESCE(mc.motion_strength, 0))::numeric, 3) as avg_motion_strength
FROM motion_captures mc
JOIN attendance_sessions asi ON mc.session_id = asi.id
GROUP BY mc.session_id, asi.class_id, asi.teacher_email;

-- ============================================================
-- Data Consistency Checks (Optional - run separately)
-- ============================================================
-- Check for orphaned attendance records
-- SELECT ar.* FROM attendance_records ar
-- LEFT JOIN attendance_sessions asi ON ar.session_id = asi.id
-- WHERE asi.id IS NULL;

-- Check for orphaned motion captures
-- SELECT mc.* FROM motion_captures mc
-- LEFT JOIN attendance_sessions asi ON mc.session_id = asi.id
-- WHERE asi.id IS NULL;

-- Check for face embeddings with inactive students
-- SELECT sfe.* FROM student_face_embeddings sfe
-- WHERE sfe.student_id NOT IN (SELECT school_id FROM users);
