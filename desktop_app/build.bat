@echo off
cd /d "%~dp0"
py -m pip install --upgrade pip pyinstaller
py -m PyInstaller --onefile --name pape_desktop ..\desktop_app\app.py
if exist dist\pape_desktop.exe (
  echo Build complete: dist\pape_desktop.exe
) else (
  echo Build failed.
)
pause
