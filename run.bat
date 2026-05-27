@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org/ ^(LTS recommended^) and re-run this script.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [setup] First run - installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
) else (
    echo [setup] Syncing dependencies...
    call npm install --silent --no-audit --no-fund
)

echo [dev] Starting on http://localhost:5173 ...
start "" http://localhost:5173
call npm run dev

endlocal
