# Builds the installer friends use (desktop\dist\Chatterday-Setup-<version>.exe).
# Run by "Build installer.bat" and by the Build button in Settings -> Admin.
# It packs in desktop\server.txt, the address the app opens (without it the installer is generic). Tailscale is NOT
# packed in: each friend installs it from tailscale.com themselves, and the app walks them through it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'desktop'
Set-Location $desktop

# Without desktop\server.txt the installer is a generic one: the app asks for a server link the first time it opens.
if (-not (Test-Path (Join-Path $desktop 'server.txt'))) {
  Write-Host 'No server address saved (desktop\server.txt), so this is a generic installer: the app will ask for a link.'
  Write-Host 'To build one with your address inside, save it in Settings -> Admin first.'
}

if (-not (Test-Path (Join-Path $desktop 'node_modules\electron-builder'))) {
  Write-Host 'Installing the build tools (once) ...'
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
}
if (-not (Test-Path (Join-Path $desktop 'node_modules\electron\dist\electron.exe'))) {
  node node_modules/electron/install.js      # npm sometimes skips Electron's own download step
}

Write-Host 'Building the installer ...'
npm run dist
if ($LASTEXITCODE -ne 0) { throw 'The build failed.' }
# An ffmpeg packed with the app must carry its licence (LGPL) and its build notes: scripts\pack-ffmpeg.mjs puts them
# beside it, and the installer must hold all three.
$ff = Join-Path $desktop 'vendor\ffmpeg-packed'
if (Test-Path (Join-Path $ff 'ffmpeg.exe')) {
  if (-not (Get-ChildItem $ff -Filter 'LICENSE-ffmpeg*') -or -not (Test-Path (Join-Path $ff 'FFMPEG-BUILD.txt'))) { throw 'ffmpeg was packed without its licence. Run node scripts\pack-ffmpeg.mjs again.' }
  $unpacked = Join-Path $desktop 'dist\win-unpacked\resources\ffmpeg'
  if ((Test-Path $unpacked) -and -not (Get-ChildItem $unpacked -Filter 'LICENSE-ffmpeg*')) { throw 'The installer has ffmpeg but not its licence.' }
  Write-Host "ffmpeg packed, with its licence: $((Get-Content (Join-Path $ff 'FFMPEG-BUILD.txt') | Select-String '^Version').Line)"
} else { Write-Host 'No ffmpeg packed: shared screens use the browser capture unless a PC has its own ffmpeg.' }
$made = Get-ChildItem (Join-Path $desktop 'dist') -Filter 'Chatterday-Setup-*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $made) { throw 'The build finished but no installer was made.' }
Write-Host "Done: $($made.FullName)"

# With a signing key set up (docs\SIGNED-UPDATES.md), the new installer is signed, so that apps will take it as an update.
if (Test-Path (Join-Path $desktop 'update-key.txt')) {
  node (Join-Path $root 'scripts\sign-installer.mjs') $made.FullName
  if ($LASTEXITCODE -ne 0) { Write-Host 'The installer was built but NOT signed (see above). Apps that hold your key will refuse it until it is: node scripts\sign-installer.mjs' }
}
