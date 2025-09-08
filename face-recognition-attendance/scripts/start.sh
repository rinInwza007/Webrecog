echo "Creating scripts..."
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