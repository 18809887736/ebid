@echo off
type nul > "%~dp0data\run_now"
echo [ebid] 已写入 data\run_now，约 30 秒内开始加跑一轮巡检。
echo [ebid] 命中才发邮件；过程可看 docker compose logs -f。
pause
