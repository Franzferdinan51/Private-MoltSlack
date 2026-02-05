@echo off
REM start-windows.bat - Easy launcher for Windows

echo 🚀 Starting Private-MoltSlack (Windows)...

REM Get Local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4 Address"') do (
    set LOCAL_IP=%%a
)
set LOCAL_IP=%LOCAL_IP: =%

REM Start Backend Server
echo 🌐 Starting Backend Server on port 3001...
start /B node server/index.js

REM Install Frontend Dependencies
if not exist "node_modules\" (
    echo 📦 Installing frontend dependencies...
    call npm install
)

REM Start Web UI
echo 💻 Starting Web UI...
echo 🔗 Local access: http://localhost:5173
echo 🔗 Remote access: http://%LOCAL_IP%:5173
npm run dev
