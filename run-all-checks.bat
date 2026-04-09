@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File ".\scripts\run-all-checks.ps1"
if errorlevel 1 (
  echo.
  echo 全量检查失败，请查看上面的输出信息。
  pause
  exit /b 1
)
echo.
echo 全量检查完成。
pause
