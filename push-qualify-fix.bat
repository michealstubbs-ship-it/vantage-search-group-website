@echo off
set WORK=C:\temp\vsg-qualfix
set SRC=C:\Users\stubb\OneDrive\Desktop\Vantage Search Group\vsg-deploy\netlify\functions\qualify-leads.js

echo Cleaning temp...
if exist "%WORK%" rmdir /s /q "%WORK%"

echo Cloning...
git clone https://github.com/michealstubbs-ship-it/vantage-search-group-website.git "%WORK%"

echo Copying qualify-leads.js...
copy /Y "%SRC%" "%WORK%\netlify\functions\qualify-leads.js"

echo Committing...
cd /d "%WORK%"
git config user.email "micheal.stubbs@gmail.com"
git config user.name "michealstubbs-ship-it"
git add netlify/functions/qualify-leads.js
git commit -m "Fix: hardcode Supabase anon key fallback in qualify-leads.js"
git push origin main

echo.
echo Done! Netlify deploys in ~1 minute, then click Qualify All.
pause
