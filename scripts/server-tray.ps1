# Runs the Chatterday server with no window: just an icon by the clock (the notification area).
# Right-click the icon to see the log, restart, or stop. If the server stops by itself it is started again.
# Started by "Chatterday Server.vbs" in the project folder, which hides the PowerShell window.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$dataDir = if ($env:CHATTERDAY_DATA) { $env:CHATTERDAY_DATA } else { Join-Path $root 'data' }
New-Item -ItemType Directory -Force $dataDir | Out-Null
$log = Join-Path $dataDir 'server.log'
$port = if ($env:PORT) { $env:PORT } else { '4477' }

# only one of these at a time
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "ChatterdayServerTray-$port", [ref]$created)
if (-not $created) { exit 0 }

$script:proc = $null
$script:stopping = $false
function Start-Server {
  if (-not (Test-Path (Join-Path $root 'client\dist\index.html'))) {
    Start-Process cmd.exe -ArgumentList '/c npm run build' -WorkingDirectory $root -WindowStyle Hidden -Wait
  }
  Add-Content $log "`n=== started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = "/c node server/index.ts >> `"$log`" 2>&1"
  $psi.WorkingDirectory = $root
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  $script:proc = [System.Diagnostics.Process]::Start($psi)
}
function Stop-Server {
  if ($script:proc -and -not $script:proc.HasExited) { & taskkill.exe /PID $script:proc.Id /T /F | Out-Null }
}

$bitmap = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'desktop\tray.png'))
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$tray.Text = 'Chatterday server (running)'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$title = $menu.Items.Add('Chatterday server'); $title.Enabled = $false
[void]$menu.Items.Add('-')
[void]$menu.Items.Add('Show the log', $null, { Start-Process notepad.exe $log })
# Restart: asks the server to restart for an update first (everyone in voice leaves and is put back afterwards: see
# scripts/restart.ps1); if it does not answer, it is stopped outright. Either way the watcher below starts it again.
[void]$menu.Items.Add('Restart', $null, {
  try {
    $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$(if ($env:PORT) { $env:PORT } else { 4477 })/local/restart" -Headers @{ 'X-Chatterday-Local' = 'restart' } -TimeoutSec 5
    if (-not ($r -is [psobject] -and $r.ok -eq $true)) { Stop-Server }      # (an older server answers with the page itself)
  } catch { Stop-Server }
})
[void]$menu.Items.Add('Stop the server and quit', $null, {
  $script:stopping = $true
  Stop-Server
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu

$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 5000
$watch.Add_Tick({
  if ($script:stopping) { return }
  if (-not $script:proc -or $script:proc.HasExited) {
    $tray.Text = 'Chatterday server (restarting)'
    Start-Server
    $tray.Text = 'Chatterday server (running)'
  }
})

Start-Server
$watch.Start()
[System.Windows.Forms.Application]::Run()
$tray.Dispose()
$mutex.ReleaseMutex()
