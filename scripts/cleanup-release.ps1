param(
  [Parameter(Mandatory = $true)][string]$InventoryPath,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\release')).TrimEnd('\')
$inventory = Get-Content -LiteralPath $InventoryPath -Raw | ConvertFrom-Json
$allowedCategories = @('obsolete-build-metadata', 'obsolete-staging-candidate', 'obsolete-rollback', 'obsolete-distribution', 'obsolete-build-output')
$targets = @($inventory.releaseEntries | Where-Object { $_.category -in $allowedCategories })
if ($targets.Count -eq 0) { throw 'No reviewed obsolete targets in inventory' }
$activeExecutables = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object -ExpandProperty ExecutablePath)
$seen = @{}
# Validate EVERY target before moving anything to the Windows Recycle Bin.
foreach ($target in $targets) {
  $resolved = (Resolve-Path -LiteralPath $target.path).Path
  $name = [IO.Path]::GetFileName($resolved)
  if ([IO.Path]::GetDirectoryName($resolved) -ne $releaseRoot -or $seen.ContainsKey($resolved)) { throw "Invalid or duplicate release target: $resolved" }
  $seen[$resolved] = $true
  $allowedName = $name -match '^candidate-0\.4\.(3[7-9]|4[0-3])-202610\d{2}(-final)?$' `
    -or $name -match '^current-0\.4\.(2[7-9]|3[0-7])-backup$' `
    -or $name -eq 'current-0.4.39-backup-20261021' `
    -or $name -match '^Syllable-0\.4\.2[7-9]-(Portable\.zip|Setup\.exe(\.blockmap)?)$' `
    -or $name -in @('staging-0443-recovered-copy', 'win-unpacked', 'builder-debug.yml', 'latest.yml')
  if (-not $allowedName -or $name -in @('current', 'current-0.4.38-backup-20261019', 'current-0.4.42-backup-20261023')) { throw "Protected/unreviewed release target: $resolved" }
  if ($activeExecutables | Where-Object { $_ -eq $resolved -or $_.StartsWith($resolved + '\', [StringComparison]::OrdinalIgnoreCase) }) { throw "An executable in target is still running: $resolved" }
  $item = Get-Item -LiteralPath $resolved -Force
  $descendants = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $resolved -Recurse -Force) } else { @() }
  if ((@($item) + $descendants) | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw "Reparse point in cleanup target: $resolved" }
  $files = @((@($item) + $descendants) | Where-Object { -not $_.PSIsContainer })
  $bytes = ($files | Measure-Object -Property Length -Sum).Sum
  if ([long]$bytes -ne [long]$target.bytes -or $files.Count -ne $target.files) { throw "Target changed since inventory: $resolved" }
}
if (-not $Apply) { $targets | Select-Object path, category, bytes; return }
Add-Type -AssemblyName Microsoft.VisualBasic
$completed = @()
foreach ($target in $targets) {
  if ((Get-Item -LiteralPath $target.path).PSIsContainer) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($target.path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  } else {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($target.path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  }
  if (Test-Path -LiteralPath $target.path) { throw "Recycle did not complete: $($target.path)" }
  $completed += $target
  [pscustomobject]@{ Recycled=$target.path; Bytes=$target.bytes } | ConvertTo-Json -Compress
}
[pscustomobject]@{ RecycledEntries=$completed.Count; ProjectBytesRemoved=($completed | Measure-Object -Property bytes -Sum).Sum; Recoverable='Windows Recycle Bin' } | ConvertTo-Json -Compress
