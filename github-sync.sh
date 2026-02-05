#!/bin/bash
# github-sync.sh - Periodic GitHub sync for Private-MoltSlack

echo "🔄 Checking for GitHub updates..."

cd "$(dirname "$0")"

# Fetch remote changes without merging
git fetch origin

# Check if local branch is behind remote
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
BASE=$(git merge-base @ @{u})

if [ $LOCAL = $REMOTE ]; then
    echo "✅ Up to date - No new changes from remote"
elif [ $LOCAL = $BASE ]; then
    echo "📥 New updates available - Pulling from GitHub..."
    git pull origin main

    # Check for merge conflicts
    if [ $? -ne 0 ]; then
        echo "⚠️ Merge conflicts detected - attempting to resolve..."
        # Try automatic conflict resolution
        git status --porcelain | grep "^UU" | while read file; do
            echo "Conflicted file: $file"
            # Keep local version for now
            git checkout --ours "$file"
        done
        git add .
        git commit -m "Auto-resolved merge conflicts (kept local changes)"
        git push origin main
        echo "✅ Conflicts resolved and pushed"
    else
        echo "✅ Updates pulled successfully"
    fi
elif [ $REMOTE = $BASE ]; then
    echo "📤 Local changes detected - Pushing to GitHub..."
    git push origin main
    if [ $? -ne 0 ]; then
        echo "⚠️ Push failed - Attempting to merge..."
        git pull origin main --rebase
        git push origin main
        if [ $? -eq 0 ]; then
            echo "✅ Pushed successfully after rebase"
        else
            echo "❌ Failed to push - Manual intervention required"
        fi
    else
        echo "✅ Pushed successfully"
    fi
else
    echo "⚠️ Diverged branches - Manual resolution required"
    echo "Run: git status to see details"
fi

# Show recent commits
echo ""
echo "📋 Recent commits:"
git log --oneline -5

echo ""
echo "🔄 Sync complete - Next check in 10 minutes"
