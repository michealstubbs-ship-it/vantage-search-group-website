@echo off
set WORK=C:\temp\vsg-tomlfix
set SRC=C:\Users\stubb\OneDrive\Desktop\Vantage Search Group\vsg-deploy\netlify.toml

echo Cleaning temp...
if exist "%WORK%" rmdir /s /q "%WORK%"

echo Cloning...
git clone https://github.com/michealstubbs-ship-it/vantage-search-group-website.git "%WORK%"

echo Copying netlify.toml...
copy /Y "%SRC%" "%WORK%\netlify.toml"

echo Committing...
cd /d "%WORK%"
git config user.email "micheal.stubbs@gmail.com"
git config user.name "michealstubbs-ship-it"
git add netlify.toml
git commit -m "Fix: add qualify-leads timeout to netlify.toml"
git push origin main

echo.
echo Done! Netlify deploys in ~1 minute, then click Qualify All.
pause
