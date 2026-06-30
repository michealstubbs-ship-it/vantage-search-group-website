$work = "C:\temp\vsg-htmlfix"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }

Write-Host "Cloning from GitHub..."
git clone "https://github.com/michealstubbs-ship-it/vantage-search-group-website.git" $work

Set-Location $work

Write-Host "Appending missing closing lines..."
$missing = @(
    "_digest',JSON.stringify(saved));",
    " if(typeof loadTriggers==='function')setTimeout(loadTriggers,500);",
    "}",
    "",
    "// checkNewConnections removed -- new connections handled by fetchAndRenderPendingWelcomes() separately",
    "</script>",
    "</body>",
    "</html>"
)
Add-Content -Path "bd-dashboard.html" -Value $missing -Encoding UTF8

Write-Host "Lines now: $((Get-Content bd-dashboard.html).Count)"

git config user.email "micheal.stubbs@gmail.com"
git config user.name "michealstubbs-ship-it"
git add bd-dashboard.html
git commit -m "Fix: complete bd-dashboard.html — missing closing script/body/html tags"
git push origin main

Write-Host ""
Write-Host "================================================"
Write-Host " Done! Netlify will deploy in about 1 minute."
Write-Host "================================================"
Read-Host "Press Enter to close"
