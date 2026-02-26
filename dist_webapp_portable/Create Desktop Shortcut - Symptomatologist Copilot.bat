@echo off
setlocal
cd /d %~dp0
echo Creating Desktop shortcut: Symptomatologist Copilot...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\\create_desktop_shortcut.ps1"
if %ERRORLEVEL% EQU 0 (
  echo Done. You can now run it from your Desktop.
) else (
  echo Failed to create shortcut. You can create a shortcut manually to "Symptomatologist Copilot.bat".
)
pause
