@echo off
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq auto_save*" 2>nul
powershell -Command "Get-Process powershell | Where-Object {$_.CommandLine -like '*auto_save*'} | Stop-Process -Force" 2>nul
echo Auto save stopped.
pause
