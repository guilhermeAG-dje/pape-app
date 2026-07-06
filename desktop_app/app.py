import os
import threading
import time
import sqlite3
import webbrowser
from datetime import datetime
from flask import Flask, render_template_string, jsonify
from werkzeug.serving import make_server

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DB_PATH = os.path.join(ROOT, 'database.db')
HOST = '127.0.0.1'
PORT = 5001

app = Flask(__name__)


@app.route('/')
def index():
    return render_template_string('<html><body><h1>Pape Desktop</h1><p>Aplicação desktop iniciada localmente.</p></body></html>')


@app.route('/api/desktop/check')
def check():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, medicine_name, dose, time_hhmm FROM medication_reminder WHERE is_active = 1")
    rows = cur.fetchall()
    conn.close()
    now = datetime.now().strftime('%H:%M')
    due = [
        {'id': r[0], 'medicine_name': r[1], 'dose': r[2], 'time_hhmm': r[3]}
        for r in rows if r[3] == now
    ]
    return jsonify({'ok': True, 'due': due, 'now': now})


def run_server():
    server = make_server(HOST, PORT, app)
    server.serve_forever()


def launch_browser():
    try:
        webbrowser.open(f'http://{HOST}:{PORT}/')
    except Exception:
        pass


if __name__ == '__main__':
    threading.Thread(target=run_server, daemon=True).start()
    print(f'Pape desktop wrapper running on http://{HOST}:{PORT}')
    time.sleep(1)
    launch_browser()
    while True:
        time.sleep(5)
