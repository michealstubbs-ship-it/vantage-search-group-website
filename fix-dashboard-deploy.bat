@echo off
setlocal
set WORK=C:\temp\vsg-htmlfix
echo Cloning from GitHub...
if exist "%WORK%" rmdir /s /q "%WORK%"
git clone https://github.com/michealstubbs-ship-it/vantage-search-group-website.git "%WORK%"
if %errorlevel% neq 0 (echo ERROR: Clone failed. & pause & exit /b 1)

echo Appending missing closing lines to bd-dashboard.html...
cd /d "%WORK%"
(echo _digest',JSON.stringify(saved^)^);) >> bd-dashboard.html
(echo  if(typeof loadTriggers==='function'^)setTimeout(loadTriggers,500^);) >> bd-dashboard.html
(echo }^) >> bd-dashboard.html
echo. >> bd-dashboard.html
(echo // checkNewConnections removed -- new connections handled by fetchAndRenderPendingWelcomes^(^) separately) >> bd-dashboard.html
(echo ^</script^>) >> bd-dashboard.html
(echo ^</body^>) >> bd-dashboard.html
(echo ^</html^>) >> bd-dashboard.html

git config user.email "micheal.stubbs@gmail.com"
git config user.name "michealstubbs-ship-it"
git add bd-dashboard.html
git commit -m "Fix: complete bd-dashboard.html — was missing closing </script></body></html>"
git push origin main
echo.
echo ================================================
echo  Done! Netlify will deploy in ~1 minute.
echo ================================================
pause
