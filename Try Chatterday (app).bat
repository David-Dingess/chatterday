@echo off
rem Opens a throwaway copy of Chatterday with pretend friends, inside the desktop app (its own window frame).
rem It never touches the real data. Close this window to stop it.
title Chatterday demo (app)
set DEMO_APP=1
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist bin\livekit-server.exe call npm run setup
if not exist desktop\node_modules\electron\dist\electron.exe (
  pushd desktop
  call npm install
  call node node_modules\electron\install.js
  popd
)
echo Building the latest UI...
call npm run build
if errorlevel 1 (
  echo.
  echo The build failed, so the demo was not started. Scroll up for the error.
  pause
  exit /b 1
)
node scripts\demo.mjs
