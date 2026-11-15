# Posts WM_CLOSE (what Alt+F4 sends) to every top-level window of the ISOLATED
# Syllable test instance (the electron.exe whose command line names the test
# profile). Never targets the user's own Syllable.exe.
param([string]$ProfileMatch = 'qa-test-profile')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32Close {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  public static List<IntPtr> WindowsOf(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, l) => { uint owner; GetWindowThreadProcessId(hwnd, out owner); if (owner == pid) found.Add(hwnd); return true; }, IntPtr.Zero);
    return found;
  }
  public static string ClassOf(IntPtr hwnd) { var text = new StringBuilder(256); GetClassName(hwnd, text, 256); return text.ToString(); }
}
'@
$main = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -match $ProfileMatch -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
if (-not $main) { 'test instance not running'; exit 1 }
$windows = [Win32Close]::WindowsOf([uint32]$main.ProcessId) | Where-Object { [Win32Close]::ClassOf($_) -eq 'Chrome_WidgetWin_1' }
"pid $($main.ProcessId): $(@($windows).Count) Chromium windows"
foreach ($hwnd in $windows) { [void][Win32Close]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
Start-Sleep -Milliseconds 1500
$alive = @($windows | Where-Object { [Win32Close]::IsWindow($_) }).Count
$visible = @($windows | Where-Object { [Win32Close]::IsWindow($_) -and [Win32Close]::IsWindowVisible($_) }).Count
"after WM_CLOSE: alive=$alive of $(@($windows).Count), visible=$visible"
