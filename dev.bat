@echo off
chcp 65001 >nul
title voxel-craft dev
setlocal
cd /d "%~dp0"

echo.
echo   ============================================
echo     方块世界 voxel-craft  ·  开发服务器
echo   ============================================
echo.

rem ---- 1. 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo   [x] 没有找到 Node.js。
  echo       请先安装 Node.js 18 或更高版本：https://nodejs.org/
  goto :fail
)

rem ---- 2. 检查依赖，缺了就装 ----
if not exist "node_modules\vite\package.json" (
  echo   [*] 首次运行，正在安装依赖，请稍候...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [!] 常规安装失败，改用 --ignore-scripts 重试...
    echo.
    call npm install --ignore-scripts
    if errorlevel 1 (
      echo   [x] 依赖安装失败。请检查网络或代理设置后重试。
      goto :fail
    )
  )
  echo.
)

rem ---- 3. 启动 Vite ----
rem  默认自动打开浏览器；不需要就执行：dev.bat nobrowser
set OPEN=--open
set HINT=      浏览器会自动打开
if /i "%~1"=="nobrowser" (
  set OPEN=
  set HINT=      请手动打开
)

echo   [*] 正在启动开发服务器...
echo %HINT% http://localhost:5173/
echo       停止服务：按 Ctrl+C
echo.

call npm run dev -- %OPEN%

rem Vite 退出后（正常 Ctrl+C 或启动失败）停在这里，方便看报错
echo.
echo   开发服务器已停止。
pause
endlocal
goto :eof

:fail
echo.
pause
endlocal
