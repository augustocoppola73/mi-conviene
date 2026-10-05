@echo off
rem Doppio clic per avviare Mi Conviene nel browser (http://localhost:8001)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\avvia.ps1"
if errorlevel 1 pause
