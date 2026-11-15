@echo off
rem Rebuilds the installer friends use (desktop\dist).
rem Run this after changing the address or the Tailscale key in Settings, Admin.
title Building the Chatterday installer
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1
echo.
pause
