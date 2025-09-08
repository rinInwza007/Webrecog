cat > sql_scripts/03_motion_detection.sql << 'EOF'
-- สร้างตาราง motion_captures
CREATE TABLE IF NOT EXISTS motion_captures (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL,
    capture_time TIMESTAMP WITH TIME ZONE NOT NULL,
    capture_type VARCHAR(50) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    motion_strength DECIMAL(5,3) DEFAULT 0.0,
    processing_phase VARCHAR(20),
    faces_detected INTEGER DEFAULT 0,
    faces_recognized INTEGER DEFAULT 0,
    new_records INTEGER DEFAULT 0,
    processing_time_ms INTEGER DEFAULT 0,
    processing_status VARCHAR(30) DEFAULT 'pending',
    block_reason VARCHAR(100),
    queue_priority INTEGER DEFAULT 5,
    device_id VARCHAR(100),
    force_capture BOOLEAN DEFAULT false,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT fk_motion_captures_session_id 
        FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE
);

-- Index สำหรับ motion_captures
CREATE INDEX IF NOT EXISTS idx_motion_captures_session_id 
    ON motion_captures(session_id);

CREATE INDEX IF NOT EXISTS idx_motion_captures_capture_time 
    ON motion_captures(capture_time);

CREATE INDEX IF NOT EXISTS idx_motion_captures_processing_status 
    ON motion_captures(processing_status);

-- Comment
COMMENT ON TABLE motion_captures IS 'Log การจับภาพด้วย Motion Detection System';
EOF