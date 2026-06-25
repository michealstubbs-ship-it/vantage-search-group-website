@echo off
cd /d "%~dp0"
echo ================================================
echo  Deploying to vsg-bd-dashboard.netlify.app
echo ================================================
echo.
echo Installing Netlify CLI...
call npm install -g netlify-cli 2>nul
echo.
echo Deploying...
netlify deploy --dir . --prod --site da41fc57-1530-465c-aaf3-3ed5315667ac
echo.
echo ================================================
echo  Done! Check https://vsg-bd-dashboard.netlify.app
echo ================================================
pause
