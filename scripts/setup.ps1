# Downloads the LiveKit media server into bin\ and checks it against LiveKit's published checksum.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'      # Windows PowerShell redraws its progress bar for every block it downloads, which makes a download many times slower
$version = '1.13.11'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
$exe = Join-Path $bin 'livekit-server.exe'
if (Test-Path $exe) { Write-Host "LiveKit is already in bin\ ($exe)."; exit 0 }

New-Item -ItemType Directory -Force $bin | Out-Null
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$name = "livekit_${version}_windows_${arch}.zip"
$base = "https://github.com/livekit/livekit/releases/download/v$version"
$zip = Join-Path $bin $name
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host "Downloading $name ..."
Invoke-WebRequest "$base/$name" -OutFile $zip -UseBasicParsing
$sums = (Invoke-WebRequest "$base/checksums.txt" -UseBasicParsing).Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
$line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1
if (-not $line) { Remove-Item $zip; throw "No checksum listed for $name." }
$expected = ($line -split '\s+')[0].ToLower()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $zip; throw "Checksum mismatch for $name. Expected $expected, got $actual." }

Expand-Archive $zip -DestinationPath $bin -Force
Remove-Item $zip
if (-not (Test-Path $exe)) { throw "livekit-server.exe was not in the archive." }
Write-Host "LiveKit $version installed and verified (sha256 $actual)."
