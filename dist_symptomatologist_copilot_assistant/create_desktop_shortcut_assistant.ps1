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
$LoginShortcutPath = Join-Path $Desktop "Symptomatologist Login Page (Assistant).lnk"
$LoginTarget = Join-Path (Get-Location) "Open Login Page - Symptomatologist Copilot (Assistant).bat"
$s2 = $WshShell.CreateShortcut($LoginShortcutPath)
$s2.TargetPath = $LoginTarget
$s2.WorkingDirectory = (Get-Location).Path
$s2.IconLocation = "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe,0"
$s2.Save()
Write-Host "Created: $LoginShortcutPath"
