@echo off
setlocal
type nul > "%~dp0data\run_now"
echo [ebid] 已触发巡检，等待容器执行...

rem 最多等 90 秒让守护进程消费触发文件；用 ping 延时避免 timeout 命令被其他程序同名劫持
set /a n=0
:wait_start
if not exist "%~dp0data\run_now" goto started
set /a n+=1
if %n% geq 30 goto no_response
ping -n 4 127.0.0.1 >nul
goto wait_start

:no_response
echo [ebid] 90 秒内容器未消费触发文件——容器可能未运行，请 docker compose ps 检查。
pause
exit /b 1

:started
echo [ebid] 巡检进行中，等待完成（日志安静 40 秒视为结束）...
set "prev=-1"
:wait_done
ping -n 21 127.0.0.1 >nul
for %%F in ("%~dp0data\app.log") do set "cur=%%~zF"
if "%cur%"=="%prev%" goto done
set "prev=%cur%"
goto wait_done

:done
powershell -NoProfile -Command "[console]::beep(1200,250); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('巡检轮次已完成。结果：命中见邮箱，过程见 docker compose logs -f。','ebid 巡检完成')"
echo [ebid] 巡检完成。
