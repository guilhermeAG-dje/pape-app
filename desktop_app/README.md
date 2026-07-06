Desktop wrapper for Pape

This Windows wrapper runs a local web server and opens the Pape app in your browser so it can be used like a desktop-installed app.

How to run locally
1. Install Python 3.11+.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run:
   ```bash
   python desktop_app/app.py
   ```

How to build an EXE for Windows
1. Install PyInstaller:
   ```bash
   py -m pip install --upgrade pip pyinstaller
   ```
2. Build the executable:
   ```bash
   py -m PyInstaller --onefile --name pape_desktop desktop_app/app.py
   ```
3. The EXE will be created in the dist folder.

Install on PC
- Copy the generated EXE to a folder such as Program Files\Pape.
- Create a shortcut on the Desktop.
- Double-click the shortcut to start the app.
