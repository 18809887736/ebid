# cdt-ec OS-level RPA: real Chrome, real input events, zero CDP. PS 5.1, needs UTF-8 BOM.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class M {
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
    public const uint DOWN = 0x02, UP = 0x04;
    public static void Click() { mouse_event(DOWN,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(60); mouse_event(UP,0,0,0,UIntPtr.Zero); }
}
"@
$log = "C:\work\ebid\ebid-monitor\data\cdt_rpa.log"
function Log($msg) {
    $line = "{0} [cdt-rpa] [INFO] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss,fff"), $msg
    Write-Host $line
    try { Add-Content -Path $log -Value $line -Encoding UTF8 } catch { Write-Host "(日志写入失败: $_)" }
}

function Click-El($el) {
    $pt = $el.GetClickablePoint()
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($pt.X, $pt.Y)
    Start-Sleep -Milliseconds 300
    [M]::Click()
}

Log "开始 RPA 采集 cdt-ec(真实键鼠,无 CDP)"
Start-Process "https://www.cdt-ec.com/notice/moreController/toMore?globleType=0"
Start-Sleep -Seconds 15

$root = [System.Windows.Automation.AutomationElement]::RootElement
$winCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "大唐集团电子商务平台 - Google Chrome")
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $winCond)
if (-not $win) {
    $c2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Chrome_WidgetWin_1")
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $c2)
    foreach ($w in $wins) { Write-Host "chrome窗口: $($w.Current.Name)" }
    $win = $wins | Where-Object { $_.Current.Name -like "*大唐*" } | Select-Object -First 1
}
if (-not $win) { Log "未找到大唐集团 Chrome 窗口,放弃"; exit 1 }
try { $win.SetFocus() } catch {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
    [W]::SetForegroundWindow((New-Object System.Windows.Forms.TextBox).Handle) 2>$null
}
Start-Sleep -Seconds 2

$doc = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
if (-not $doc) { Log "未找到页面文档元素(Chrome 无障碍树未激活)"; exit 1 }

$inpCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "公告标题")
$inp = $doc.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $inpCond)
if (-not $inp) { Log "未找到公告标题输入框"; exit 1 }
Click-El $inp
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("AVC")
Start-Sleep -Seconds 2

$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "搜 索")
$btn = $doc.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
if (-not $btn) {
    $all = $doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
    foreach ($b in $all) { if ($b.Current.Name -replace "\s","" -eq "搜索") { $btn = $b; break } }
}
if (-not $btn) { Log "未找到搜索按钮"; exit 1 }
Click-El $btn
Log "已点击搜索,等待结果"
Start-Sleep -Seconds 9

[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("^c")
Start-Sleep -Seconds 2
$text = [System.Windows.Forms.Clipboard]::GetText()
$compact = ($text -replace "\s+", " ")
Log ("页面文本长度: " + $text.Length)
if ($compact -like "*阳城*") {
    $i = $compact.IndexOf("阳城")
    $ctx = $compact.Substring([Math]::Max(0, $i - 80), [Math]::Min(260, $compact.Length - [Math]::Max(0, $i - 80)))
    Log ("命中阳城公告: " + $ctx)
} else {
    Log "页面文本中未找到阳城(截图留存页面状态)"
    $shot = "C:\work\ebid\ebid-monitor\data\cdt_rpa_fail.png"
    Add-Type -AssemblyName System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($shot); $g.Dispose(); $bmp.Dispose()
    Log ("已截图: " + $shot)
}
