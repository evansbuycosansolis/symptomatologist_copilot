# install.ps1
$ErrorActionPreference = "Stop"

$SourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DestRoot   = "C:\CoPilotSymptomatologistWinApp_v1"

Write-Host "=== CoPilot Deploy ==="
Write-Host "Source: $SourceRoot"
Write-Host "Dest  : $DestRoot"

# 1) Copy application files
if (Test-Path $DestRoot) {
  Write-Host "Removing existing install..."
  Remove-Item -Recurse -Force $DestRoot
}
New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null

Write-Host "Copying WinForms app..."
Copy-Item -Recurse -Force (Join-Path $SourceRoot "app\*") $DestRoot

Write-Host "Copying backend..."
New-Item -ItemType Directory -Force -Path (Join-Path $DestRoot "backend") | Out-Null
Copy-Item -Recurse -Force (Join-Path $SourceRoot "backend\copilot_backend") (Join-Path $DestRoot "backend\copilot_backend")

# 2) Create storage folders (your known paths)
$RecordsRoot = "C:\SymptomatologistCopilot_Records"
$Folders = @(
  $RecordsRoot,
  "$RecordsRoot\Patients",
  "$RecordsRoot\AI_Report",
  "$RecordsRoot\Patients_Lab_Results"
)
foreach ($f in $Folders) {
  New-Item -ItemType Directory -Force -Path $f | Out-Null
}

# 3) Prepare backend .env (first-time)
$BackendDir = Join-Path $DestRoot "backend\copilot_backend"
$EnvPath    = Join-Path $BackendDir ".env"
$Template   = Join-Path $SourceRoot "backend\.env.template"

if (!(Test-Path $EnvPath)) {
  if (Test-Path $Template) {
    Copy-Item -Force $Template $EnvPath
    Write-Host "Created backend .env from template at: $EnvPath"
    Write-Host "IMPORTANT: Edit .env and set OPENAI_API_KEY before running."
  } else {
    Write-Host "WARNING: .env.template not found. Create $EnvPath manually."
  }
} else {
  Write-Host ".env already exists: $EnvPath"
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Next: run run.ps1 (after you set OPENAI_API_KEY)."
