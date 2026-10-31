@echo off
setlocal
chcp 65001 >nul
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launcher.ps1" -Mode Install
set "result=%errorlevel%"
echo.
pause
exit /b %result%
