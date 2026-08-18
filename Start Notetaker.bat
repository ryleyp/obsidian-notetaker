@echo off
rem Double-click this file on Windows to start Notetaker and open the browser.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-notetaker-local.ps1"
if errorlevel 1 (
  echo.
  echo Notetaker could not start. The message above explains why.
  pause
)
