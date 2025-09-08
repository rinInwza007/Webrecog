#!/bin/bash

# setup.sh - ตั้งค่าทั้งระบบ Face Recognition Attendance

set -e

# สีสำหรับ output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${PURPLE}"
    echo "=============================================="
    echo "  🎯 Face Recognition Attendance System"
    echo "  📦 Complete Setup Script"
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

# ตรวจสอบ dependencies
check_dependencies() {
    print_step "1" "Checking system dependencies"
    
    # ตรวจสอบ Python
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed"
        print_info "Please install Python 3.8+ from https://python.org"
        exit 1
    fi
    
    # ตรวจสอบ Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        print_info "Please install Node.js 18+ from https://nodejs.org"
        exit 1
    fi
    
    # ตรวจสอบ npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    # ตรวจสอบ Git (optional)
    if ! command -v git &> /dev/null; then
        print_warning "Git is not installed (optional)"
    fi
    
    print_success "All required dependencies are installed"
}

# สร้างโครงสร้าง directory
create_structure() {
    print_step "2" "Creating project directory structure"
    
    # สร้าง directories
    mkdir -p config
    mkdir -p scripts
    mkdir -p sql_scripts
    mkdir -p docs
    mkdir -p face_recognition_server/logs
    
    print_success "Directory structure created"
}

# สร้างไฟล์ config
create_config_files() {
    print_step "3" "Creating configuration files"
    
    # สร้าง config/system.json ถ้ายังไม่มี
    if [ ! -f "config/system.json" ]; then
        print_info "Creating config/system.json..."
        # ไฟล์ system.json จะถูกสร้างโดยสคริปต์อื่น
        echo "Please copy the system.json content to config/system.json"
    fi
    
    # สร้าง .env templates
    create_env_templates
    
    print_success "Configuration files created"
}

# สร้าง .env templates
create_env_templates() {
    print_info "Creating .env template files..."
    
    # สร้าง .env.example สำหรับ React
    cat > Myweb/.env.example << 'EOF'
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# FastAPI Server URL
VITE_FASTAPI_URL=http://localhost:8000

# Environment
VITE_NODE_ENV=development
EOF

    # สร้าง .env.example สำหรับ FastAPI
    cat > face_recognition_server/.env.example << 'EOF'
# FastAPI Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=true

# Face Recognition Settings
FACE_VERIFICATION_THRESHOLD=0.7

# Motion Detection Settings
MOTION_DETECTION_ENABLED=true
DEFAULT_MOTION_THRESHOLD=0.1
MOTION_COOLDOWN_SECONDS=30
MAX_SNAPSHOTS_PER_HOUR=120

# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Optional: Service Key for admin operations
# SUPABASE_SERVICE_KEY=your_service_key_here
EOF
    
    print_info ".env.example files created"
}

# ติดตั้ง FastAPI dependencies
install_fastapi_deps() {
    print_step "4" "Installing FastAPI dependencies"
    
    cd face_recognition_server
    
    # สร้าง virtual environment ถ้ายังไม่มี
    if [ ! -d "venv" ]; then
        print_info "Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    # เปิดใช้งาน virtual environment
    source venv/bin/activate
    
    # อัปเกรด pip
    pip install --upgrade pip
    
    # ติดตั้ง dependencies
    print_info "Installing Python packages..."
    pip install -r requirements.txt
    
    cd ..
    
    print_success "FastAPI dependencies installed"
}

# ติดตั้ง React dependencies
install_react_deps() {
    print_step "5" "Installing React dependencies"
    
    cd Myweb
    
    # ติดตั้ง packages
    npm install
    
    # ติดตั้ง concurrently สำหรับ development
    npm install --save-dev concurrently
    
    cd ..
    
    print_success "React dependencies installed"
}

# สร้าง scripts
create_scripts() {
    print_step "6" "Creating utility scripts"
    
    # สร้าง start script สำหรับ Unix
    cat > scripts/start.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting Face Recognition Attendance System..."

# เริ่ม FastAPI server
echo "Starting FastAPI server..."
cd face_recognition_server
source venv/bin/activate
python main.py &
FASTAPI_PID=$!
cd ..

# รอ server เริ่มทำงาน
sleep 5

# เริ่ม React frontend
echo "Starting React frontend..."
cd Myweb
npm run dev &
REACT_PID=$!
cd ..

echo "✅ System started!"
echo "📱 Frontend: http://localhost:5173"
echo "🔧 API: http://localhost:8000"
echo "📖 API Docs: http://localhost:8000/docs"

# บันทึก PIDs
echo $FASTAPI_PID > scripts/.fastapi.pid
echo $REACT_PID > scripts/.react.pid

wait
EOF

    # สร้าง stop script
    cat > scripts/stop.sh << 'EOF'
#!/bin/bash
echo "🛑 Stopping Face Recognition Attendance System..."

# หยุด processes
if [ -f scripts/.fastapi.pid ]; then
    kill $(cat scripts/.fastapi.pid) 2>/dev/null
    rm scripts/.fastapi.pid
fi

if [ -f scripts/.react.pid ]; then
    kill $(cat scripts/.react.pid) 2>/dev/null
    rm scripts/.react.pid
fi

# หยุด processes ที่ใช้ ports
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null

echo "✅ System stopped!"
EOF

    # ให้สิทธิ์ execute
    chmod +x scripts/*.sh
    
    print_success "Utility scripts created"
}

# สร้าง documentation
create_docs() {
    print_step "7" "Creating documentation"
    
    # สร้าง README หลัก
    cat > README.md << 'EOF'
# 🎯 Face Recognition Attendance System

ระบบเช็คชื่อด้วย AI Face Recognition และ Motion Detection

## 🚀 Quick Start

```bash
# ตั้งค่าระบบ
./setup.sh

# เริ่มระบบ
./scripts/start.sh

# หยุดระบบ  
./scripts/stop.sh
```

## 📱 URLs

- Frontend: http://localhost:5173
- API: http://localhost:8000
- API Docs: http://localhost:8000/docs

## 📖 Documentation

- [Quick Start](docs/QUICKSTART.md)
- [API Documentation](docs/API.md)
- [Configuration](config/)

## 🔧 Features

- ✅ Face Recognition with AI
- ✅ Motion Detection System
- ✅ Real-time Attendance
- ✅ Teacher & Student Dashboards
- ✅ Class Management

## 💻 Tech Stack

- **Frontend:** React + Vite + Tailwind
- **Backend:** FastAPI + Python
- **Database:** Supabase
- **AI:** OpenCV + face_recognition
EOF

    print_success "Documentation created"
}

# ตรวจสอบการติดตั้ง
verify_installation() {
    print_step "8" "Verifying installation"
    
    # ตรวจสอบ virtual environment
    if [ -d "face_recognition_server/venv" ]; then
        print_success "Python virtual environment: OK"
    else
        print_error "Python virtual environment: MISSING"
    fi
    
    # ตรวจสอบ node_modules
    if [ -d "Myweb/node_modules" ]; then
        print_success "Node modules: OK"
    else
        print_error "Node modules: MISSING"
    fi
    
    # ตรวจสอบ config files
    if [ -f "config/system.json" ]; then
        print_success "Configuration files: OK"
    else
        print_warning "Configuration files: Please create config files"
    fi
    
    print_success "Installation verification completed"
}

# แสดงขั้นตอนถัดไป
show_next_steps() {
    echo ""
    echo -e "${PURPLE}🎉 Setup completed successfully!${NC}"
    echo ""
    echo -e "${YELLOW}📋 Next steps:${NC}"
    echo "1. Set up Supabase database:"
    echo "   - Create a new project at https://app.supabase.com"
    echo "   - Run SQL scripts from sql_scripts/ directory"
    echo ""
    echo "2. Configure environment variables:"
    echo "   - Copy .env.example to .env in both Myweb/ and face_recognition_server/"
    echo "   - Add your Supabase URL and keys"
    echo ""
    echo "3. Start the system:"
    echo "   ./scripts/start.sh"
    echo ""
    echo "4. Open in browser:"
    echo "   http://localhost:5173"
    echo ""
    echo -e "${GREEN}🚀 Ready to use Face Recognition Attendance System!${NC}"
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
    verify_installation
    show_next_steps
}

# รัน main function
main "$@"