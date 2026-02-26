@echo off
setlocal
cd /d %~dp0
echo Creating Desktop shortcut: Symptomatologist Copilot (Assistant)...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\\create_desktop_shortcut_assistant.ps1"
if %ERRORLEVEL% EQU 0 (
  echo Done. You can now run it from your Desktop.
) else (
  echo Failed to create shortcut. You can create a shortcut manually to "Symptomatologist Copilot (Assistant).bat".
)
pause
