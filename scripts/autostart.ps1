# Starts the Chatterday server quietly when you log in to Windows (HKCU Run key, no admin needed).
# Add:  .\scripts\autostart.ps1          Remove:  .\scripts\autostart.ps1 -Remove
# The server's output goes to data\server.log.
param([switch]$Remove)
$ErrorActionPreference = 'Stop'      # without node on the PATH this used to save a start-up entry with no program in it, and say it worked
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($Remove) { Remove-ItemProperty -Path $key -Name 'Chatterday' -ErrorAction SilentlyContinue; Write-Host 'Autostart removed.'; exit 0 }
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$cmd = "powershell.exe -NoProfile -WindowStyle Hidden -Command `"Set-Location -LiteralPath '$root'; & '$node' server/index.ts *>> data\server.log`""
Set-ItemProperty -Path $key -Name 'Chatterday' -Value $cmd
Write-Host "Chatterday will start at login. Log: $root\data\server.log"
