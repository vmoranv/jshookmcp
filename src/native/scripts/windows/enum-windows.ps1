param(
    [int]$TargetPid
)

Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string title);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int maxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  }
"@

$windows = @()
$hwnd = [IntPtr]::Zero
while ($true) {
  $hwnd = [Win32]::FindWindowEx([IntPtr]::Zero, $hwnd, $null, $null)
  if ($hwnd -eq [IntPtr]::Zero) { break }
  $windowPid = 0
  [Win32]::GetWindowThreadProcessId($hwnd, [ref]$windowPid) | Out-Null
  if ($windowPid -eq $TargetPid) {
    $title = New-Object System.Text.StringBuilder 256
    $className = New-Object System.Text.StringBuilder 256
    [Win32]::GetWindowText($hwnd, $title, 256) | Out-Null
    [Win32]::GetClassName($hwnd, $className, 256) | Out-Null
    $rect = New-Object Win32+RECT
    [Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $windows += @{
      Handle = $hwnd.ToString()
      Title = $title.ToString()
      ClassName = $className.ToString()
      ProcessId = $windowPid
      Left = $rect.Left
      Top = $rect.Top
      Right = $rect.Right
      Bottom = $rect.Bottom
    }
  }
}
$windows | ConvertTo-Json -Compress
