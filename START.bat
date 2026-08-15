@echo off
title HSC Overlay
cd /d "%~dp0"
echo.
echo   Starting HSC Overlay...
echo   Control panel : http://localhost:8787/admin
echo   Overlay (OBS) : http://localhost:8787/overlay
echo.
echo   Leave this window open for the whole broadcast.
echo.
start "" http://localhost:8787/admin
node server\index.js
pause
