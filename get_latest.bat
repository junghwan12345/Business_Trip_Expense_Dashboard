@echo off
cd /d "%~dp0"

echo Downloading latest changes from GitHub...
git pull

echo.
echo Done! Your files are now up to date.
pause
