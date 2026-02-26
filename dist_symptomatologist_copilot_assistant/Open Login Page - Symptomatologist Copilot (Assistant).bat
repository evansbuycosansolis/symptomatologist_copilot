@echo off
setlocal EnableExtensions
set LOGIN_URL=http://192.168.1.8:8080/login/?next=assistant^&fresh=1
set EDGE_EXE=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if "%EDGE_EXE%"=="" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
if "%EDGE_EXE%"=="" set EDGE_EXE=msedge.exe
start "" "%EDGE_EXE%" "%LOGIN_URL%"
echo Opening login page in Microsoft Edge: %LOGIN_URL%
pause
