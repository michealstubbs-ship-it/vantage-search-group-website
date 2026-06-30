@echo off
set WORK=C:\temp\vsg-dashfix
set SRC=C:\Users\stubb\OneDrive\Desktop\Vantage Search Group\vsg-deploy\bd-dashboard.html

echo Cleaning temp...
if exist "%WORK%" rmdir /s /q "%WORK%"

echo Cloning...
git clone https://github.com/michealstubbs-ship-it/vantage-search-group-website.git "%WORK%"

echo Copying fixed file...
copy /Y "%SRC%" "%WORK%\bd-dashboard.html"

echo Committing...
cd /d "%WORK%"
git config user.email "micheal.stubbs@gmail.com"
git config user.name "michealstubbs-ship-it"
git add bd-dashboard.html
git commit -m "Fix: complete bd-dashboard.html - restore closing script/body/html tags"
git push origin main

echo.
echo Done!
pause
