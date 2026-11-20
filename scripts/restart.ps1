# Restart the running server for an update, without dropping anybody's call for good.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart.ps1
#
# It asks the server (POST /local/restart, from this PC only) to restart: every app is told first, and anybody in a
# voice chat leaves it properly, then goes back into the same one once the server is up again (and the new version
# of the page is loaded, if there is one). The tray's watcher starts the server again within a few seconds.
# If the server does not know that request (an older build), it is stopped the old way: its cmd.exe parent killed.
# Run `npm run build` first when the page changed.
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 4477 }))
$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"

function Get-Listener { Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 }

$before = Get-Listener
if (-not $before) { Write-Host "Nothing is listening on port ${Port}: the tray's watcher should start it within a few seconds." -ForegroundColor Yellow; exit 0 }

try {
  $r = Invoke-RestMethod -Method Post -Uri "$base/local/restart" -Headers @{ 'X-Chatterday-Local' = 'restart' } -TimeoutSec 5
  # (an older server answers this address with the page itself, which is not a yes)
  if (-not ($r -is [psobject] -and $r.ok -eq $true)) { throw 'not understood' }
  Write-Host "Restarting for an update ($($r.inVoice) in voice; they are put back afterwards)." -ForegroundColor Cyan
} catch {
  Write-Host 'The server does not know /local/restart (an older build): stopping it the old way.' -ForegroundColor Yellow
  $node = Get-CimInstance Win32_Process -Filter "ProcessId=$($before.OwningProcess)"
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($node.ParentProcessId)"
  if ($parent.CommandLine -match 'node server/index.ts') { & taskkill.exe /T /F /PID $parent.ProcessId | Out-Null }
  else { & taskkill.exe /T /F /PID $node.ProcessId | Out-Null }
}

# Wait for the old one to go and a new one to answer.
$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Milliseconds 1000
  $now = Get-Listener
  $up = $false
  if ($now -and $now.OwningProcess -ne $before.OwningProcess) {
    try { $s = Invoke-RestMethod -Uri "$base/local/status" -TimeoutSec 3; $up = $true } catch { }
  }
} until ($up -or (Get-Date) -gt $deadline)

if ($up) { Write-Host "Back up (build $($s.build)); $($s.online) connected so far." -ForegroundColor Green }
else { Write-Host 'Not back after a minute: is the tray (Chatterday Server) running? See data\server.log.' -ForegroundColor Red; exit 1 }
