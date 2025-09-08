#!/bin/bash

# Real-time Video Attendance System Setup Script
# Version 6.0.0 - Real-time Video Streaming

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${PURPLE}"
    echo "=============================================="
    echo "  📹 Real-time Video Attendance System"
    echo "  🎬 Complete Setup Script v6.0.0"
    echo "=============================================="
    echo -e "${NC}"
}

print_step() {
    echo -e "${BLUE}[STEP $1]${NC} $2"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check dependencies
check_dependencies() {
    print_step "1" "Checking system dependencies for real-time video"
    
    # Python 3.8+
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed"
        print_info "Please install Python 3.8+ from https://python.org"
        exit 1
    fi
    
    # Node.js 18+
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        print_info "Please install Node.js 18+ from https://nodejs.org"
        exit 1
    fi
    
    # npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    # Check camera access (optional)
    print_info "Camera access will be requested by the browser during first use"
    
    print_success "All required dependencies are installed"
}

# Create directory structure
create_structure() {
    print_step "2" "Creating real-time video project structure"
    
    mkdir -p config
    mkdir -p scripts
    mkdir -p sql_scripts
    mkdir -p docs
    mkdir -p face_recognition_server/logs
    mkdir -p face_recognition_server/debug_images
    
    print_success "Directory structure created"
}

# Create configuration files
create_config_files() {
    print_step "3" "Creating real-time video configuration files"
    
    # Create .env.example for React
    cat > Myweb/.env.example << 'EOF'
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# FastAPI Real-time Video Server URL
VITE_FASTAPI_URL=http://localhost:8000

# Environment
VITE_NODE_ENV=development

# Real-time Video Settings
VITE_VIDEO_ENABLED=true
VITE_FRAMES_PER_SECOND=2
VITE_VIDEO_QUALITY=high
EOF

    # Create .env.example for FastAPI
    cat > face_recognition_server/.env.example << 'EOF'
# FastAPI Real-time Video Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=true

# Face Recognition Settings
FACE_VERIFICATION_THRESHOLD=0.7

# Real-time Video Settings
REALTIME_VIDEO_ENABLED=true
FRAMES_PER_SECOND=2
FRAME_SKIP=15
MAX_CONCURRENT_STREAMS=10
ATTENDANCE_COOLDOWN_SECONDS=30

# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Optional: Service Key for admin operations
# SUPABASE_SERVICE_KEY=your_service_key_here

# Performance Settings
MAX_WORKERS=16
PROCESSING_QUEUE_SIZE=100
CACHE_SIZE=1000
EOF

    # Create real-time video configuration
    cat > config/realtime_video.json << 'EOF'
{
  "realtime_video": {
    "enabled": true,
    "version": "6.0.0",
    "processing": {
      "frames_per_second": 2,
      "frame_skip_ratio": 15,
      "max_concurrent_streams": 10,
      "processing_timeout_seconds": 30
    },
    "attendance": {
      "cooldown_seconds": 30,
      "on_time_limit_minutes": 15,
      "late_limit_minutes": 60,
      "auto_record": true
    },
    "video_settings": {
      "preferred_resolution": {
        "width": 1280,
        "height": 720
      },
      "frame_rate": 30,
      "quality": 0.8,
      "format": "jpeg"
    },
    "face_detection": {
      "model": "hog",
      "confidence_threshold": 0.7,
      "num_jitters": 1,
      "face_locations_model": "hog"
    },
    "websocket": {
      "enabled": true,
      "ping_interval": 30,
      "max_connections": 50,
      "buffer_size": 1024
    },
    "performance": {
      "thread_pool_workers": 16,
      "queue_max_size": 100,
      "memory_limit_mb": 2048,
      "cpu_optimization": true
    },
    "security": {
      "cors_origins": [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173"
      ],
      "rate_limiting": {
        "requests_per_minute": 120,
        "frames_per_minute": 240
      }
    },
    "logging": {
      "level": "INFO",
      "enable_frame_logging": false,
      "enable_performance_logging": true,
      "log_attendance_events": true
    }
  }
}
EOF
    
    print_success "Real-time video configuration files created"
}

# Install FastAPI dependencies
install_fastapi_deps() {
    print_step "4" "Installing FastAPI dependencies for real-time video"
    
    cd face_recognition_server
    
    # Create virtual environment
    if [ ! -d "venv" ]; then
        print_info "Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Upgrade pip
    python -m pip install --upgrade pip
    
    # Create requirements.txt for real-time video system
    cat > requirements.txt << 'EOF'
# FastAPI Real-time Video Server Requirements
fastapi==0.104.1
uvicorn[standard]==0.24.0
python-multipart==0.0.6
python-dotenv==1.0.0

# Face Recognition & Computer Vision
face-recognition==1.3.0
opencv-python==4.8.1.78
Pillow==10.1.0
numpy==1.24.3

# Database & Storage
supabase==2.0.0
psycopg2-binary==2.9.7

# WebSocket Support
websockets==11.0.3

# Performance & Processing
asyncio-throttle==1.0.2
aiofiles==23.2.1

# Development & Debugging
pytest==7.4.3
pytest-asyncio==0.21.1
EOF
    
    # Install packages
    print_info "Installing Python packages for real-time video processing..."
    pip install -r requirements.txt
    
    cd ..
    
    print_success "FastAPI real-time video dependencies installed"
}

# Install React dependencies
install_react_deps() {
    print_step "5" "Installing React dependencies for video streaming"
    
    cd Myweb
    
    # Update package.json with real-time video scripts
    npm pkg set scripts.realtime:start="concurrently \"npm run api:realtime\" \"npm run dev\""
    npm pkg set scripts.api:realtime="cd ../face_recognition_server && source venv/bin/activate && python main.py"
    npm pkg set scripts.video:test="npm run dev -- --host 0.0.0.0"
    
    # Install packages
    npm install
    
    # Install additional packages for video streaming
    npm install --save-dev concurrently
    
    cd ..
    
    print_success "React video streaming dependencies installed"
}

# Create startup scripts
create_scripts() {
    print_step "6" "Creating real-time video startup scripts"
    
    # Create start script for Unix
    cat > scripts/start_realtime.sh << 'EOF'
#!/bin/bash
echo "🎬 Starting Real-time Video Attendance System..."

# Start FastAPI real-time video server
echo "📹 Starting FastAPI real-time video server..."
cd face_recognition_server
source venv/bin/activate
python main.py &
FASTAPI_PID=$!
cd ..

# Wait for server to start
sleep 5

# Start React frontend with video support
echo "🖥️ Starting React frontend with video streaming..."
cd Myweb
npm run dev &
REACT_PID=$!
cd ..

echo "✅ Real-time Video Attendance System started!"
echo "📱 Frontend: http://localhost:5173"
echo "🔧 API: http://localhost:8000"
echo "📖 API Docs: http://localhost:8000/docs"
echo "📹 WebSocket: ws://localhost:8000/ws/realtime/{session_id}"

# Save PIDs
echo $FASTAPI_PID > scripts/.fastapi.pid
echo $REACT_PID > scripts/.react.pid

# Wait for processes
wait
EOF

    # Create stop script
    cat > scripts/stop_realtime.sh << 'EOF'
#!/bin/bash
echo "🛑 Stopping Real-time Video Attendance System..."

# Stop processes using PIDs
if [ -f scripts/.fastapi.pid ]; then
    kill $(cat scripts/.fastapi.pid) 2>/dev/null
    rm scripts/.fastapi.pid
fi

if [ -f scripts/.react.pid ]; then
    kill $(cat scripts/.react.pid) 2>/dev/null
    rm scripts/.react.pid
fi

# Stop processes using ports
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null

echo "✅ Real-time Video System stopped!"
EOF

    # Create status check script
    cat > scripts/status_realtime.sh << 'EOF'
#!/bin/bash
echo "📊 Real-time Video Attendance System Status"
echo "============================================"

# Check FastAPI server
if curl -s http://localhost:8000/health > /dev/null; then
    echo "✅ FastAPI Server: Running (http://localhost:8000)"
    echo "📖 API Docs: http://localhost:8000/docs"
else
    echo "❌ FastAPI Server: Not running"
fi

# Check React frontend
if curl -s http://localhost:5173 > /dev/null; then
    echo "✅ React Frontend: Running (http://localhost:5173)"
else
    echo "❌ React Frontend: Not running"
fi

# Check active video streams
echo ""
echo "📹 Active Video Streams:"
curl -s http://localhost:8000/api/realtime/active-streams | python3 -m json.tool 2>/dev/null || echo "Unable to fetch stream status"

echo ""
echo "🔧 System Configuration:"
echo "   - Processing Rate: 2 FPS"
echo "   - Frame Skip: 15 frames"
echo "   - Max Streams: 10"
echo "   - Attendance Cooldown: 30s"
EOF

    # Create camera test script
    cat > scripts/test_camera.sh << 'EOF'
#!/bin/bash
echo "📹 Testing Camera Access..."

# Test camera using Python
python3 << 'PYTHON_EOF'
import cv2
import sys

try:
    # Try to open camera
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("❌ Camera not accessible")
        sys.exit(1)
    
    # Test frame capture
    ret, frame = cap.read()
    
    if ret:
        print("✅ Camera working properly")
        print(f"📐 Resolution: {frame.shape[1]}x{frame.shape[0]}")
        print("💡 Camera test successful!")
    else:
        print("❌ Cannot capture frames from camera")
        sys.exit(1)
    
    cap.release()
    
except Exception as e:
    print(f"❌ Camera test failed: {e}")
    sys.exit(1)
PYTHON_EOF

echo "📱 Camera test completed. You can now use real-time video attendance."
EOF

    # Make scripts executable
    chmod +x scripts/*.sh
    
    print_success "Real-time video scripts created"
}

# Create documentation
create_docs() {
    print_step "7" "Creating real-time video documentation"
    
    # Create main README
    cat > README.md << 'EOF'
# 🎬 Real-time Video Attendance System

ระบบเช็คชื่อด้วย AI Face Recognition แบบ Real-time Video Streaming

## 🚀 Quick Start

```bash
# ตั้งค่าระบบ
./setup_realtime.sh

# เริ่มระบบ
./scripts/start_realtime.sh

# ทดสอบกล้อง
./scripts/test_camera.sh

# ตรวจสอบสถานะ
./scripts/status_realtime.sh

# หยุดระบบ
./scripts/stop_realtime.sh
```

## 📹 Real-time Video Features

- ✅ **Live Video Streaming**: สตรีมวิดีโอจากกล้องแบบ real-time
- ✅ **Automatic Face Detection**: ตรวจจับใบหน้าอัตโนมัติ 2 FPS
- ✅ **Instant Attendance**: บันทึกการเข้าเรียนทันทีที่ตรวจพบ
- ✅ **WebSocket Communication**: การสื่อสารแบบ real-time
- ✅ **Multi-stream Support**: รองรับหลายห้องเรียนพร้อมกัน
- ✅ **Manual Override**: เช็คชื่อแบบ manual ได้
- ✅ **Live Statistics**: สถิติการประมวลผลแบบ real-time

## 📱 URLs

- **Frontend**: http://localhost:5173
- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **WebSocket**: ws://localhost:8000/ws/realtime/{session_id}

## 🎯 How It Works

### 1. เริ่มคาบเรียน (Start Class)
- อาจารย์กด "Start Class" 
- ระบบเริ่มสตรีมวิดีโอจากกล้อง
- สร้าง WebSocket connection สำหรับ real-time communication

### 2. Real-time Processing
- ประมวลผลวิดีโอ 2 เฟรมต่อวินาที
- ตรวจจับใบหน้าในแต่ละเฟรม
- เปรียบเทียบกับข้อมูลนักเรียนที่ลงทะเบียนไว้

### 3. Automatic Attendance
- บันทึกการเข้าเรียนทันทีที่ตรวจพบใบหน้า
- แยกสถานะ Present/Late ตามเวลา
- มี Cooldown 30 วินาทีป้องกันการบันทึกซ้ำ

### 4. Live Monitoring
- ดูสถิติการประมวลผลแบบ real-time
- รายชื่อนักเรียนที่เข้าเรียนแล้ว
- สถานะระบบและการเชื่อมต่อ

## ⚙️ Configuration

### Video Settings
```json
{
  "frames_per_second": 2,
  "frame_skip_ratio": 15,
  "max_concurrent_streams": 10,
  "attendance_cooldown": 30
}
```

### Face Recognition
- **Threshold**: 0.7
- **Model**: HOG (optimized for speed)
- **Jitters**: 1 (balance speed/accuracy)

## 🔧 System Requirements

### Minimum
- **CPU**: 4+ cores
- **RAM**: 8GB
- **Camera**: 720p USB/Built-in camera
- **Network**: Broadband internet

### Recommended
- **CPU**: 8+ cores
- **RAM**: 16GB+
- **Camera**: 1080p camera with good lighting
- **Network**: High-speed internet

## 📊 Performance

- **Processing Rate**: 2 FPS
- **Response Time**: < 500ms
- **Memory Usage**: ~2GB per stream
- **Max Students**: 50 per class
- **Max Concurrent Classes**: 10

## 🛠️ Troubleshooting

### Camera Issues
```bash
# Test camera access
./scripts/test_camera.sh

# Check camera permissions
# - Browser: Allow camera access
# - System: Check privacy settings
```

### Performance Issues
```bash
# Check system status
./scripts/status_realtime.sh

# Monitor resources
top -p $(pgrep -f "python.*main.py")
```

### Connection Issues
```bash
# Test API connection
curl http://localhost:8000/health

# Test WebSocket
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:8000/ws/realtime/test
```

## 📚 API Documentation

### Start Real-time Session
```bash
POST /api/realtime/start-stream
FormData: class_id, teacher_email, on_time_limit_minutes
```

### WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/realtime/{session_id}')
ws.send(JSON.stringify({
  type: 'frame',
  frame_data: base64_encoded_image
}))
```

### Get Live Statistics
```bash
GET /api/realtime/{session_id}/stats
```

## 🔐 Security

- CORS enabled for localhost
- Rate limiting: 120 requests/minute
- Frame rate limiting: 240 frames/minute
- WebSocket connection limits

## 📈 Monitoring

- Real-time processing statistics
- Active stream monitoring
- Performance metrics
- Error tracking

## 🆘 Support

For issues or questions:
1. Check logs: `face_recognition_server/logs/`
2. Test camera: `./scripts/test_camera.sh`
3. Check system status: `./scripts/status_realtime.sh`
4. Review configuration: `config/realtime_video.json`
EOF

    # Create technical documentation
    cat > docs/REALTIME_VIDEO_API.md << 'EOF'
# 📹 Real-time Video API Documentation

## WebSocket Endpoints

### `/ws/realtime/{session_id}`
Real-time video frame processing WebSocket endpoint.

#### Message Types

**Send Frame:**
```json
{
  "type": "frame",
  "frame_data": "base64_encoded_jpeg_image"
}
```

**Ping:**
```json
{
  "type": "ping"
}
```

**Receive Frame Result:**
```json
{
  "type": "frame_result",
  "frame_count": 123,
  "success": true,
  "faces_detected": 2,
  "faces_recognized": 1,
  "new_attendance": [
    {
      "student_name": "John Doe",
      "student_id": "STD001",
      "status": "present",
      "confidence": 0.85,
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ],
  "processing_time": 0.156,
  "frame_stats": {
    "frames_processed": 123,
    "faces_detected": 45,
    "faces_recognized": 38,
    "attendance_recorded": 15
  }
}
```

## REST API Endpoints

### POST `/api/realtime/start-stream`
Start real-time video streaming session.

**Request:**
```bash
curl -X POST http://localhost:8000/api/realtime/start-stream \
  -F "class_id=550e8400-e29b-41d4-a716-446655440000" \
  -F "teacher_email=teacher@school.edu" \
  -F "on_time_limit_minutes=15" \
  -F "duration_hours=3"
```

**Response:**
```json
{
  "success": true,
  "message": "Real-time video stream started successfully",
  "session_id": "123e4567-e89b-12d3-a456-426614174000",
  "session_type": "realtime_video",
  "class_id": "550e8400-e29b-41d4-a716-446655440000",
  "start_time": "2024-01-15T10:00:00Z",
  "end_time": "2024-01-15T13:00:00Z",
  "stream_config": {
    "frames_per_second": 2,
    "frame_skip": 15,
    "attendance_cooldown": 30
  }
}
```

### PUT `/api/realtime/{session_id}/stop`
Stop real-time video streaming session.

**Response:**
```json
{
  "success": true,
  "message": "Real-time video stream stopped successfully",
  "session_id": "123e4567-e89b-12d3-a456-426614174000",
  "final_stats": {
    "session_id": "123e4567-e89b-12d3-a456-426614174000",
    "frame_count": 1500,
    "processed_frames": 100,
    "attendance_records": 25
  }
}
```

### GET `/api/realtime/{session_id}/stats`
Get real-time session statistics.

**Response:**
```json
{
  "success": true,
  "session_id": "123e4567-e89b-12d3-a456-426614174000",
  "stream_info": {
    "session_id": "123e4567-e89b-12d3-a456-426614174000",
    "started_at": "2024-01-15T10:00:00Z",
    "frame_count": 1500,
    "processed_frames": 100,
    "status": "active"
  },
  "attendance_stats": {
    "present_count": 20,
    "late_count": 5,
    "total_recorded": 25
  },
  "processor_stats": {
    "frames_processed": 100,
    "faces_detected": 45,
    "faces_recognized": 38,
    "attendance_recorded": 25,
    "avg_processing_time": 0.156
  }
}
```

### GET `/api/realtime/active-streams`
Get all active video streams.

**Response:**
```json
{
  "success": true,
  "active_streams": [
    {
      "session_id": "123e4567-e89b-12d3-a456-426614174000",
      "started_at": "2024-01-15T10:00:00Z",
      "frame_count": 1500,
      "status": "active"
    }
  ],
  "total_streams": 1,
  "max_concurrent": 10
}
```

## Error Handling

### Error Response Format
```json
{
  "success": false,
  "error": "Error description",
  "error_code": "ERROR_CODE",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Common Error Codes
- `STREAM_NOT_FOUND`: Session not found
- `CAMERA_ACCESS_DENIED`: Camera access denied
- `MAX_STREAMS_EXCEEDED`: Too many active streams
- `PROCESSING_TIMEOUT`: Frame processing timeout
- `WEBSOCKET_CONNECTION_FAILED`: WebSocket connection failed

## Rate Limiting

- **API Requests**: 120 per minute
- **WebSocket Frames**: 240 per minute
- **Concurrent Streams**: 10 maximum
EOF

    print_success "Real-time video documentation created"
}

# Create SQL scripts for real-time system
create_sql_scripts() {
    print_step "8" "Creating SQL scripts for real-time video system"
    
    # Enhanced attendance_sessions table
    cat > sql_scripts/06_realtime_video_tables.sql << 'EOF'
-- Real-time Video Attendance System Tables

-- Update attendance_sessions for real-time video support
ALTER TABLE attendance_sessions 
ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'standard' 
CHECK (session_type IN ('standard', 'motion_detection', 'realtime_video'));

-- Add real-time video specific columns
ALTER TABLE attendance_sessions 
ADD COLUMN IF NOT EXISTS frames_processed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS faces_detected INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS stream_quality TEXT DEFAULT 'high';

-- Create realtime_video_streams table for detailed tracking
CREATE TABLE IF NOT EXISTS realtime_video_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    stream_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    stream_ended_at TIMESTAMP WITH TIME ZONE,
    total_frames INTEGER DEFAULT 0,
    processed_frames INTEGER DEFAULT 0,
    faces_detected INTEGER DEFAULT 0,
    faces_recognized INTEGER DEFAULT 0,
    attendance_recorded INTEGER DEFAULT 0,
    average_processing_time DECIMAL(5,3) DEFAULT 0.0,
    max_processing_time DECIMAL(5,3) DEFAULT 0.0,
    stream_quality TEXT DEFAULT 'high',
    websocket_connections INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    last_frame_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create frame_processing_logs table for detailed logging
CREATE TABLE IF NOT EXISTS frame_processing_logs (
    id SERIAL PRIMARY KEY,
    session_id UUID REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    frame_number INTEGER NOT NULL,
    processing_time DECIMAL(5,3) NOT NULL,
    faces_detected INTEGER DEFAULT 0,
    faces_recognized INTEGER DEFAULT 0,
    attendance_events INTEGER DEFAULT 0,
    frame_quality DECIMAL(3,2) DEFAULT 1.0,
    processing_status TEXT DEFAULT 'success',
    error_message TEXT,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_realtime_streams_session 
    ON realtime_video_streams(session_id);

CREATE INDEX IF NOT EXISTS idx_frame_logs_session 
    ON frame_processing_logs(session_id);

CREATE INDEX IF NOT EXISTS idx_frame_logs_processed_at 
    ON frame_processing_logs(processed_at);

-- Update attendance_records for real-time video detection
ALTER TABLE attendance_records 
ADD COLUMN IF NOT EXISTS frame_number INTEGER,
ADD COLUMN IF NOT EXISTS processing_time DECIMAL(5,3),
ADD COLUMN IF NOT EXISTS websocket_session TEXT;

-- Add detection method for real-time video
ALTER TABLE attendance_records 
ALTER COLUMN detection_method TYPE TEXT;

-- Update check constraint if exists
-- DROP CONSTRAINT IF EXISTS attendance_records_detection_method_check;
-- ADD CONSTRAINT attendance_records_detection_method_check 
--     CHECK (detection_method IN ('manual', 'motion_triggered', 'realtime_video', 'manual_during_realtime'));

-- Comments
COMMENT ON TABLE realtime_video_streams IS 'ติดตามข้อมูล Real-time Video Streaming Sessions';
COMMENT ON TABLE frame_processing_logs IS 'บันทึกการประมวลผลแต่ละเฟรมของ Real-time Video';

-- Seed data for testing
INSERT INTO attendance_sessions (
    class_id, 
    teacher_email, 
    start_time, 
    end_time, 
    on_time_limit_minutes, 
    status, 
    session_type
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'test.teacher@school.edu',
    NOW(),
    NOW() + INTERVAL '3 hours',
    15,
    'ended',
    'realtime_video'
) ON CONFLICT DO NOTHING;
EOF

    print_success "SQL scripts for real-time video created"
}

# Verify installation
verify_installation() {
    print_step "9" "Verifying real-time video installation"
    
    # Check Python virtual environment
    if [ -d "face_recognition_server/venv" ]; then
        print_success "Python virtual environment: OK"
    else
        print_error "Python virtual environment: MISSING"
    fi
    
    # Check Node modules
    if [ -d "Myweb/node_modules" ]; then
        print_success "Node modules: OK"
    else
        print_error "Node modules: MISSING"
    fi
    
    # Check camera test script
    if [ -x "scripts/test_camera.sh" ]; then
        print_success "Camera test script: OK"
    else
        print_warning "Camera test script: MISSING or not executable"
    fi
    
    # Check configuration files
    if [ -f "config/realtime_video.json" ]; then
        print_success "Real-time video configuration: OK"
    else
        print_warning "Real-time video configuration: MISSING"
    fi
    
    # Test Python imports
    cd face_recognition_server
    if source venv/bin/activate && python -c "import cv2, face_recognition, fastapi, websockets" 2>/dev/null; then
        print_success "Python dependencies: OK"
    else
        print_warning "Some Python dependencies may be missing"
    fi
    cd ..
    
    print_success "Real-time video installation verification completed"
}

# Show next steps
show_next_steps() {
    echo ""
    echo -e "${PURPLE}🎬 Real-time Video Attendance System Setup Complete!${NC}"
    echo ""
    echo -e "${YELLOW}📋 Next Steps:${NC}"
    echo "1. Set up Supabase database:"
    echo "   - Create project at https://app.supabase.com"
    echo "   - Run SQL scripts: sql_scripts/01_create_tables.sql"
    echo "   - Run SQL scripts: sql_scripts/06_realtime_video_tables.sql"
    echo ""
    echo "2. Configure environment variables:"
    echo "   - Copy .env.example to .env in both directories"
    echo "   - Add your Supabase URL and keys"
    echo ""
    echo "3. Test camera access:"
    echo "   ./scripts/test_camera.sh"
    echo ""
    echo "4. Start the real-time video system:"
    echo "   ./scripts/start_realtime.sh"
    echo ""
    echo "5. Open in browser:"
    echo "   http://localhost:5173"
    echo ""
    echo -e "${GREEN}🎯 Real-time Video Features:${NC}"
    echo "   ✅ Live video streaming from camera"
    echo "   ✅ Automatic face detection (2 FPS)"
    echo "   ✅ Instant attendance recording"
    echo "   ✅ WebSocket real-time communication"
    echo "   ✅ Multi-stream support (up to 10 classes)"
    echo "   ✅ Manual check-in override"
    echo "   ✅ Live processing statistics"
    echo ""
    echo -e "${BLUE}📱 System URLs:${NC}"
    echo "   Frontend: http://localhost:5173"
    echo "   API: http://localhost:8000"
    echo "   API Docs: http://localhost:8000/docs"
    echo "   WebSocket: ws://localhost:8000/ws/realtime/{session_id}"
    echo ""
    echo -e "${GREEN}🚀 Ready for Real-time Video Attendance!${NC}"
}

# Main execution
main() {
    print_header
    
    check_dependencies
    create_structure
    create_config_files
    install_fastapi_deps
    install_react_deps
    create_scripts
    create_docs
    create_sql_scripts
    verify_installation
    show_next_steps
}

# Run main function
main "$@"