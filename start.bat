@echo off
chcp 65001 >nul
echo ==========================================
echo 检验科试剂出入库管理系统
echo ==========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请确保 Python 已安装并添加到 PATH
    pause
    exit /b 1
)

echo [1/3] 检查 Python 环境... 通过
python --version

REM Check if virtual environment exists
if not exist venv (
    echo [2/3] 创建虚拟环境...
    python -m venv venv
) else (
    echo [2/3] 虚拟环境已存在
)

REM Activate virtual environment
echo [3/3] 激活虚拟环境并安装依赖...
call venv\Scripts\activate.bat

REM Install dependencies
pip install -q -r requirements.txt
if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

echo.
echo ==========================================
echo 依赖安装完成，正在启动服务...
echo ==========================================
echo.
echo 服务启动后，请通过浏览器访问:
echo   http://localhost:8000
echo.
echo 局域网内其他设备访问:
echo   http://192.168.31.32:8000
echo.
echo 按 Ctrl+C 停止服务
echo ==========================================
echo.

REM Initialize database if not exists
if not exist data\reagent.db (
    echo 正在初始化数据库...
    python init_data.py
    echo.
)

REM Start the server
python main.py

pause
