@echo off
setlocal
cd /d %~dp0
start "Symptomatologist Copilot" /b .\\copilot_backend.exe
timeout /t 2 >nul
start "" http://127.0.0.1:8080/doctor/
echo Symptomatologist Copilot HOST is running.
echo Doctor portal (on this HOST PC): http://127.0.0.1:8080/doctor/
echo Assistant portal (from Assistant PC): http://^<THIS_PC_IP^>:8080/assistant/
echo Tip: run ipconfig to find THIS_PC_IP (IPv4 Address).
pause
