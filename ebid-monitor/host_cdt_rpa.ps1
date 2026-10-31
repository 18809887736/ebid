# cdt-ec+chdtp patrol (ego-browser) + espic patrol (Linux 10.0.0.9 docker: chromium+xvfb+xdotool).
# Stage 2 merges RESULT lines into app.log. ASCII only.
$ErrorActionPreference = "Continue"
$root = "C:\work\ebid\ebid-monitor"
$stamp = { Get-Date -Format "yyyy-MM-dd HH:mm:ss,fff" }

& ego-browser nodejs -e "await import('file:///C:/work/ebid/ebid-monitor/cdt_rpa.mjs')"
$rc1 = $LASTEXITCODE

$kws = ""
try { $kws = (Get-Content "$root\data\espic_keywords.txt" -Raw -ErrorAction Stop).Trim() } catch {}
if ($kws) {
    $out = $null
    foreach ($try in 1..2) {
        $out = & "$env:USERPROFILE\.ssh\ssh9.sh" "timeout 540 docker run --rm --memory=1500m espic-patrol '$kws'" 2>&1
        $rc2 = $LASTEXITCODE
        $solved = ($out | Select-String -SimpleMatch "RESULT|espic").Count
        if ($rc2 -eq 0 -and $solved -gt 0) { break }
        Write-Host "espic container try $try failed (exit=$rc2), retrying..."
        Start-Sleep -Seconds 30
    }
    foreach ($line in $out) {
        $t = "$line"
        if ($t -notmatch "^\[espic-linux\]") { continue }
        if ($t -match "RESULT\|espic\|(.+)$") {
            $parts = $t -split '\|'
            $msg = "[国电投电能易购] RPA巡查 关键词=" + $parts[2] + ", 返回 " + $parts[3] + " 条, 最新: " + $parts[4] + ", 发布日期: " + $parts[5]
            $line2 = "{0} [INFO] {1}" -f (& $stamp), $msg
            Add-Content -Path "$root\data\app.log" -Value $line2 -Encoding UTF8
            Write-Host $line2
        } else {
            $line2 = "{0} [cdt-rpa] [INFO] {1}" -f (& $stamp), $t
            Add-Content -Path "$root\data\cdt_rpa.log" -Value $line2 -Encoding UTF8
            Write-Host $line2
        }
    }
    if ($rc2 -ne 0) {
        $line2 = "{0} [cdt-rpa] [ERROR] espic linux 巡查失败(exit=$rc2)" -f (& $stamp)
        Add-Content -Path "$root\data\cdt_rpa.log" -Value $line2 -Encoding UTF8
        Write-Host $line2
    }
} else {
    Write-Host "no keywords file; skip espic stage"
}
if ($rc1 -ne 0) { exit $rc1 } else { exit 0 }
