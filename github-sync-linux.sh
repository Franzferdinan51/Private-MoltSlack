#!/bin/bash
# github-sync-linux.sh - Autonomous GitHub sync for Private-MoltSlack (Linux)
# Designed for multi-agent collaboration with regular pull/push cycle

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR" || exit 1

LOG_FILE="$REPO_DIR/sync.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "🔄 Starting GitHub sync..."

# Pull latest changes
log "📥 Pulling from origin/main..."
if git pull origin main; then
    log "✅ Pull successful"
else
    log "⚠️ Pull failed - continuing with local changes"
fi

# Check for local changes
if [ -n "$(git status --porcelain)" ]; then
    log "📝 Local changes detected"

    # Stage all changes
    git add -A

    # Auto-commit with timestamp
    COMMIT_MSG="Autonomous sync $(date '+%Y-%m-%d %H:%M:%S')"
    if git commit -m "$COMMIT_MSG"; then
        log "✅ Committed: $COMMIT_MSG"

        # Push to remote
        log "📤 Pushing to origin/main..."
        if git push origin main; then
            log "✅ Push successful"
        else
            log "❌ Push failed - will retry next cycle"
        fi
    else
        log "⚠️ No changes to commit"
    fi
else
    log "✅ No local changes"
fi

log "✨ Sync complete"
echo "" | tee -a "$LOG_FILE"
