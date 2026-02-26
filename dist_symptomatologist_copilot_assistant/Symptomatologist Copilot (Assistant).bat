@echo off
setlocal EnableExtensions
cd /d %~dp0
set HOST_FILE=host.txt
set HOST=
if exist "%HOST_FILE%" (
  set /p HOST=<"%HOST_FILE%"
)
if "%HOST%"=="" (
  echo Enter the HOST PC IP address (Doctor PC), example: 192.168.1.50
  set /p HOST=HOST IP: 
  echo %HOST%>"%HOST_FILE%"
)
start "" "http://%HOST%:8080/assistant/"
echo Opening Assistant portal at http://%HOST%:8080/assistant/
echo If it does not load, check the HOST PC is running and firewall allows port 8080.
echo Note: all data is stored on the HOST (Doctor) PC only.
pause
