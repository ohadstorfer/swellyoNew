@echo off
REM Script to restart dev server with cleared cache on Windows

echo Stopping any running Expo processes...
taskkill /F /IM node.exe 2>nul || echo No node processes found

echo Clearing Expo cache and restarting...
npx expo start --clear

