@echo off
setlocal
title SQL Land
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 goto old_node

node -e "fetch('http://localhost:5173/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
if not errorlevel 1 goto already_running

rem Install on the first run, and again whenever package-lock.json changes.
node -e "const fs=require('fs');try{process.exit(fs.statSync('package-lock.json').mtimeMs>fs.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch{process.exit(1)}"
if errorlevel 1 goto install
goto start

:install
echo Setting up SQL Land. The first time can take a minute...
call npm install --no-audit --no-fund
if errorlevel 1 goto install_failed

:start
echo.
echo Starting SQL Land. Your browser will open in a moment.
echo Keep this window open while you practice. Close it to stop SQL Land.
echo.
call npm start
pause
exit /b 0

:already_running
echo SQL Land is already running. Opening it in your browser.
start "" http://localhost:5173/
timeout /t 3 >nul
exit /b 0

:no_node
echo SQL Land needs Node.js, which is not installed on this computer.
echo Opening https://nodejs.org - install the LTS version, then double-click this file again.
start "" https://nodejs.org
pause
exit /b 1

:old_node
for /f "delims=" %%v in ('node --version') do set NODE_VERSION=%%v
echo SQL Land needs Node.js 22.12 or newer. This computer has %NODE_VERSION%.
echo Opening https://nodejs.org - install the LTS version, then double-click this file again.
start "" https://nodejs.org
pause
exit /b 1

:install_failed
echo.
echo Setup failed. Check your internet connection and try again.
pause
exit /b 1
