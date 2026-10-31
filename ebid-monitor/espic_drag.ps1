# espic slider OS-level real-mouse drag (Win32). Called by cdt_rpa.mjs via child_process.
# drag.json: {mode:hover|drag, title, borderL, cssX, cssY, distCss, innerW, innerH, dpr}
# Output lines: win=L,T WxH | HOVER sx,sy | DRAG_DONE | WINDOW_NOT_FOUND(exit 2)
# Blocker check: reports HITTEST=<hwnd> which caller compares with target hwnd.
param([string]$JsonPath = "C:\work\ebid\ebid-monitor\data\espic_drag.json")
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ED {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(int x, int y);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    public const uint DOWN = 0x02, UP = 0x04;
}
"@
[ED]::SetProcessDPIAware() | Out-Null
$cfg = Get-Content $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$found = [IntPtr]::Zero
$sb = New-Object System.Text.StringBuilder 512
$cb = {
    param($h, $l)
    [void][ED]::GetWindowText($h, $sb, 512)
    if ($sb.ToString() -eq $cfg.title) { $script:found = $h; return $false }
    return $true
}
[ED]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($found -eq [IntPtr]::Zero) { Write-Host "WINDOW_NOT_FOUND"; exit 2 }
if ([ED]::IsIconic($found)) { [void][ED]::ShowWindow($found, 9) }
if (-not [ED]::IsWindowVisible($found)) { [void][ED]::ShowWindow($found, 5) }
[void][ED]::SetWindowPos($found, [IntPtr](-1), 0, 0, 0, 0, 0x0003)  # HWND_TOPMOST
Start-Sleep -Milliseconds 300
[void][ED]::SetForegroundWindow($found)
Start-Sleep -Milliseconds 400

$r = New-Object ED+RECT
[void][ED]::GetWindowRect($found, [ref]$r)
$winW = $r.R - $r.L; $winH = $r.B - $r.T
$dpr = [double]$cfg.dpr
$borderL = [double]$cfg.borderL
$chromeH = $winH - [double]$cfg.innerH * $dpr
$ox = $r.L + $borderL
$oy = $r.T + [math]::Round($chromeH)
$sx = [int]($ox + [double]$cfg.cssX * $dpr)
$sy = [int]($oy + [double]$cfg.cssY * $dpr)
Write-Host "win=$($r.L),$($r.T) ${winW}x${winH} start=$sx,$sy TARGET=$found"
Write-Host "HITTEST=$([ED]::WindowFromPoint($sx, $sy))"
if ($cfg.mode -eq "hover") {
    [void][ED]::SetCursorPos($sx, $sy)
    Write-Host "HOVER_DONE"
    exit 0
}
$dist = [int][math]::Round([double]$cfg.distCss * $dpr)
[void][ED]::SetCursorPos($sx, $sy)
Start-Sleep -Milliseconds 250
[ED]::mouse_event([ED]::DOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
$rng = New-Object System.Random
$n = 26
$over = [int][math]::Round($dist * 0.02) + 3
for ($i = 1; $i -le $n; $i++) {
    $t = $i / $n
    $te = if ($t -lt 0.5) { 4*$t*$t*$t } else { 1 - [math]::Pow(-2*$t + 2, 3) / 2 }
    $x = $sx + [int][math]::Round($dist * $te)
    if ($i -eq $n - 3) { $x += $over }
    if ($i -eq $n - 2) { $x = $sx + $dist + [int][math]::Round($over / 2) }
    if ($i -eq $n - 1) { $x = $sx + $dist + 1 }
    if ($i -eq $n) { $x = $sx + $dist }
    $y = $sy + $rng.Next(-2, 3)
    [void][ED]::SetCursorPos([int]$x, [int]$y)
    Start-Sleep -Milliseconds ($rng.Next(14, 46))
}
Start-Sleep -Milliseconds $rng.Next(120, 260)
[ED]::mouse_event([ED]::UP, 0, 0, 0, [UIntPtr]::Zero)
Write-Host "DRAG_DONE"
exit 0
