# End-to-end check of the step the dry run cannot cover: a running, installed app is replaced by the installer run with
# the same flags the app uses on itself, and comes back by itself. Uses a throwaway copy under another name and folder.
#
# First build the throwaway copy, from the desktop folder. It must go to a folder OUTSIDE desktop\dist, or the server
# would offer it to everybody as the newest installer:
#   npx electron-builder --win nsis --publish never -c.appId=app.chatterday.updatetest -c.productName="Chatterday UpdateTest"
#     -c.extraMetadata.productName="Chatterday UpdateTest" -c.extraMetadata.name=chatterday-updatetest
#     -c.directories.output=<some temp folder> -c.nsis.artifactName=UpdateTest-Setup.exe
# Then: powershell -ExecutionPolicy Bypass -File scripts\update-test.ps1 -Setup <that folder>\UpdateTest-Setup.exe
# It installs the copy, starts it, updates it while it runs, checks it came back, and removes every trace of it.
# The real Chatterday app is never touched (the installer only closes programs inside its own install folder).
param([Parameter(Mandatory = $true)][string]$Setup)
$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path $Setup).Path
if ($setup -notmatch 'UpdateTest') { throw 'This is for the throwaway UpdateTest copy only, never the real installer.' }
$profile = Join-Path $env:APPDATA 'Chatterday UpdateTest'
$real = { Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Chatterday.exe' } | ForEach-Object { $_.ProcessId } | Sort-Object }
$realBefore = (& $real) -join ','

New-Item -ItemType Directory -Force $profile | Out-Null
'{"serverUrl":"http://localhost:4478","autoLaunchSet":true,"closeToTray":true}' | Set-Content -Encoding ascii (Join-Path $profile 'config.json')

"1. first install (silent)"
$p = Start-Process $setup -ArgumentList '/S' -PassThru
if (-not $p.WaitForExit(180000)) { throw 'first install did not finish' }
$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Depth 2 -Filter 'Chatterday UpdateTest.exe' | Select-Object -First 1
if (-not $exe -or $exe.DirectoryName -notmatch 'updatetest') { throw 'the test copy was not installed where expected' }
$dir = $exe.DirectoryName
"   installed to $dir (exit $($p.ExitCode))"
$mine = { Get-CimInstance Win32_Process | Where-Object { $_.Path -and $_.Path.StartsWith($dir, 'CurrentCultureIgnoreCase') } }

"2. start it, as if it were in use"
Start-Process $exe.FullName -ArgumentList '--hidden'
Start-Sleep -Seconds 8
$before = @(& $mine)
"   running: $($before.Count) processes, pids $(($before | ForEach-Object { $_.ProcessId }) -join ',')"

"3. the installer, run the way the app runs it on itself: --updated /S --force-run"
$t = Get-Date
$p = Start-Process $setup -ArgumentList '--updated', '/S', '--force-run' -PassThru
if (-not $p.WaitForExit(180000)) { throw 'the update did not finish' }
$took = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
$after = @()
for ($i = 0; $i -lt 30 -and $after.Count -eq 0; $i++) { Start-Sleep -Seconds 1; $after = @(& $mine) }
Start-Sleep -Seconds 4
$after = @(& $mine)
$oldPids = $before | ForEach-Object { $_.ProcessId }
$survivors = @($after | Where-Object { $oldPids -contains $_.ProcessId })
$main = $after | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
"   installer exit $($p.ExitCode) after $took s"
"   old processes still alive: $($survivors.Count)"
"   new processes: $($after.Count), pids $(($after | ForEach-Object { $_.ProcessId }) -join ',')"
"   new main process arguments: $(if ($main) { ($main.CommandLine -replace [regex]::Escape($exe.FullName), 'APP').Trim() } else { 'none' })"
"   RESULT: $(if ($p.ExitCode -eq 0 -and $before.Count -gt 0 -and $survivors.Count -eq 0 -and $after.Count -gt 0) { 'PASS: closed, replaced and reopened by itself' } else { 'FAIL' })"

"4. clean up"
& $mine | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$un = Join-Path $dir 'Uninstall Chatterday UpdateTest.exe'
if (Test-Path $un) { $p = Start-Process $un -ArgumentList '/S' -PassThru; [void]$p.WaitForExit(120000) }
Start-Sleep -Seconds 4
if ($profile -match 'UpdateTest') { Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue }
$run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run').PSObject.Properties | Where-Object { $_.Name -match 'UpdateTest' }
$links = @(Get-ChildItem ([Environment]::GetFolderPath('Desktop')), ([Environment]::GetFolderPath('Programs')) -Filter '*UpdateTest*' -ErrorAction SilentlyContinue)
"   install folder left: $(Test-Path $dir) | settings folder left: $(Test-Path $profile) | start-up entries: $(@($run).Count) | shortcuts left: $($links.Count)"
"   the real Chatterday app untouched: $(((& $real) -join ',') -eq $realBefore) ($realBefore)"
