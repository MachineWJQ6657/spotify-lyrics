param(
  [int]$Seconds = 20,
  # Syllable.exe for a packaged build (the user's or a candidate), electron.exe for the dev test instance.
  [string]$Name = 'Syllable.exe',
  # A part of the command line that picks one instance: 'release\current', '.qa-test-profile', ...
  [string]$Match = ''
)
# Read-only: CPU per process of one Syllable instance over $Seconds, and the
# GPU engine time those processes used (Windows' "GPU Engine" counters, the
# numbers Task Manager shows). Sends nothing to the app.
#   powershell -File scripts\qa\perf.ps1 -Name Syllable.exe -Match 'release\current'
#   powershell -File scripts\qa\perf.ps1 -Name electron.exe -Match '.qa-test-profile'
# All windows of one instance share a renderer (process-per-site); split the
# renderer's time per window with scripts/qa/page-metrics.mjs.
$ErrorActionPreference = 'Stop'
function Snap {
  Get-CimInstance Win32_Process -Filter "Name='$Name'" | Where-Object { -not $Match -or $_.CommandLine -like "*$Match*" -or $_.ExecutablePath -like "*$Match*" } | ForEach-Object {
    $type = 'browser'
    if ($_.CommandLine -match '--type=([a-z-]+)') { $type = $matches[1] }
    if ($_.CommandLine -match '--utility-sub-type=([a-zA-Z.]+)') { $type = "utility:$($matches[1])" }
    if ($_.CommandLine -match '--renderer-client-id=(\d+)') { $type = "renderer#$($matches[1])" }
    [pscustomobject]@{ Id = $_.ProcessId; Type = $type; Ms = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000; Ws = [math]::Round($_.WorkingSetSize / 1MB) }
  }
}
$a = @(Snap)
if (-not $a.Count) { Write-Output "no $Name process matches '$Match'"; exit 1 }
$paths = @()
foreach ($p in $a) { $paths += "\GPU Engine(pid_$($p.Id)_*)\Utilization Percentage" }
# Get-Counter takes the $Seconds itself (one sample a second).
$samples = Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples $Seconds -ErrorAction SilentlyContinue
$b = @(Snap)
$totals = @{}
foreach ($set in $samples) { foreach ($s in $set.CounterSamples) {
  if ($s.InstanceName -match 'pid_(\d+)_.*engtype_(.+)$') { $key = "$($matches[1]) $($matches[2])"; $totals[$key] += $s.CookedValue / $Seconds }
} }
$total = 0
$rows = foreach ($p in $b) {
  $q = $a | Where-Object { $_.Id -eq $p.Id }
  if ($q) { $cpu = ($p.Ms - $q.Ms) / ($Seconds * 1000) * 100; $total += $cpu; '{0,-38} pid {1,-6} cpu {2,5:N2}%  mem {3} MB' -f $p.Type, $p.Id, $cpu, $p.Ws }
}
$rows | Sort-Object
'total cpu {0:N2}% of one core over {1} s' -f $total, $Seconds
$gpu = $totals.GetEnumerator() | Where-Object { $_.Value -ge 0.01 } | Sort-Object Name | ForEach-Object { '{0}={1:N2}%' -f $_.Name, $_.Value }
if ($gpu) { 'gpu (pid engine = average utilization): ' + ($gpu -join '  ') } else { 'gpu: no engine above 0.01%' }
