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