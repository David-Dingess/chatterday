# Lets Tailscale addresses, and only those, reach Chatterday on this PC.
# Run once from an ADMINISTRATOR PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1
# (undo: add -Remove). Windows will not run it directly unless scripts are allowed on the PC.
# The ports follow PORT and CHATTERDAY_LK_PORT (from the environment or the .env file), as the server does.
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with "Run as administrator" and run this again.'
}
Get-NetFirewallRule -DisplayName 'Chatterday *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) { Write-Host 'Chatterday firewall rules removed.'; exit 0 }

function Setting($name, $default) {
  $v = [Environment]::GetEnvironmentVariable($name)
  $envFile = Join-Path $PSScriptRoot '..\.env'
  if (-not $v -and (Test-Path $envFile)) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$name\s*=\s*(\d+)\s*$" } | Select-Object -Last 1
    if ($line -match '=\s*(\d+)') { $v = $Matches[1] }
  }
  if ($v) { [int]$v } else { $default }
}
$web = Setting 'PORT' 4477
$lk = Setting 'CHATTERDAY_LK_PORT' 7880
$media = $lk + 1, $lk + 2   # LiveKit uses the base port and the next two; only these two need to be reachable

$tailscale = '100.64.0.0/10'   # every Tailscale device has an address in this range
New-NetFirewallRule -DisplayName 'Chatterday web (Tailscale only)'   -Direction Inbound -Action Allow -Protocol TCP -LocalPort $web -RemoteAddress $tailscale | Out-Null
New-NetFirewallRule -DisplayName 'Chatterday media TCP (Tailscale only)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $media[0] -RemoteAddress $tailscale | Out-Null
New-NetFirewallRule -DisplayName 'Chatterday media UDP (Tailscale only)' -Direction Inbound -Action Allow -Protocol UDP -LocalPort $media[1] -RemoteAddress $tailscale | Out-Null
Write-Host "Done. Tailscale devices can reach ports $web, $($media[0]) and $($media[1]); nothing else changed."
