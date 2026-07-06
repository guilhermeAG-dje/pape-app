@echo off
cd /d "%~dp0"
py -m pip install --upgrade pip pyinstaller
py -m PyInstaller --onefile --noconsole --name pape_desktop ..\desktop_app\app.py
pause
