@echo off
chcp 65001 >nul
title Face Recognition Attendance System - Setup

echo.
echo 🎯 Face Recognition Attendance System
echo 📦 Complete Setup Script for Windows
echo ==============================================
echo.

REM ตรวจสอบ Python
echo [STEP 1] Checking system dependencies...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://python.org
    pause
    exit /b 1
)

REM ตรวจสอบ Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

REM ตรวจสอบ npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed
    pause
    exit /b 1
)

echo [SUCCESS] All required dependencies are installed
echo.

REM สร้างโครงสร้าง directory
echo [STEP 2] Creating project directory structure...
if not exist "config" mkdir config
if not exist "scripts" mkdir scripts
if not exist "sql_scripts" mkdir sql_scripts
if not exist "docs" mkdir docs
if not exist "face_recognition_server\logs" mkdir face_recognition_server\logs

echo [SUCCESS] Directory structure created
echo.

REM สร้าง .env template files
echo [STEP 3] Creating configuration files...

REM สร้าง .env.example สำหรับ React
echo # Supabase Configuration > Myweb\.env.example
echo VITE_SUPABASE_URL=your_supabase_url_here >> Myweb\.env.example
echo VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here >> Myweb\.env.example
echo. >> Myweb\.env.example
echo # FastAPI Server URL >> Myweb\.env.example
echo VITE_FASTAPI_URL=http://localhost:8000 >> Myweb\.env.example
echo. >> Myweb\.env.example
echo # Environment >> Myweb\.env.example
echo VITE_NODE_ENV=development >> Myweb\.env.example

REM สร้าง .env.example สำหรับ FastAPI
echo # FastAPI Server Configuration > face_recognition_server\.env.example
echo HOST=0.0.0.0 >> face_recognition_server\.env.example
echo PORT=8000 >> face_recognition_server\.env.example
echo DEBUG=true >> face_recognition_server\.env.example
echo. >> face_recognition_server\.env.example
echo # Face Recognition Settings >> face_recognition_server\.env.example
echo FACE_VERIFICATION_THRESHOLD=0.7 >> face_recognition_server\.env.example
echo. >> face_recognition_server\.env.example
echo # Motion Detection Settings >> face_recognition_server\.env.example
echo MOTION_DETECTION_ENABLED=true >> face_recognition_server\.env.example
echo DEFAULT_MOTION_THRESHOLD=0.1 >> face_recognition_server\.env.example
echo MOTION_COOLDOWN_SECONDS=30 >> face_recognition_server\.env.example
echo MAX_SNAPSHOTS_PER_HOUR=120 >> face_recognition_server\.env.example
echo. >> face_recognition_server\.env.example
echo # Supabase Configuration >> face_recognition_server\.env.example
echo SUPABASE_URL=your_supabase_url_here >> face_recognition_server\.env.example
echo SUPABASE_ANON_KEY=your_supabase_anon_key_here >> face_recognition_server\.env.example

echo [SUCCESS] Configuration template files created
echo.

REM ติดตั้ง FastAPI dependencies
echo [STEP 4] Installing FastAPI dependencies...
cd face_recognition_server

REM สร้าง virtual environment
if not exist "venv" (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment
        pause
        exit /b 1
    )
)

REM เปิดใช้งาน virtual environment และติดตั้ง packages
echo [INFO] Installing Python packages...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies
    pause
    exit /b 1
)

cd ..
echo [SUCCESS] FastAPI dependencies installed
echo.

REM ติดตั้ง React dependencies
echo [STEP 5] Installing React dependencies...
cd Myweb

echo [INFO] Installing Node.js packages...
npm install
if errorlevel 1 (
    echo [ERROR] Failed to install React dependencies
    pause
    exit /b 1
)

REM ติดตั้ง concurrently
npm install --save-dev concurrently
cd ..

echo [SUCCESS] React dependencies installed
echo.

REM สร้าง scripts
echo [STEP 6] Creating utility scripts...

REM สร้าง start.bat
echo @echo off > scripts\start.bat
echo title Face Recognition System - Running >> scripts\start.bat
echo echo 🚀 Starting Face Recognition Attendance System... >> scripts\start.bat
echo. >> scripts\start.bat
echo echo Starting FastAPI server... >> scripts\start.bat
echo start "FastAPI Server" cmd /k "cd face_recognition_server && call venv\Scripts\activate.bat && python main.py" >> scripts\start.bat
echo. >> scripts\start.bat
echo timeout /t 5 /nobreak ^>nul >> scripts\start.bat
echo. >> scripts\start.bat
echo echo Starting React frontend... >> scripts\start.bat
echo start "React Frontend" cmd /k "cd Myweb && npm run dev" >> scripts\start.bat
echo. >> scripts\start.bat
echo echo ✅ System started! >> scripts\start.bat
echo echo 📱 Frontend: http://localhost:5173 >> scripts\start.bat
echo echo 🔧 API: http://localhost:8000 >> scripts\start.bat
echo echo 📖 API Docs: http://localhost:8000/docs >> scripts\start.bat
echo pause >> scripts\start.bat

REM สร้าง stop.bat
echo @echo off > scripts\stop.bat
echo title Face Recognition System - Stopping >> scripts\stop.bat
echo echo 🛑 Stopping Face Recognition Attendance System... >> scripts\stop.bat
echo. >> scripts\stop.bat
echo REM หยุด processes ที่ใช้ ports >> scripts\stop.bat
echo for /f "tokens=5" %%%%a in ^('netstat -aon ^| find ":8000" ^| find "LISTENING"'^) do taskkill /f /pid %%%%a ^>nul 2^>^&1 >> scripts\stop.bat
echo for /f "tokens=5" %%%%a in ^('netstat -aon ^| find ":5173" ^| find "LISTENING"'^) do taskkill /f /pid %%%%a ^>nul 2^>^&1 >> scripts\stop.bat
echo. >> scripts\stop.bat
echo echo ✅ System stopped! >> scripts\stop.bat
echo pause >> scripts\stop.bat

echo [SUCCESS] Utility scripts created
echo.

REM สร้าง documentation
echo [STEP 7] Creating documentation...

echo # 🎯 Face Recognition Attendance System > README.md
echo. >> README.md
echo ระบบเช็คชื่อด้วย AI Face Recognition และ Motion Detection >> README.md
echo. >> README.md
echo ## 🚀 Quick Start >> README.md
echo. >> README.md
echo ```bash >> README.md
echo # ตั้งค่าระบบ >> README.md
echo setup.bat >> README.md
echo. >> README.md
echo # เริ่มระบบ >> README.md
echo scripts\start.bat >> README.md
echo. >> README.md
echo # หยุดระบบ >> README.md
echo scripts\stop.bat >> README.md
echo ``` >> README.md
echo. >> README.md
echo ## 📱 URLs >> README.md
echo. >> README.md
echo - Frontend: http://localhost:5173 >> README.md
echo - API: http://localhost:8000 >> README.md
echo - API Docs: http://localhost:8000/docs >> README.md

echo [SUCCESS] Documentation created
echo.

REM ตรวจสอบการติดตั้ง
echo [STEP 8] Verifying installation...

if exist "face_recognition_server\venv" (
    echo [SUCCESS] Python virtual environment: OK
) else (
    echo [ERROR] Python virtual environment: MISSING
)

if exist "Myweb\node_modules" (
    echo [SUCCESS] Node modules: OK
) else (
    echo [ERROR] Node modules: MISSING
)

if exist "config" (
    echo [SUCCESS] Configuration directory: OK
) else (
    echo [WARNING] Configuration directory: MISSING
)

echo [SUCCESS] Installation verification completed
echo.

REM แสดงขั้นตอนถัดไป
echo.
echo 🎉 Setup completed successfully!
echo.
echo 📋 Next steps:
echo 1. Set up Supabase database:
echo    - Create a new project at https://app.supabase.com
echo    - Run SQL scripts from sql_scripts\ directory
echo.
echo 2. Configure environment variables:
echo    - Copy .env.example to .env in both directories
echo    - Add your Supabase URL and keys
echo.
echo 3. Start the system:
echo    scripts\start.bat
echo.
echo 4. Open in browser:
echo    http://localhost:5173
echo.
echo 🚀 Ready to use Face Recognition Attendance System!
echo.

pause