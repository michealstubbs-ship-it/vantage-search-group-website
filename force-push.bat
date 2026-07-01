@echo off
setlocal
set SOURCE=C:\Users\stubb\OneDrive\Desktop\Vantage Search Group\vsg-deploy
set REPO=https://github.com/michealstubbs-ship-it/vantage-search-group-website.git
set WORK=C:\temp\vsg-push

echo ================================================
echo  VSG Force Push (xcopy — ignores timestamps)
echo ================================================

:: Step 1 — clean temp folder
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"

:: Step 2 — clone
echo [1/4] Cloning...
git clone "%REPO%" "%WORK%"
if %errorlevel% neq 0 (echo ERROR: Clone failed. & pause & exit /b 1)

:: Step 3 — xcopy everything (no timestamp comparison)
echo [2/4] Copying files...
xcopy "%SOURCE%\*" "%WORK%\" /E /Y /I /EXCLUDE:%TEMP%\xcopy-exclude.txt 2>nul
echo .git> "%TEMP%\xcopy-exclude.txt"
xcopy "%SOURCE%\*" "%WORK%\" /E /Y /I

:: Step 4 — commit and push
echo [3/4] Committing...
cd /d "%WORK%"
git config user.email "micheal.stubbs@gmail.com"
git config user.name "michealstubbs-ship-it"
git add -A
git commit -m "Add general Annie brainstorm mode — cmd palette Ask Annie now works"
if %errorlevel% neq 0 (echo Nothing to commit. & goto done)

echo [4/4] Pushing...
git push origin main
if %errorlevel% neq 0 (git push origin main --force)

:done
echo.
echo ================================================
echo  Done! Netlify auto-deploys in ~1 minute.
echo ================================================
pause
