# cdt-ec RPA entry: drives the flow in cdt_rpa.mjs via ego-browser (real Chromium, passes RiverSecurity).
# Replaces the old UIAutomation+SendKeys Chrome flow. ASCII-only so PS 5.1 needs no BOM.
$ErrorActionPreference = "Stop"
& ego-browser nodejs -e "await import('file:///C:/work/ebid/ebid-monitor/cdt_rpa.mjs')"
exit $LASTEXITCODE
