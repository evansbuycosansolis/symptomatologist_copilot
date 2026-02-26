@echo off
setlocal EnableExtensions
cd /d %~dp0
echo Enter the HOST PC IP address (Doctor PC), example: 192.168.1.50
set /p HOST=HOST IP: 
echo %HOST%>host.txt
echo Saved to host.txt
pause
