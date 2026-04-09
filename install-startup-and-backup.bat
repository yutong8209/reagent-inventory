@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File ".\scripts\register-startup-and-backup.ps1"
if errorlevel 1 (
  echo.
  echo Startup and backup registration failed.
  pause
  exit /b 1
)
echo.
echo Startup and backup registration completed.
pause
