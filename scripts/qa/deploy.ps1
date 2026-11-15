# Deploys a verified candidate: quits the running Syllable gracefully
# (--syllable-quit), backs up its profile, swaps release/current, restarts it,
# verifies the deployed package and sends an older rollback copy to the Recycle Bin.
#
#   powershell -File scripts\qa\deploy.ps1 -Candidate candidate-0469 -Old 0.4.68 -New 0.4.69 [-Recycle current-0.4.67-backup-20261115]
#
# Run it only after verify-package.cjs and scripts/qa/smoke.sh passed for the candidate.
param([Parameter(Mandatory)][string]$Candidate, [Parameter(Mandatory)][string]$Old, [Parameter(Mandatory)][string]$New, [string]$Recycle = '')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
$current = Join-Path $root 'release\current'
$profile = Join-Path $env:APPDATA 'syllable'
$stamp = Get-Date -Format 'yyyyMMdd'
$mine = { @(Get-CimInstance Win32_Process -Filter "Name='Syllable.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($current + '\', [StringComparison]::OrdinalIgnoreCase) }) }
if (-not (Test-Path "release\$Candidate\win-unpacked\Syllable.exe")) { throw "candidate missing: $Candidate" }
$t0 = Get-Date
if ((& $mine).Count) { Start-Process -FilePath "$current\Syllable.exe" -ArgumentList '--syllable-quit' -Wait }
for ($i = 0; $i -lt 30 -and (& $mine).Count; $i++) { Start-Sleep -Milliseconds 400 }
"graceful quit: left=$((& $mine).Count) after $([int]((Get-Date) - $t0).TotalMilliseconds) ms"
(& $mine) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
$tag = $New.Replace('.', '')
if (Test-Path $profile) { Copy-Item -Recurse -Force $profile ".qa-user-data-preupdate-$tag" }
Rename-Item $current "current-$Old-backup-$stamp"
Move-Item "release\$Candidate\win-unpacked" $current
Remove-Item "release\$Candidate" -Recurse -Force
Start-Process -FilePath "$current\Syllable.exe" -WorkingDirectory $current
Start-Sleep 6
"running processes: " + (& $mine).Count
if ($Recycle -and (Test-Path "release\$Recycle")) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory((Resolve-Path "release\$Recycle").Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  "recycled $Recycle"
}
if (Test-Path "$profile\error.log") { 'error.log tail:'; Get-Content "$profile\error.log" -Tail 4 } else { 'no error.log in user profile' }
$report = Join-Path $env:TEMP 'syllable-verify-current.json'
node scripts/verify-package.cjs release/current 2>&1 | Out-File -Encoding ascii $report
node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^﻿/,'')); const e=Object.entries(r.checks||r).filter(([k,v])=>typeof v==='boolean'); console.log('deployed', r.version ?? '', 'pass', e.filter(([,v])=>v).length, '/', e.length, 'sha', r.archiveSha256)" $report
"backup: current-$Old-backup-$stamp"
