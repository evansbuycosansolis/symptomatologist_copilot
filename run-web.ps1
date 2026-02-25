$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$BackendVenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$BackendPython = if (Test-Path $BackendVenvPython) { $BackendVenvPython } else { "python" }

Write-Host "Starting FastAPI backend (uvicorn) ..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$BackendDir`"; `"$BackendPython`" -m uvicorn main:app --host 127.0.0.1 --port 8080 --reload"
)

Start-Sleep -Seconds 2

Write-Host "Starting Next.js frontend ..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$FrontendDir`"; npm run dev"
)

Write-Host "Web stack launched:"
Write-Host "  Frontend: http://localhost:3000"
Write-Host "  Backend : http://127.0.0.1:8080"
