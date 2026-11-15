@echo off
rem Starts the Chatterday server. Leave this window open; closing it stops the server.
rem If the server ever stops by itself it is started again, and the reason is saved in data\crash.log.
title Chatterday server
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist bin\livekit-server.exe call npm run setup
if not exist client\dist\index.html call npm run build
:run
node server/index.ts
echo.
echo The server stopped (code %errorlevel%). Starting it again in 5 seconds. Close this window to stop for good.
timeout /t 5 /nobreak >nul
goto run
