@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is niet gevonden.
  echo Installeer Node.js of start deze server via de meegeleverde Codex-runtime.
  pause
  exit /b 1
)
node server.js
pause
