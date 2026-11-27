@echo off
rem Windows wrapper for apk-triage.ps1 (no WSL, no Git Bash)
rem Usage: apk-triage.bat app.apk [outdir]
chcp 65001 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apk-triage.ps1" %*
set "RC=%errorlevel%"
chcp 1251 >nul 2>&1
exit /b %RC%
