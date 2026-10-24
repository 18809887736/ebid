@echo off
rem mock test web wrapper: mock.cmd up | mail | down | watch | logs | scenario <site> <mode> | reset
setlocal
cd /d "%~dp0.."
if not exist .env (
  echo [mock] .env not found. Run: copy .env.example .env
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
set "MOCK_BASE=http://127.0.0.1:%MOCK_PORT%"
set "M=%MOCK_BASE%"
if /i "%~1"=="up" (
  docker compose up -d --wait
) else if /i "%~1"=="mail" (
  docker compose --profile mail up -d --wait
) else if /i "%~1"=="down" (
  docker compose down
) else if /i "%~1"=="watch" (
  docker compose watch
) else if /i "%~1"=="logs" (
  docker compose logs -f mock-web
) else if /i "%~1"=="scenario" (
  curl.exe "%M%/__admin/scenario?site=%~2&mode=%~3&token=%MOCK_ADMIN_TOKEN%"
) else if /i "%~1"=="reset" (
  curl.exe "%M%/__admin/reset?token=%MOCK_ADMIN_TOKEN%"
) else (
  echo usage: mock.cmd up ^| mail ^| down ^| watch ^| logs ^| scenario ^<site^> ^<mode^> ^| reset
  echo   site: guoneng ^| chd ^| cweme ^| sink    mode: normal empty error5xx timeout layout_changed truncated_titles changed_notice poisoned
)
endlocal
