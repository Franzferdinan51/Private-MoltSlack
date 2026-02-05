# Autonomous GitHub Sync Script for Private-MoltSlack
# Designed for multi-agent collaboration with regular pulls to avoid conflicts

param(
    [int]$PullIntervalMinutes = 5,  # Pull every 5 minutes
    [switch]$AutoCommit = $false,    # Auto-commit if changes detected
    [switch]$PushChanges = $false    # Auto-push commits
)

$repoPath = "C:\Users\Ryan\.openclaw\workspace\Private-MoltSlack"
$remoteName = "origin"
$branchName = "main"
$lastCommitFile = Join-Path $repoPath ".last-sync-commit"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "ERROR" { "Red" }
        "WARN"  { "Yellow" }
        "INFO"  { "Green" }
        default { "White" }
    }
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color
}

function Get-GitCommit {
    param([string]$Path)
    $commit = git -C $Path rev-parse HEAD 2>$null
    return $commit
}

function Save-LastCommit {
    param([string]$Commit)
    $Commit | Out-File -FilePath $lastCommitFile -Encoding UTF8
}

function Get-LastCommit {
    if (Test-Path $lastCommitFile) {
        return Get-Content $lastCommitFile
    }
    return $null
}

function Test-HasChanges {
    param([string]$Path)
    $status = git -C $Path status --porcelain 2>$null
    return $status -ne $null
}

function Invoke-GitPull {
    param([string]$Path)
    Write-Log "Pulling latest changes from $remoteName/$branchName..."

    $result = git -C $Path pull $remoteName $branchName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Pull successful"
        return $true
    } else {
        Write-Log "Pull failed: $result" "ERROR"
        return $false
    }
}

function Invoke-GitPush {
    param([string]$Path)
    Write-Log "Pushing changes to $remoteName/$branchName..."

    $result = git -C $Path push $remoteName $branchName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Push successful"
        return $true
    } else {
        Write-Log "Push failed: $result" "ERROR"
        return $false
    }
}

function Invoke-GitCommit {
    param([string]$Path, [string]$Message)

    if (-not (Test-HasChanges -Path $Path)) {
        Write-Log "No changes to commit"
        return $false
    }

    Write-Log "Committing changes: $Message"
    git -C $Path add -A 2>&1 | Out-Null
    $result = git -C $Path commit -m $Message 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Commit successful"
        return $true
    } else {
        Write-Log "Commit failed: $result" "ERROR"
        return $false
    }
}

function Invoke-AutoCommit {
    param([string]$Path)
    if (-not $AutoCommit) { return $false }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $agent = "DuckBot"
    $message = "Auto-commit from $agent at $timestamp - Autonomous sync cycle"

    return Invoke-GitCommit -Path $Path -Message $message
}

# Main Loop
Write-Log "=== Starting Autonomous GitHub Sync ==="
Write-Log "Repository: $repoPath"
Write-Log "Pull Interval: $PullIntervalMinutes minutes"
Write-Log "Auto-Commit: $AutoCommit"
Write-Log "Auto-Push: $PushChanges"
Write-Log ""

cd $repoPath

# Initial pull
Write-Log "Performing initial sync..."
Invoke-GitPull -Path $repoPath
Save-LastCommit -Commit (Get-GitCommit -Path $repoPath)
Write-Log "Initial sync complete. Monitoring for changes..."
Write-Log ""

# Monitoring loop
while ($true) {
    Start-Sleep -Seconds ($PullIntervalMinutes * 60)

    # Check remote for changes
    Write-Log "Checking for remote updates..."
    git -C $repoPath fetch $remoteName 2>&1 | Out-Null

    $localCommit = Get-GitCommit -Path $repoPath
    $remoteCommit = git -C $repoPath rev-parse $remoteName/$branchName 2>&1

    if ($localCommit -ne $remoteCommit) {
        Write-Log "Remote changes detected! Pulling..."
        $success = Invoke-GitPull -Path $repoPath

        if ($success) {
            Save-LastCommit -Commit (Get-GitCommit -Path $repoPath)
            Write-Log "Synced with remote. New commit: $remoteCommit"
        } else {
            Write-Log "Failed to sync with remote. Will retry on next cycle." "WARN"
        }
    } else {
        Write-Log "No remote changes detected."
    }

    # Check for local changes
    if (Test-HasChanges -Path $repoPath) {
        Write-Log "Local changes detected."

        if ($AutoCommit) {
            $committed = Invoke-AutoCommit -Path $repoPath

            if ($committed -and $PushChanges) {
                Invoke-GitPush -Path $repoPath
            }
        }
    }

    Write-Log ""
}
