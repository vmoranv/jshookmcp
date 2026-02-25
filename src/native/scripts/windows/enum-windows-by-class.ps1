param(
    [string]$ClassPattern
)

Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string title);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int maxCount);
  }
"@

$windows = @()
$hwnd = [IntPtr]::Zero
while ($true) {
  $hwnd = [Win32]::FindWindowEx([IntPtr]::Zero, $hwnd, $null, $null)
  if ($hwnd -eq [IntPtr]::Zero) { break }

  $className = New-Object System.Text.StringBuilder 256
  [Win32]::GetClassName($hwnd, $className, 256) | Out-Null
  $classNameStr = $className.ToString()

  # Support wildcard pattern matching
  $isMatch = $false
  if ($ClassPattern -eq $classNameStr) {
    $isMatch = $true
  } elseif ($ClassPattern.Contains('*')) {
    # Convert wildcard pattern to regex
    $regexPattern = [regex]::Escape($ClassPattern).Replace('\*', '.*')
    if ($classNameStr -match $regexPattern) {
      $isMatch = $true
    }
  }

  if ($isMatch) {
    $windowPid = 0
    [Win32]::GetWindowThreadProcessId($hwnd, [ref]$windowPid) | Out-Null
    $title = New-Object System.Text.StringBuilder 256
    [Win32]::GetWindowText($hwnd, $title, 256) | Out-Null
    $windows += @{
      Handle = $hwnd.ToString()
      Title = $title.ToString()
      ClassName = $classNameStr
      ProcessId = $windowPid
    }
  }
}
$windows | ConvertTo-Json -Compress
