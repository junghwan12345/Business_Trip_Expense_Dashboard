@echo off
cd /d "%~dp0"

echo Removing old .git folder...
rmdir /s /q .git 2>nul

echo Step 1: git init
git init
git branch -M main

echo Step 2: git config
git config user.name "junghwan"
git config user.email "a01051025885@gmail.com"

echo Step 3: git add
git add .

echo Step 4: git commit
git commit -m "initial commit"

echo Step 5: git remote
git remote add origin https://github.com/junghwan12345/personal-dashboard.git

echo Step 6: git push
git push -u origin main

echo Done!
pause
