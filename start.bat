@echo off
setlocal
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python was not found.
    pause
    exit /b 1
)

if not exist data\reagent.db (
    echo Initializing database...
    python init_data.py
    if errorlevel 1 (
        echo [ERROR] Database initialization failed.
        pause
        exit /b 1
    )
)

call start-server-silent.bat

echo.
echo The service has been started in the background.
echo You can close this window and the service will keep running.
echo.
echo Local:   http://127.0.0.1:8000
echo LAN:     http://192.168.31.32:8000
echo.
echo Use stop-server.bat if you want to stop the service manually.
pause
