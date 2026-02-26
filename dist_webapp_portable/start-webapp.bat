@echo off
setlocal
cd /d %~dp0
start "CoPilot Symptomatologist" /b .\copilot_backend.exe
timeout /t 2 >nul
start "" http://127.0.0.1:8080
echo Webapp running at http://127.0.0.1:8080
echo Close this window to stop the launcher; backend keeps running.
pause
