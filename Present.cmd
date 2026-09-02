@echo off
rem Double-click to start the presenter. Any argument is passed through, so a
rem deck can also be dragged onto this file to open it directly.
setlocal
python "%~dp0tools\present.py" %*
if errorlevel 1 (
  echo.
  echo Could not start. Is Python 3 on your PATH?
  pause
)
