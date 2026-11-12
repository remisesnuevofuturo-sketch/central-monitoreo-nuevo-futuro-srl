@echo off
cd /d "%~dp0"
if not defined NF_TOKEN set /p NF_TOKEN=Clave de telemetria existente: 
if not defined NF_ADMIN_TOKEN set /p NF_ADMIN_TOKEN=Clave privada de oficina (diferente): 
node server.js
pause
