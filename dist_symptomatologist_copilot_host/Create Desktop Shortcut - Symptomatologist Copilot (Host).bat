@echo off
setlocal
cd /d %~dp0
echo Creating Desktop shortcut: Symptomatologist Copilot (Host)...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\\create_desktop_shortcut_host.ps1"
if %ERRORLEVEL% EQU 0 (
  echo Done. You can now run it from your Desktop.
) else (
  echo Failed to create shortcut. You can create a shortcut manually to "Symptomatologist Copilot (Host).bat".
)
pause
