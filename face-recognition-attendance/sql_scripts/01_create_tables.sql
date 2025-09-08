echo "Creating SQL scripts..."
cat > sql_scripts/01_create_tables.sql << 'EOF'
-- สร้างตาราง users หากยังไม่มี
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    school_id TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- สร้างตาราง classes
CREATE TABLE IF NOT EXISTS classes (
    class_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_name TEXT NOT NULL,
    description TEXT,
    schedule TEXT,
    teacher_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    teacher_email TEXT NOT NULL,
    class_code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- สร้างตาราง student_enrollments
CREATE TABLE IF NOT EXISTS student_enrollments (
    enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(class_id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'active',
    UNIQUE(student_id, class_id)
);

-- สร้างตาราง attendance_sessions
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID REFERENCES classes(class_id) ON DELETE CASCADE,
    teacher_email TEXT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    on_time_limit_minutes INTEGER DEFAULT 30,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
    session_type TEXT DEFAULT 'standard' CHECK (session_type IN ('standard', 'motion_detection')),
    motion_threshold DECIMAL(3,2) DEFAULT 0.1,
    cooldown_seconds INTEGER DEFAULT 30,
    max_snapshots_per_hour INTEGER DEFAULT 120,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- สร้างตาราง attendance_records
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_email TEXT NOT NULL,
    student_id TEXT NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent')),
    face_match_score DECIMAL(5,3),
    detection_method TEXT DEFAULT 'manual',
    processing_phase TEXT,
    face_quality DECIMAL(3,2) DEFAULT 1.0,
    motion_strength DECIMAL(5,3) DEFAULT 0.0,
    trigger_type TEXT DEFAULT 'manual',
    device_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- สร้าง indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_classes_teacher_id ON classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_classes_code ON classes(class_code);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON student_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_class ON attendance_sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_records_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_records_student ON attendance_records(student_email);
EOF