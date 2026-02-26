@echo off
setlocal

set "URL=http://192.168.1.8:8080/assistant/"
set "EDGE_EXE="

where msedge >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  set "EDGE_EXE=msedge"
)

if "%EDGE_EXE%"=="" if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
)
if "%EDGE_EXE%"=="" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if "%EDGE_EXE%"=="" (
  echo Microsoft Edge was not found. Opening with default browser instead...
  start "" "%URL%"
  exit /b 0
)

start "" "%EDGE_EXE%" "%URL%"
