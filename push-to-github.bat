@echo off
setlocal
set SOURCE=C:\Users\stubb\OneDrive\Desktop\Vantage Search Group\vsg-deploy
set REPO=https://github.com/michealstubbs-ship-it/vantage-search-group-website.git
set WORK=C:\temp\vsg-push

echo ================================================
echo  VSG GitHub Push
echo ================================================
echo.

:: Step 1 — clean temp folder
echo [1/5] Preparing temp folder...
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"

:: Step 2 — clone existing repo into temp
echo [2/5] Cloning from GitHub...
git clone "%REPO%" "%WORK%"
if %errorlevel% neq 0 (
  echo ERROR: Clone failed. Make sure you are logged into GitHub in Git Bash.
  pause
  exit /b 1
)

:: Step 3 — robocopy all files from vsg-deploy into clone (skip .git)
echo [3/5] Copying updated files...
robocopy "%SOURCE%" "%WORK%" /E /XD ".git" /XF "push-to-github.bat" /NFL /NDL /NJH /NJS

:: Step 4 — commit
echo [4/5] Committing...
cd /d "%WORK%"
git config user.email "micheal.stubbs@gmail.com"
git config user.name "michealstubbs-ship-it"
git add -A
git commit -m "Dashboard v3: Today's Actions, Digest Editor, Hiring Signals, Appointment Triggers, Salary Benchmark, Outreach Performance, Candidate Check-in, Network Map"

:: Step 5 — push
echo [5/5] Pushing to GitHub...
git push origin main
if %errorlevel% neq 0 (
  echo Push failed, trying force push...
  git push origin main --force
)

echo.
echo ================================================
echo  Done! Netlify auto-deploys in about 1 minute.
echo  https://vantagesearchgroup.me
echo ================================================
pause
