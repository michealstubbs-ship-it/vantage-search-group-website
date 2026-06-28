@echo off
echo ================================================
echo  VSG Deploy — pushing to GitHub + Netlify
echo ================================================
echo.

cd /d "%~dp0"

echo [1/4] Staging all changes...
git add -A

echo [2/4] Committing...
git commit -m "AI Command Centre: intelligence feed, chat panel, sequences, 3 agents"

echo [3/4] Pushing to GitHub (Netlify will auto-deploy)...
git push origin main

echo [4/4] Triggering Netlify deploy directly...
npx -y @netlify/mcp@latest --site-id 2c94b04a-3d24-4435-8a26-1aad0171354a --proxy-path "https://netlify-mcp.netlify.app/proxy/eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..eKWVkYRbm4KuW0iU.UVPqww2fc8Ziljyjd3DoF9h5OU4QbLuCQp94RUtMG4Zd9yOZGgMLdjIgy5QYNutgp03mC7PPViHIYWsiOrazfp03rpP9n4nZr_r-ezmUYbtJbiEByVE8rUxbcM3I_Im_H0HvTq1dO6b4o9JeoodtKgSvgWQw2hjCnEZoW8ru7A5WFeEC72yjvWZFqK0xDbAVFOCTLsPVv-NvL6Nry6V2KEv-JL19srvbxFw8pdMuawgMmadILxMRoEgHaWMGyQoNOi0mZ6fLhrIMcplqlysWEoXH8fH6tBFia31Ro-T65mxL1InSjhMwXNmGgAA543R55QhkvtzuJ1GTFF4nJl39B9ZFXTjF-Dq2sf4XlesJ_-SNKM8KFzMs_t-M5KVtYRP5azv8YE4I.UfmMd5Qmcptzr8jIr6VnyA" --no-wait

echo.
echo ================================================
echo  Done! Check https://vantagesearchgroup.me
echo  Netlify dashboard: https://app.netlify.com/projects/nimble-choux-b783be
echo ================================================
pause
