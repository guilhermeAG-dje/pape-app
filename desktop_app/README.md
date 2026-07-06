Desktop wrapper for Pape

This small Windows desktop app opens the Pape web app and shows a full-screen alarm window when a reminder is due.

How to run
1. Install Python 3.11+.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run:
   ```bash
   python desktop_app/app.py
   ```

How to build an EXE
```bash
pip install pyinstaller
pyinstaller --onefile --noconsole --add-data "../templates;templates" --add-data "../static;static" desktop_app/app.py
```
