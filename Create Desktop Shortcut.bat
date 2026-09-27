@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'SQL Land.lnk'));" ^
  "$shortcut.TargetPath = (Join-Path (Get-Location) 'Start SQL Land.bat');" ^
  "$shortcut.WorkingDirectory = (Get-Location).Path;" ^
  "$shortcut.IconLocation = (Join-Path (Get-Location) 'SQL Land.ico') + ',0';" ^
  "$shortcut.Description = 'Start SQL Land';" ^
  "$shortcut.Save();" ^
  "Write-Host ('Added SQL Land to your desktop: ' + $shortcut.FullName)"
if errorlevel 1 (
  echo Could not create the shortcut.
) else (
  echo Double-click it any time to start SQL Land. Keep this folder where it is - the shortcut points here.
)
pause
