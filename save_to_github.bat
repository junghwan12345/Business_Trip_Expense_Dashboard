@echo off
cd /d "%~dp0"

git add .

for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set DATE=%%a-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set TIME=%%a:%%b

git commit -m "update %DATE% %TIME%"
git push

echo.
echo Saved! Check: https://github.com/junghwan12345/personal-dashboard
pause
