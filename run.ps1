# run.ps1
$ErrorActionPreference = "Stop"

$DestRoot   = "C:\CoPilotSymptomatologistWinApp_v1"
$BackendDir = Join-Path $DestRoot "backend\copilot_backend"
$BackendExe = Join-Path $BackendDir "copilot_backend.exe"

# TODO: change this to your actual WinForms EXE name in the published folder
# Example: CoPilotSymptomatologistWinApp_v1.exe or CoPilotSymptomatologistWinApp.exe
$WinFormsExe = Join-Path $DestRoot "CoPilotSymptomatologistWinApp_v1.exe"

Write-Host "=== Starting Backend ==="
if (!(Test-Path $BackendExe)) { throw "Backend EXE not found: $BackendExe" }

# Start backend minimized
Start-Process -FilePath $BackendExe -WorkingDirectory $BackendDir -WindowStyle Minimized
Start-Sleep -Seconds 2

Write-Host "=== Starting WinForms ==="
if (!(Test-Path $WinFormsExe)) {
  throw "WinForms EXE not found. Update `$WinFormsExe in run.ps1. Current: $WinFormsExe"
}
Start-Process -FilePath $WinFormsExe -WorkingDirectory $DestRoot
Write-Host "Done."
