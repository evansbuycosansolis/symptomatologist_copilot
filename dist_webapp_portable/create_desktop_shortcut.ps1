$ErrorActionPreference = "Stop"
$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Symptomatologist Copilot.lnk"
$Target = Join-Path (Get-Location) "Symptomatologist Copilot.bat"
$Icon = Join-Path (Get-Location) "copilot_backend.exe"
$s = $WshShell.CreateShortcut($ShortcutPath)
$s.TargetPath = $Target
$s.WorkingDirectory = (Get-Location).Path
$s.IconLocation = "$Icon,0"
$s.Save()
Write-Host "Created: $ShortcutPath"
