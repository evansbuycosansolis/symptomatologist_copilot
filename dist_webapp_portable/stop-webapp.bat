@echo off
setlocal
echo Stopping CoPilot Symptomatologist backend...
taskkill /IM copilot_backend.exe /T /F >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo Stopped.
) else (
  echo Not running (or insufficient permissions).
)
pause
