@echo off
cd /d "%~dp0"
echo Starting 3D Storage Website v0.4.2...
if not exist node_modules (
  echo Installing packages...
  npm install
)
npm start
pause
