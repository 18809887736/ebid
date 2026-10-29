@echo off
chcp 65001 >nul
type nul > "%~dp0data\run_now"
echo [ebid] 已写入触发文件 data\run_now，常驻进程将在约 30 秒内开始加跑一轮巡检。
echo [ebid] 结果：命中才发邮件；完整过程可用 docker compose logs -f 查看。
pause
