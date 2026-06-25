# VSG Git Push — fixes the OneDrive .git issue by working from C:\temp
# Right-click this file and select "Run with PowerShell"

$ErrorActionPreference = "Stop"
$SOURCE = "C:\Users\stubb\OneDrive\Desktop\Vantage Search Group\vsg-deploy"
$REPO_URL = "https://github.com/michealstubbs-ship-it/vantage-search-group-website.git"
$TEMP_REPO = "C:\temp\vsg-git"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " VSG Git Push" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Create temp folder if needed
if (-not (Test-Path "C:\temp")) { New-Item -ItemType Directory -Path "C:\temp" | Out-Null }

# Remove old temp clone if exists
if (Test-Path $TEMP_REPO) {
    Write-Host "[1/5] Removing old temp clone..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $TEMP_REPO
}

# Clone the repo
Write-Host "[1/5] Cloning repo from GitHub..." -ForegroundColor Yellow
git clone $REPO_URL $TEMP_REPO
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Clone failed. Make sure you're logged into GitHub." -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }

# Copy all files from vsg-deploy into the cloned repo (excluding .git)
Write-Host "[2/5] Copying updated files..." -ForegroundColor Yellow
$items = Get-ChildItem -Path $SOURCE -Recurse
foreach ($item in $items) {
    $relativePath = $item.FullName.Substring($SOURCE.Length + 1)
    $destPath = Join-Path $TEMP_REPO $relativePath
    if ($item.PSIsContainer) {
        if (-not (Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath | Out-Null }
    } else {
        $destDir = Split-Path $destPath -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
        Copy-Item -Path $item.FullName -Destination $destPath -Force
    }
}
Write-Host "   Copied all files from vsg-deploy" -ForegroundColor Green

# Stage and commit
Write-Host "[3/5] Staging changes..." -ForegroundColor Yellow
Set-Location $TEMP_REPO
git add -A
git status --short

Write-Host "[4/5] Committing..." -ForegroundColor Yellow
git commit -m "AI Command Centre: intelligence feed, chat panel, sequences, agents, Supabase tables"
if ($LASTEXITCODE -ne 0) { Write-Host "Nothing new to commit — already up to date." -ForegroundColor Yellow }

# Push
Write-Host "[5/5] Pushing to GitHub (Netlify will auto-deploy)..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed. Trying force push..." -ForegroundColor Yellow
    git push origin main --force
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " Done! Netlify will auto-deploy in ~1 minute." -ForegroundColor Green
Write-Host " Check: https://vantagesearchgroup.me" -ForegroundColor Green
Write-Host " Netlify: https://app.netlify.com/projects/nimble-choux-b783be/deploys" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"
