# Phase 7: Proactive Automation & Triggers

## Trigger Architecture

### 1. File System Watchers (`chokidar` / `fs.watch`)
- Monitored Paths: Active working directory, test output directories.
- Actions:
  - Detect newly failed unit test files and trigger background diagnostic analysis.
  - Detect uncommitted Git changes on inactivity and prepare a summary.

### 2. Git Hooks
- `pre-commit`: Runs Meera sanity checker on staged files before committing.
- `post-checkout`: Checks if environment dependencies or database migrations need running.

### 3. Scheduled Periodic Tasks
- Morning Daily Briefing (weather, calendar/reminders, git project status).
- Evening Progress Archival (updates `Progress-Log.md`).
