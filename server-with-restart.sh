#!/bin/bash
# Private-MoltSlack Server with Auto-Restart

SERVER_DIR="/home/duckets/.openclaw/workspace/Private-MoltSlack/server"
LOG_FILE="/tmp/pms-server.log"
PID_FILE="/tmp/pms-server.pid"
MAX_RESTARTS=10
RESTART_COUNT=0

cd "$SERVER_DIR"

echo "🚀 Starting Private-MoltSlack server with auto-restart..." | tee -a "$LOG_FILE"

while [ $RESTART_COUNT -lt $MAX_RESTARTS ]; do
    echo "[$(date)] Starting server (attempt $((RESTART_COUNT + 1))..." | tee -a "$LOG_FILE"
    
    # Start server in foreground (so we can catch crashes)
    node index.js 2>&1 | tee -a "$LOG_FILE" &
    PID=$!
    echo $PID > "$PID_FILE"
    
    # Wait for server to be ready
    sleep 3
    
    # Check if server is still running
    if kill -0 $PID 2>/dev/null; then
        echo "[$(date)] Server started with PID $PID" | tee -a "$LOG_FILE"
        
        # Monitor process
        while kill -0 $PID 2>/dev/null; do
            sleep 5
        done
        
        # Process died
        EXIT_CODE=$?
        echo "[$(date)] Server died with exit code $EXIT_CODE" | tee -a "$LOG_FILE"
        
        RESTART_COUNT=$((RESTART_COUNT + 1))
        
        # Wait a bit before restarting
        sleep 2
    else
        echo "[$(date)] Failed to start server" | tee -a "$LOG_FILE"
        RESTART_COUNT=$((RESTART_COUNT + 1))
        sleep 5
    fi
done

echo "[$(date)] Max restarts ($MAX_RESTARTS) reached. Stopping." | tee -a "$LOG_FILE"
rm -f "$PID_FILE"
