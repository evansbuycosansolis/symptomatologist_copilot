$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$OutDir = Join-Path $RepoRoot "dist_webapp_portable"
$HostOutDir = Join-Path $RepoRoot "dist_symptomatologist_copilot_host"
$AssistantOutDir = Join-Path $RepoRoot "dist_symptomatologist_copilot_assistant"
$LegacyDoctorOutDir = Join-Path $RepoRoot "dist_symptomatologist_copilot_doctor"
$LegacyDoctorZip = "${LegacyDoctorOutDir}.zip"

function Write-Utf8NoBomLines {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$Lines
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($Path, $Lines, $encoding)
}

function Compress-WithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$MaxRetries = 5,
    [int]$DelaySeconds = 2
  )

  if (Test-Path $DestinationPath) { Remove-Item -Force $DestinationPath }
  for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
    try {
      Compress-Archive -Path $SourcePath -DestinationPath $DestinationPath -Force -ErrorAction Stop
      Write-Host "$Label created: $DestinationPath" -ForegroundColor Green
      return
    } catch {
      if ($attempt -ge $MaxRetries) { throw }
      Write-Host "$Label failed on attempt $attempt/$MaxRetries (file lock likely). Retrying..." -ForegroundColor Yellow
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

Write-Host "Packaging portable webapp..." -ForegroundColor Cyan

# Cleanup legacy package name from the old Assistant-host/Doctor-client topology.
if (Test-Path $LegacyDoctorOutDir) {
  Remove-Item -Recurse -Force $LegacyDoctorOutDir
}
if (Test-Path $LegacyDoctorZip) {
  Remove-Item -Force $LegacyDoctorZip
}

# 1) Build static frontend (Next export -> frontend/out)
Write-Host "Building frontend (static export)..." -ForegroundColor Cyan
Push-Location $FrontendDir
try {
  if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    npm install
  }
  npm run build
} finally {
  Pop-Location
}

$FrontendOut = Join-Path $FrontendDir "out"
if (-not (Test-Path (Join-Path $FrontendOut "index.html"))) {
  throw "Frontend export not found at $FrontendOut"
}

# 2) Build backend EXE using PyInstaller
Write-Host "Building backend executable (PyInstaller)..." -ForegroundColor Cyan
Push-Location $BackendDir
try {
  $VenvPython = Join-Path $BackendDir ".venv_pack\Scripts\python.exe"
  if (-not (Test-Path $VenvPython)) {
    python -m venv .venv_pack
  }
  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install -r requirements.txt
  & $VenvPython -m pip install pyinstaller
  & $VenvPython -m PyInstaller .\copilot_backend.spec --clean --noconfirm
} finally {
  Pop-Location
}

$BackendDist = Join-Path $BackendDir "dist\copilot_backend"
if (-not (Test-Path (Join-Path $BackendDist "copilot_backend.exe"))) {
  throw "Backend EXE not found at $BackendDist"
}

# 3) Assemble portable folder
Write-Host "Assembling $OutDir ..." -ForegroundColor Cyan
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Path $OutDir | Out-Null

Copy-Item -Recurse -Force $BackendDist\* $OutDir

# Put static web assets next to the EXE so backend can serve them
$WebDir = Join-Path $OutDir "web"
New-Item -ItemType Directory -Path $WebDir -Force | Out-Null
Copy-Item -Recurse -Force $FrontendOut\* $WebDir

# Include tessdata if present (optional OCR improvements)
$TessData = Join-Path $BackendDir "tessdata"
if (Test-Path $TessData) {
  Copy-Item -Recurse -Force $TessData (Join-Path $OutDir "tessdata")
}

# Create default .env (no key required to run; LLM features will fallback)
$EnvPath = Join-Path $OutDir ".env"
Write-Utf8NoBomLines -Path $EnvPath -Lines @(
  "OPENAI_API_KEY=",
  "OPENAI_MODEL=gpt-4o-mini",
  "HOST=127.0.0.1",
  "PORT=8080",
  "FRONTEND_ORIGIN=http://127.0.0.1:8080",
  "DOCTOR_PIN=""docbayson888#""",
  "ASSISTANT_PIN=assistant123",
  "AUTH_SECRET=change-this-long-random-secret",
  "AUTH_COOKIE_SECURE=0",
  "AUTH_COOKIE_PERSIST=0"
)

# Launcher
$BatPath = Join-Path $OutDir "start-webapp.bat"
@(
  '@echo off',
  'setlocal',
  'cd /d %~dp0',
  'start "CoPilot Symptomatologist" /b .\copilot_backend.exe',
  'timeout /t 2 >nul',
  'start "" http://127.0.0.1:8080/login/?fresh=1',
  'echo Webapp running at http://127.0.0.1:8080/login/?fresh=1',
  'echo Close this window to stop the launcher; backend keeps running.',
  'pause'
) | Set-Content -Encoding ascii $BatPath

$StopBatPath = Join-Path $OutDir "stop-webapp.bat"
@(
  '@echo off',
  'setlocal',
  'echo Stopping CoPilot Symptomatologist backend...',
  'taskkill /IM copilot_backend.exe /T /F >nul 2>&1',
  'if %ERRORLEVEL% EQU 0 (',
  '  echo Stopped.',
  ') else (',
  '  echo Not running (or insufficient permissions).',
  ')',
  'pause'
) | Set-Content -Encoding ascii $StopBatPath

# Friendly launcher name (so users can create a Desktop shortcut easily)
$FriendlyBatPath = Join-Path $OutDir "Symptomatologist Copilot.bat"
@(
  '@echo off',
  'setlocal',
  'cd /d %~dp0',
  'call .\\start-webapp.bat'
) | Set-Content -Encoding ascii $FriendlyBatPath

# One-time helper: creates a Desktop shortcut (icon) pointing to the friendly launcher
$ShortcutPs1Path = Join-Path $OutDir "create_desktop_shortcut.ps1"
@(
  '$ErrorActionPreference = "Stop"',
  '$WshShell = New-Object -ComObject WScript.Shell',
  '$Desktop = [Environment]::GetFolderPath("Desktop")',
  '$ShortcutPath = Join-Path $Desktop "Symptomatologist Copilot.lnk"',
  '$Target = Join-Path (Get-Location) "Symptomatologist Copilot.bat"',
  '$Icon = Join-Path (Get-Location) "copilot_backend.exe"',
  '$s = $WshShell.CreateShortcut($ShortcutPath)',
  '$s.TargetPath = $Target',
  '$s.WorkingDirectory = (Get-Location).Path',
  '$s.IconLocation = "$Icon,0"',
  '$s.Save()',
  'Write-Host "Created: $ShortcutPath"'
) | Set-Content -Encoding utf8 $ShortcutPs1Path

$ShortcutBatPath = Join-Path $OutDir "Create Desktop Shortcut - Symptomatologist Copilot.bat"
@(
  '@echo off',
  'setlocal',
  'cd /d %~dp0',
  'echo Creating Desktop shortcut: Symptomatologist Copilot...',
  'powershell -NoProfile -ExecutionPolicy Bypass -File ".\\create_desktop_shortcut.ps1"',
  'if %ERRORLEVEL% EQU 0 (',
  '  echo Done. You can now run it from your Desktop.',
  ') else (',
  '  echo Failed to create shortcut. You can create a shortcut manually to "Symptomatologist Copilot.bat".',
  ')',
  'pause'
) | Set-Content -Encoding ascii $ShortcutBatPath

Write-Host "Done." -ForegroundColor Green
Write-Host "Portable folder: $OutDir" -ForegroundColor Green
Write-Host "Copy this folder to another PC and run start-webapp.bat" -ForegroundColor Green

# 4) Create a single ZIP for easy transfer
$ZipPath = "${OutDir}.zip"
Write-Host "Creating ZIP: $ZipPath" -ForegroundColor Cyan
Compress-WithRetry -SourcePath (Join-Path $OutDir "*") -DestinationPath $ZipPath -Label "ZIP"

###############################################################################
# Doctor HOST package (server on the Doctor PC)
###############################################################################

Write-Host "Assembling HOST package: $HostOutDir ..." -ForegroundColor Cyan
if (Test-Path $HostOutDir) { Remove-Item -Recurse -Force $HostOutDir }
New-Item -ItemType Directory -Path $HostOutDir | Out-Null

Copy-Item -Recurse -Force $BackendDist\* $HostOutDir

$HostWebDir = Join-Path $HostOutDir "web"
New-Item -ItemType Directory -Path $HostWebDir -Force | Out-Null
Copy-Item -Recurse -Force $FrontendOut\* $HostWebDir

if (Test-Path $TessData) {
  Copy-Item -Recurse -Force $TessData (Join-Path $HostOutDir "tessdata")
}

# Host .env: listen on the LAN so Assistant PC can connect
$HostEnvPath = Join-Path $HostOutDir ".env"
Write-Utf8NoBomLines -Path $HostEnvPath -Lines @(
  "OPENAI_API_KEY=",
  "OPENAI_MODEL=gpt-4o-mini",
  "HOST=0.0.0.0",
  "PORT=8080",
  "FRONTEND_ORIGIN=http://127.0.0.1:8080",
  "DOCTOR_PIN=""docbayson888#""",
  "ASSISTANT_PIN=assistant123",
  "AUTH_SECRET=change-this-long-random-secret",
  "AUTH_COOKIE_SECURE=0",
  "AUTH_COOKIE_PERSIST=0"
)

# Host launcher
$HostStartBat = Join-Path $HostOutDir "Symptomatologist Copilot (Host).bat"
@(
  '@echo off',
  'setlocal',
  'cd /d %~dp0',
  'start "Symptomatologist Copilot" /b .\\copilot_backend.exe',
  'timeout /t 2 >nul',
  'start "" http://127.0.0.1:8080/login/?next=doctor^&fresh=1',
  'echo Symptomatologist Copilot HOST is running.',
  'echo Login portal (on this HOST PC): http://127.0.0.1:8080/login/?next=doctor^&fresh=1',
  'echo Assistant login portal (from Assistant PC): http://^<THIS_PC_IP^>:8080/login/?next=assistant^&fresh=1',
  'echo Tip: run ipconfig to find THIS_PC_IP (IPv4 Address).',
  'pause'
) | Set-Content -Encoding ascii $HostStartBat

$HostStopBat = Join-Path $HostOutDir "Stop - Symptomatologist Copilot (Host).bat"
@(
  '@echo off',
  'setlocal',
  'echo Stopping Symptomatologist Copilot backend...',
  'taskkill /IM copilot_backend.exe /T /F >nul 2>&1',
  'if %ERRORLEVEL% EQU 0 (',
  '  echo Stopped.',
  ') else (',
  '  echo Not running (or insufficient permissions).',
  ')',
  'pause'
) | Set-Content -Encoding ascii $HostStopBat

# Optional: firewall helper (must be run as Admin once)
$FirewallBat = Join-Path $HostOutDir "Allow Firewall Port 8080 (Run as Admin).bat"
@(
  '@echo off',
  'setlocal',
  'echo Adding Windows Firewall rule for TCP port 8080...',
  'netsh advfirewall firewall add rule name="Symptomatologist Copilot" dir=in action=allow protocol=TCP localport=8080',
  'echo Done.',
  'pause'
) | Set-Content -Encoding ascii $FirewallBat

# Desktop shortcut creator (host)
$HostShortcutPs1 = Join-Path $HostOutDir "create_desktop_shortcut_host.ps1"
@(
  '$ErrorActionPreference = "Stop"',
  '$WshShell = New-Object -ComObject WScript.Shell',
  '$Desktop = [Environment]::GetFolderPath("Desktop")',
  '$ShortcutPath = Join-Path $Desktop "Symptomatologist Copilot (Doctor Host).lnk"',
  '$Target = Join-Path (Get-Location) "Symptomatologist Copilot (Host).bat"',
  '$Icon = Join-Path (Get-Location) "copilot_backend.exe"',
  '$s = $WshShell.CreateShortcut($ShortcutPath)',
  '$s.TargetPath = $Target',
  '$s.WorkingDirectory = (Get-Location).Path',
  '$s.IconLocation = "$Icon,0"',
  '$s.Save()',
  'Write-Host "Created: $ShortcutPath"'
) | Set-Content -Encoding utf8 $HostShortcutPs1

$HostShortcutBat = Join-Path $HostOutDir "Create Desktop Shortcut - Symptomatologist Copilot (Host).bat"
@(
  '@echo off',
  'setlocal',
  'cd /d %~dp0',
  'echo Creating Desktop shortcut: Symptomatologist Copilot (Host)...',
  'powershell -NoProfile -ExecutionPolicy Bypass -File ".\\create_desktop_shortcut_host.ps1"',
  'if %ERRORLEVEL% EQU 0 (',
  '  echo Done. You can now run it from your Desktop.',
  ') else (',
  '  echo Failed to create shortcut. You can create a shortcut manually to "Symptomatologist Copilot (Host).bat".',
  ')',
  'pause'
) | Set-Content -Encoding ascii $HostShortcutBat

$HostZip = "${HostOutDir}.zip"
Write-Host "Creating HOST ZIP: $HostZip" -ForegroundColor Cyan
Compress-WithRetry -SourcePath (Join-Path $HostOutDir "*") -DestinationPath $HostZip -Label "HOST ZIP"

###############################################################################
# Assistant CLIENT package
###############################################################################

Write-Host "Assembling ASSISTANT client package: $AssistantOutDir ..." -ForegroundColor Cyan
if (Test-Path $AssistantOutDir) { Remove-Item -Recurse -Force $AssistantOutDir }
New-Item -ItemType Directory -Path $AssistantOutDir | Out-Null

$AssistantLauncher = Join-Path $AssistantOutDir "Symptomatologist Copilot (Assistant).bat"
@(
  '@echo off',
  'setlocal EnableExtensions',
  'cd /d %~dp0',
  'set HOST_FILE=host.txt',
  'set HOST=',
  'if exist "%HOST_FILE%" (',
  '  set /p HOST=<"%HOST_FILE%"',
  ')',
  'if "%HOST%"=="" (',
  '  echo Enter the HOST PC IP address (Doctor PC), example: 192.168.1.50',
  '  set /p HOST=HOST IP: ',
  '  echo %HOST%>"%HOST_FILE%"',
  ')',
  'start "" "http://%HOST%:8080/login/?next=assistant^&fresh=1"',
  'echo Opening Assistant login portal at http://%HOST%:8080/login/?next=assistant^&fresh=1',
  'echo If it does not load, check the HOST PC is running and firewall allows port 8080.',
  'echo Note: all data is stored on the HOST (Doctor) PC only.',
  'pause'
) | Set-Content -Encoding ascii $AssistantLauncher

$AssistantSetHost = Join-Path $AssistantOutDir "Set Host IP - Symptomatologist Copilot (Assistant).bat"
@(
  '@echo off',
  'setlocal EnableExtensions',
  'cd /d %~dp0',
  'echo Enter the HOST PC IP address (Doctor PC), example: 192.168.1.50',
  'set /p HOST=HOST IP: ',
  'echo %HOST%>host.txt',
  'echo Saved to host.txt',
  'pause'
) | Set-Content -Encoding ascii $AssistantSetHost

$AssistantEdgeLoginBat = Join-Path $AssistantOutDir "Open Login Page - Symptomatologist Copilot (Assistant).bat"
@(
  '@echo off',
  'setlocal EnableExtensions',
  'set LOGIN_URL=http://192.168.1.8:8080/login/?next=assistant^&fresh=1',
  'set EDGE_EXE=',
  'if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe',
  'if "%EDGE_EXE%"=="" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe',
  'if "%EDGE_EXE%"=="" set EDGE_EXE=msedge.exe',
  'start "" "%EDGE_EXE%" "%LOGIN_URL%"',
  'echo Opening login page in Microsoft Edge: %LOGIN_URL%',
  'pause'
) | Set-Content -Encoding ascii $AssistantEdgeLoginBat

$AssistantLoginUrlIcon = Join-Path $AssistantOutDir "Symptomatologist Login Page (Assistant).url"
@(
  '[InternetShortcut]',
  'URL=http://192.168.1.8:8080/login/?next=assistant&fresh=1',
  'IconFile=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe',
  'IconIndex=0'
) | Set-Content -Encoding ascii $AssistantLoginUrlIcon

$AssistantShortcutPs1 = Join-Path $AssistantOutDir "create_desktop_shortcut_assistant.ps1"
@(
  '$ErrorActionPreference = "Stop"',
  '$WshShell = New-Object -ComObject WScript.Shell',
  '$Desktop = [Environment]::GetFolderPath("Desktop")',
  '$ShortcutPath = Join-Path $Desktop "Symptomatologist Copilot (Assistant).lnk"',
  '$Target = Join-Path (Get-Location) "Symptomatologist Copilot (Assistant).bat"',
  '$s = $WshShell.CreateShortcut($ShortcutPath)',
  '$s.TargetPath = $Target',
  '$s.WorkingDirectory = (Get-Location).Path',
  '$s.Save()',
  'Write-Host "Created: $ShortcutPath"',
  '$LoginShortcutPath = Join-Path $Desktop "Symptomatologist Login Page (Assistant).lnk"',
  '$LoginTarget = Join-Path (Get-Location) "Open Login Page - Symptomatologist Copilot (Assistant).bat"',
  '$s2 = $WshShell.CreateShortcut($LoginShortcutPath)',
  '$s2.TargetPath = $LoginTarget',
  '$s2.WorkingDirectory = (Get-Location).Path',
  '$s2.IconLocation = "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe,0"',
  '$s2.Save()',
  'Write-Host "Created: $LoginShortcutPath"'
) | Set-Content -Encoding utf8 $AssistantShortcutPs1

$AssistantShortcutBat = Join-Path $AssistantOutDir "Create Desktop Shortcut - Symptomatologist Copilot (Assistant).bat"
@(
  '@echo off',
  'setlocal',
  'cd /d %~dp0',
  'echo Creating Desktop shortcut: Symptomatologist Copilot (Assistant)...',
  'powershell -NoProfile -ExecutionPolicy Bypass -File ".\\create_desktop_shortcut_assistant.ps1"',
  'if %ERRORLEVEL% EQU 0 (',
  '  echo Done. You can now run it from your Desktop.',
  ') else (',
  '  echo Failed to create shortcut. You can create a shortcut manually to "Symptomatologist Copilot (Assistant).bat".',
  ')',
  'pause'
) | Set-Content -Encoding ascii $AssistantShortcutBat

$AssistantZip = "${AssistantOutDir}.zip"
Write-Host "Creating ASSISTANT ZIP: $AssistantZip" -ForegroundColor Cyan
Compress-WithRetry -SourcePath (Join-Path $AssistantOutDir "*") -DestinationPath $AssistantZip -Label "ASSISTANT ZIP"
