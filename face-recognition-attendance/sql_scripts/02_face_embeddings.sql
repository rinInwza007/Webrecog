cat > sql_scripts/02_face_embeddings.sql << 'EOF'
-- สร้างตาราง student_face_embeddings
CREATE TABLE IF NOT EXISTS student_face_embeddings (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) NOT NULL,
    face_embedding_json TEXT NOT NULL,
    face_quality DECIMAL(3,2) DEFAULT 0.0 CHECK (face_quality >= 0.0 AND face_quality <= 1.0),
    enrollment_type VARCHAR(50) DEFAULT 'standard',
    images_used INTEGER DEFAULT 1,
    system_version VARCHAR(20) DEFAULT '1.0.0',
    motion_optimized BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT fk_student_face_embeddings_student_id 
        FOREIGN KEY (student_id) REFERENCES users(school_id) ON DELETE CASCADE
);

-- สร้าง indexes
CREATE INDEX IF NOT EXISTS idx_student_face_embeddings_student_id 
    ON student_face_embeddings(student_id);

CREATE INDEX IF NOT EXISTS idx_student_face_embeddings_active 
    ON student_face_embeddings(student_id, is_active) 
    WHERE is_active = true;

-- Comment
COMMENT ON TABLE student_face_embeddings IS 'เก็บข้อมูล Face Recognition Embeddings ของนักเรียน';
COMMENT ON COLUMN student_face_embeddings.face_embedding_json IS 'Face embedding vector ในรูปแบบ JSON';
COMMENT ON COLUMN student_face_embeddings.face_quality IS 'คุณภาพของใบหน้าที่ลงทะเบียน (0.0-1.0)';
EOF
