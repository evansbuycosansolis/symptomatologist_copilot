$ErrorActionPreference = "Stop"
$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Symptomatologist Copilot (Assistant).lnk"
$Target = Join-Path (Get-Location) "Symptomatologist Copilot (Assistant).bat"
$s = $WshShell.CreateShortcut($ShortcutPath)
$s.TargetPath = $Target
$s.WorkingDirectory = (Get-Location).Path
$s.Save()
Write-Host "Created: $ShortcutPath"
