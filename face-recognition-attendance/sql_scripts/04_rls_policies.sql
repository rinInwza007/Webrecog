cat > sql_scripts/04_rls_policies.sql << 'EOF'
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE motion_captures ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own data" ON users
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update their own data" ON users
    FOR UPDATE USING (user_id = auth.uid());

-- Classes policies
CREATE POLICY "Teachers can manage their own classes" ON classes
    FOR ALL USING (teacher_id = auth.uid());

CREATE POLICY "Students can view enrolled classes" ON classes
    FOR SELECT USING (
        class_id IN (
            SELECT class_id FROM student_enrollments 
            WHERE student_id = auth.uid()
        )
    );

-- Student enrollments policies
CREATE POLICY "Students can view their enrollments" ON student_enrollments
    FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Teachers can view class enrollments" ON student_enrollments
    FOR SELECT USING (
        class_id IN (
            SELECT class_id FROM classes WHERE teacher_id = auth.uid()
        )
    );

-- Attendance sessions policies
CREATE POLICY "Teachers can manage their sessions" ON attendance_sessions
    FOR ALL USING (
        class_id IN (
            SELECT class_id FROM classes WHERE teacher_id = auth.uid()
        )
    );

-- Attendance records policies
CREATE POLICY "Students can view their own records" ON attendance_records
    FOR SELECT USING (
        student_email = (
            SELECT email FROM users WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Teachers can view records for their sessions" ON attendance_sessions
    FOR SELECT USING (
        session_id IN (
            SELECT id FROM attendance_sessions 
            WHERE class_id IN (
                SELECT class_id FROM classes WHERE teacher_id = auth.uid()
            )
        )
    );

-- Face embeddings policies
CREATE POLICY "Users can manage their own face data" ON student_face_embeddings
    FOR ALL USING (
        student_id IN (
            SELECT school_id FROM users WHERE user_id = auth.uid()
        )
    );

-- Motion captures policies
CREATE POLICY "Teachers can view their class motion captures" ON motion_captures
    FOR SELECT USING (
        session_id IN (
            SELECT id FROM attendance_sessions 
            WHERE class_id IN (
                SELECT class_id FROM classes WHERE teacher_id = auth.uid()
            )
        )
    );
EOF