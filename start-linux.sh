#!/bin/bash
# start-linux.sh - Easy launcher for Linux

echo "🚀 Starting Private-MoltSlack (Linux)..."

# Navigate to server directory
cd "$(dirname "$0")/server"

# Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
    echo "📦 Installing server dependencies..."
    npm install
fi

# Start server in background
echo "🌐 Starting Backend Server on port 3001..."
node index.js &
SERVER_PID=$!

# Navigate to frontend (root)
cd ..

# Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

# Start Web UI (Vite)
echo "💻 Starting Web UI..."
echo "🔗 Local access: http://localhost:5173"
echo "🔗 Remote access: http://$(hostname -I | awk '{print $1}'):5173"
npm run dev

# Cleanup background server on exit
trap "kill $SERVER_PID" EXIT
