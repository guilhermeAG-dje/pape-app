# -*- coding: utf-8 -*-
from flask import Flask, render_template, request, redirect, url_for, session, send_file, jsonify, send_from_directory, make_response, flash
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
import os
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from functools import wraps, lru_cache
import hmac
import secrets
import threading
import ipaddress
try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None
from datetime import datetime, timedelta
import csv
import io
import re
import shutil
from urllib.parse import urlparse, unquote

if load_dotenv:
    load_dotenv()

app = Flask(__name__)


def get_runtime_data_dir():
    render_disk_path = (os.getenv('RENDER_DISK_PATH') or '').strip()
    if render_disk_path:
        data_dir = os.path.join(render_disk_path, 'pape')
    else:
        data_dir = app.instance_path
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


def resolve_secret_key():
    configured = (os.getenv('SECRET_KEY') or '').strip()
    if configured:
        return configured

    secret_path = os.path.join(get_runtime_data_dir(), 'secret_key.txt')
    try:
        if os.path.exists(secret_path):
            with open(secret_path, 'r', encoding='utf-8') as handle:
                existing = handle.read().strip()
            if existing:
                return existing

        generated = secrets.token_urlsafe(48)
        with open(secret_path, 'w', encoding='utf-8') as handle:
            handle.write(generated)
        return generated
    except Exception:
        return secrets.token_urlsafe(48)


def resolve_database_uri():
    configured = (os.getenv('DATABASE_URL') or '').strip()
    if configured:
        if configured.startswith('postgres://'):
            return f"postgresql://{configured[len('postgres://'):]}"
        return configured

    db_path = (os.getenv('DB_PATH') or '').strip()
    if db_path:
        if not os.path.isabs(db_path):
            db_path = os.path.join(get_runtime_data_dir(), db_path)
    else:
        db_path = os.path.join(get_runtime_data_dir(), 'database.db')

    db_path = os.path.abspath(db_path)
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    return f"sqlite:///{db_path.replace(os.sep, '/')}"
app.secret_key = resolve_secret_key()
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', '0') == '1'
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_UPLOAD_MB', '10')) * 1024 * 1024
if not (os.getenv('SECRET_KEY') or '').strip():
    app.logger.warning('SECRET_KEY ausente no ambiente. Foi gerada uma chave local para esta instancia.')

# --- ConfiguraÃ§Ã£o Database ---
app.config['SQLALCHEMY_DATABASE_URI'] = resolve_database_uri()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_pre_ping': True,
    'pool_recycle': 300
}
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=30)

db = SQLAlchemy(app)

app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

ADMIN_USER = os.getenv('ADMIN_USER', 'admin')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin123')
ADMIN_MAX_FAILS = int(os.getenv('ADMIN_MAX_FAILS', '5'))
ADMIN_LOCK_MINUTES = int(os.getenv('ADMIN_LOCK_MINUTES', '10'))
ADMIN_IP_MAX_FAILS = int(os.getenv('ADMIN_IP_MAX_FAILS', '10'))
ADMIN_IP_WINDOW_MINUTES = int(os.getenv('ADMIN_IP_WINDOW_MINUTES', '10'))
ADMIN_IP_LOCK_MINUTES = int(os.getenv('ADMIN_IP_LOCK_MINUTES', '15'))
PUBLIC_PIN = os.getenv('PUBLIC_PIN', '').strip()
TRUST_PROXY_HEADERS = os.getenv('TRUST_PROXY_HEADERS', '0') == '1'
_LOGIN_ATTEMPTS_BY_IP = {}
_LOGIN_ATTEMPTS_LOCK = threading.Lock()
FEEDBACK_RATE_LIMIT_SECONDS = int(os.getenv('FEEDBACK_RATE_LIMIT_SECONDS', '2'))
_LAST_FEEDBACK_BY_IP = {}
_FEEDBACK_LOCK = threading.Lock()
ALERT_RATE_LIMIT_SECONDS = int(os.getenv('ALERT_RATE_LIMIT_SECONDS', '30'))
_LAST_ALERT_BY_IP = {}
_ALERT_LOCK = threading.Lock()
MAX_CSV_IMPORT_ROWS = int(os.getenv('MAX_CSV_IMPORT_ROWS', '5000'))

WEEKDAY_PT = {
    'Monday': 'Segunda-feira',
    'Tuesday': 'Terca-feira',
    'Wednesday': 'Quarta-feira',
    'Thursday': 'Quinta-feira',
    'Friday': 'Sexta-feira',
    'Saturday': 'Sabado',
    'Sunday': 'Domingo'
}

def weekday_pt(name):
    return WEEKDAY_PT.get(name, name)


def get_client_ip():
    if TRUST_PROXY_HEADERS:
        forwarded = (request.headers.get('X-Forwarded-For') or '').strip()
        if forwarded:
            raw = forwarded.split(',')[0].strip()
            try:
                return str(ipaddress.ip_address(raw))
            except Exception:
                pass
    raw = (request.remote_addr or '').strip()
    try:
        return str(ipaddress.ip_address(raw))
    except Exception:
        return 'unknown'


def get_csrf_token():
    token = session.get('csrf_token')
    if not token:
        token = secrets.token_urlsafe(32)
        session['csrf_token'] = token
    return token


@app.context_processor
def inject_csrf_token():
    return {'csrf_token': get_csrf_token}


def verify_csrf():
    session_token = (session.get('csrf_token') or '').strip()
    request_token = (request.form.get('csrf_token') or request.headers.get('X-CSRF-Token') or '').strip()
    return bool(session_token and request_token and hmac.compare_digest(session_token, request_token))


def is_same_origin_request():
    expected_origin = (request.host_url or '').rstrip('/')
    for header_name in ('Origin', 'Referer'):
        raw = (request.headers.get(header_name) or '').strip()
        if not raw:
            continue
        try:
            parsed = urlparse(raw)
            incoming_origin = f'{parsed.scheme}://{parsed.netloc}'.rstrip('/')
        except Exception:
            continue
        return bool(
            expected_origin and incoming_origin
            and hmac.compare_digest(incoming_origin, expected_origin)
        )
    return False


def verify_public_write():
    return verify_csrf() or is_same_origin_request()


def _ip_rate_key(scope):
    return f'{scope}:{get_client_ip()}'


def ip_rate_limit_seconds_left(scope):
    key = _ip_rate_key(scope)
    now = datetime.utcnow()
    with _LOGIN_ATTEMPTS_LOCK:
        state = _LOGIN_ATTEMPTS_BY_IP.get(key)
        if not state:
            return 0
        lock_until = state.get('lock_until')
        if lock_until and now < lock_until:
            return int((lock_until - now).total_seconds())
        window_start = state.get('window_start')
        if (lock_until and now >= lock_until) or (window_start and (now - window_start) > timedelta(minutes=ADMIN_IP_WINDOW_MINUTES)):
            _LOGIN_ATTEMPTS_BY_IP.pop(key, None)
        return 0


def register_ip_failed_attempt(scope):
    key = _ip_rate_key(scope)
    now = datetime.utcnow()
    with _LOGIN_ATTEMPTS_LOCK:
        state = _LOGIN_ATTEMPTS_BY_IP.get(key)
        if not state or (now - state.get('window_start', now)) > timedelta(minutes=ADMIN_IP_WINDOW_MINUTES):
            state = {'count': 0, 'window_start': now, 'lock_until': None}
            _LOGIN_ATTEMPTS_BY_IP[key] = state
        state['count'] = int(state.get('count', 0)) + 1
        if state['count'] >= ADMIN_IP_MAX_FAILS:
            state['count'] = 0
            state['window_start'] = now
            state['lock_until'] = now + timedelta(minutes=ADMIN_IP_LOCK_MINUTES)
            return True
        return False


def clear_ip_failed_attempts(scope):
    key = _ip_rate_key(scope)
    with _LOGIN_ATTEMPTS_LOCK:
        _LOGIN_ATTEMPTS_BY_IP.pop(key, None)


@app.after_request
def apply_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if request.path.startswith('/admin_2026'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    return response


def parse_iso_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def feedback_rate_limited():
    if FEEDBACK_RATE_LIMIT_SECONDS <= 0:
        return False
    ip = get_client_ip()
    now = datetime.utcnow()
    with _FEEDBACK_LOCK:
        if len(_LAST_FEEDBACK_BY_IP) > 5000:
            cutoff = now - timedelta(hours=1)
            for key, ts in list(_LAST_FEEDBACK_BY_IP.items()):
                if ts < cutoff:
                    _LAST_FEEDBACK_BY_IP.pop(key, None)
        last = _LAST_FEEDBACK_BY_IP.get(ip)
        if last and (now - last).total_seconds() < FEEDBACK_RATE_LIMIT_SECONDS:
            return True
        _LAST_FEEDBACK_BY_IP[ip] = now
        return False


def alert_rate_limited():
    if ALERT_RATE_LIMIT_SECONDS <= 0:
        return False
    ip = get_client_ip()
    now = datetime.utcnow()
    with _ALERT_LOCK:
        if len(_LAST_ALERT_BY_IP) > 5000:
            cutoff = now - timedelta(hours=1)
            for key, ts in list(_LAST_ALERT_BY_IP.items()):
                if ts < cutoff:
                    _LAST_ALERT_BY_IP.pop(key, None)
        last = _LAST_ALERT_BY_IP.get(ip)
        if last and (now - last).total_seconds() < ALERT_RATE_LIMIT_SECONDS:
            return True
        _LAST_ALERT_BY_IP[ip] = now
        return False


@app.errorhandler(413)
def request_too_large(_err):
    if request.path.startswith('/api/'):
        return jsonify({'ok': False, 'message': 'Ficheiro demasiado grande para processamento.'}), 413
    return 'Ficheiro demasiado grande.', 413


# --- Modelos ---
class Feedback(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    grau_satisfacao = db.Column(db.String(20), nullable=False)
    data = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    hora = db.Column(db.String(8), nullable=False)   # HH:MM:SS
    dia_semana = db.Column(db.String(20), nullable=False)


class AdminSetting(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, default='admin')
    password_hash = db.Column(db.String(255), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    action = db.Column(db.String(80), nullable=False)
    admin_user = db.Column(db.String(80), nullable=True)
    ip = db.Column(db.String(80), nullable=True)
    detail = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class MedicationReminder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patient.id'), nullable=True)
    patient_name = db.Column(db.String(100), nullable=False)
    medicine_name = db.Column(db.String(120), nullable=False)
    dose = db.Column(db.String(80), nullable=False)
    time_hhmm = db.Column(db.String(5), nullable=False)  # HH:MM
    # Multiple daily times for the same medicine (CSV: "08:00,14:00,20:00").
    times_csv = db.Column(db.String(64), nullable=False, default='')
    weekdays = db.Column(db.String(32), nullable=False, default='0,1,2,3,4,5,6')
    schedule_mode = db.Column(db.String(16), nullable=False, default='daily')
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    stock_count = db.Column(db.Integer, nullable=True)
    stock_low_threshold = db.Column(db.Integer, nullable=True)
    color = db.Column(db.String(16), nullable=False, default='teal')
    pill_image_path = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class MedicationLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patient.id'), nullable=True)
    reminder_id = db.Column(db.Integer, db.ForeignKey('medication_reminder.id'), nullable=True)
    medicine_name = db.Column(db.String(120), nullable=False)
    dose = db.Column(db.String(80), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='taken')
    scheduled_date = db.Column(db.String(10), nullable=True)  # YYYY-MM-DD
    scheduled_time_hhmm = db.Column(db.String(5), nullable=True)  # HH:MM
    late_minutes = db.Column(db.Integer, nullable=True)
    confirmed_at = db.Column(db.DateTime, default=datetime.utcnow)


class AppConfig(db.Model):
    key = db.Column(db.String(80), primary_key=True)
    value = db.Column(db.String(255), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Patient(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    display_name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def _sqlite_has_column(table, column):
    try:
        rows = db.session.execute(db.text(f'PRAGMA table_info({table})')).fetchall()
        return any(r[1] == column for r in rows)
    except Exception:
        return False


def ensure_sqlite_schema():
    # Lightweight migrations for SQLite without Alembic.
    if not str(app.config.get('SQLALCHEMY_DATABASE_URI', '')).startswith('sqlite'):
        return

    # medication_reminder
    if not _sqlite_has_column('medication_reminder', 'patient_id'):
        db.session.execute(db.text("ALTER TABLE medication_reminder ADD COLUMN patient_id INTEGER"))
    if not _sqlite_has_column('medication_reminder', 'times_csv'):
        db.session.execute(db.text("ALTER TABLE medication_reminder ADD COLUMN times_csv VARCHAR(64) NOT NULL DEFAULT ''"))
    if not _sqlite_has_column('medication_reminder', 'stock_count'):
        db.session.execute(db.text("ALTER TABLE medication_reminder ADD COLUMN stock_count INTEGER"))
    if not _sqlite_has_column('medication_reminder', 'stock_low_threshold'):
        db.session.execute(db.text("ALTER TABLE medication_reminder ADD COLUMN stock_low_threshold INTEGER"))
    if not _sqlite_has_column('medication_reminder', 'color'):
        db.session.execute(db.text("ALTER TABLE medication_reminder ADD COLUMN color VARCHAR(16) NOT NULL DEFAULT 'teal'"))
    if not _sqlite_has_column('medication_reminder', 'schedule_mode'):
        db.session.execute(db.text("ALTER TABLE medication_reminder ADD COLUMN schedule_mode VARCHAR(16) NOT NULL DEFAULT 'daily'"))
    if not _sqlite_has_column('medication_reminder', 'pill_image_path'):
        db.session.execute(db.text("ALTER TABLE medication_reminder ADD COLUMN pill_image_path VARCHAR(255)"))

    # medication_log
    if not _sqlite_has_column('medication_log', 'patient_id'):
        db.session.execute(db.text("ALTER TABLE medication_log ADD COLUMN patient_id INTEGER"))
    if not _sqlite_has_column('medication_log', 'scheduled_date'):
        db.session.execute(db.text("ALTER TABLE medication_log ADD COLUMN scheduled_date VARCHAR(10)"))
    if not _sqlite_has_column('medication_log', 'scheduled_time_hhmm'):
        db.session.execute(db.text("ALTER TABLE medication_log ADD COLUMN scheduled_time_hhmm VARCHAR(5)"))
    if not _sqlite_has_column('medication_log', 'late_minutes'):
        db.session.execute(db.text("ALTER TABLE medication_log ADD COLUMN late_minutes INTEGER"))

    # Create a default patient and attach existing rows that have no patient_id yet.
    if Patient.query.count() == 0:
        p = Patient(display_name='Utente')
        db.session.add(p)
        db.session.commit()
    default_patient = Patient.query.order_by(Patient.id.asc()).first()
    if default_patient:
        try:
            db.session.execute(db.text("UPDATE medication_reminder SET patient_id = :pid WHERE patient_id IS NULL"), {'pid': default_patient.id})
            db.session.execute(db.text("UPDATE medication_log SET patient_id = :pid WHERE patient_id IS NULL"), {'pid': default_patient.id})
        except Exception:
            pass

    db.session.commit()
    ensure_sqlite_indexes()


def ensure_sqlite_indexes():
    # Create helpful indexes for high-frequency query paths.
    try:
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_feedback_data ON feedback (data)"))
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_feedback_data_hora ON feedback (data, hora)"))
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_med_reminder_active_patient ON medication_reminder (is_active, patient_id)"))
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_med_log_sched_patient ON medication_log (scheduled_date, patient_id)"))
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_med_log_confirmed_patient ON medication_log (confirmed_at, patient_id)"))
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_med_log_reminder_time ON medication_log (reminder_id, scheduled_time_hhmm)"))
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_audit_action_detail ON audit_log (action, detail)"))
        db.session.execute(db.text("CREATE INDEX IF NOT EXISTS idx_patient_name ON patient (display_name)"))
        db.session.commit()
    except Exception:
        db.session.rollback()

with app.app_context():
    db.create_all()
    ensure_sqlite_schema()


def admin_logged_in():
    return session.get('admin_logged_in') is True


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not admin_logged_in():
            return redirect(url_for('admin_login'))
        return fn(*args, **kwargs)
    return wrapper


def parse_date_ymd(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None


def parse_month_ym(value):
    try:
        return datetime.strptime(value, "%Y-%m").date()
    except Exception:
        return None


def count_by_grau(query):
    muito = query.filter_by(grau_satisfacao='muito_satisfeito').count()
    satis = query.filter_by(grau_satisfacao='satisfeito').count()
    insatis = query.filter_by(grau_satisfacao='insatisfeito').count()
    total = muito + satis + insatis
    pct_muito = round((muito / total * 100), 1) if total else 0
    pct_satis = round((satis / total * 100), 1) if total else 0
    pct_insatis = round((insatis / total * 100), 1) if total else 0
    score = round(((muito * 2 + satis) / (total * 2)) * 100, 1) if total else 0
    return {
        'muito': muito,
        'satis': satis,
        'insatis': insatis,
        'total': total,
        'pct_muito': pct_muito,
        'pct_satis': pct_satis,
        'pct_insatis': pct_insatis,
        'score': score
    }


def get_sqlite_db_path():
    url = app.config.get('SQLALCHEMY_DATABASE_URI', '')
    if not url.startswith('sqlite'):
        return None
    parsed = urlparse(url)
    if parsed.scheme != 'sqlite':
        return None
    path = unquote(parsed.path or '')
    if os.name == 'nt' and path.startswith('/') and len(path) > 3 and path[2] == ':':
        path = path[1:]
    if os.path.isabs(path):
        return path
    if path.startswith('/'):
        path = path[1:]
    return os.path.join(get_runtime_data_dir(), path or 'database.db')


def ensure_backup_dir():
    backup_dir = os.path.join(get_runtime_data_dir(), 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    return backup_dir


def create_backup_copy():
    db_path = get_sqlite_db_path()
    if not db_path or not os.path.exists(db_path):
        return None
    backup_dir = ensure_backup_dir()
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = os.path.join(backup_dir, f'backup_{stamp}.db')
    shutil.copy2(db_path, backup_path)
    return backup_path


def cleanup_old_backups():
    keep_days = int(os.getenv('BACKUP_KEEP_DAYS', '7'))
    cutoff = datetime.now() - timedelta(days=keep_days)
    backup_dir = ensure_backup_dir()
    for name in os.listdir(backup_dir):
        if not name.lower().endswith('.db'):
            continue
        path = os.path.join(backup_dir, name)
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
            if mtime < cutoff:
                os.remove(path)
        except Exception:
            continue


def run_backup_job():
    with app.app_context():
        create_backup_copy()
        cleanup_old_backups()


def month_range(month_date):
    start = month_date.replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    end = next_month - timedelta(days=1)
    return start, end


def iter_dates(start_date, end_date):
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def build_daily_totals(start_date, end_date):
    totals = []
    for d in iter_dates(start_date, end_date):
        d_str = d.strftime("%Y-%m-%d")
        totals.append((d_str, Feedback.query.filter(Feedback.data == d_str).count()))
    return totals


def build_chart_image(daily_totals, title):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    labels = [d for d, _ in daily_totals]
    values = [v for _, v in daily_totals]
    fig, ax = plt.subplots(figsize=(6.5, 2.8))
    x = list(range(len(values)))
    ax.plot(x, values, color='#0ea5e9', linewidth=2, marker='o', markersize=3)
    ax.fill_between(x, values, color='#0ea5e9', alpha=0.12)
    ax.set_title(title, fontsize=10)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=60, fontsize=7)
    ax.tick_params(axis='y', labelsize=7)
    ax.grid(True, linestyle='--', linewidth=0.5, alpha=0.4)
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf


def get_report_logo_path():
    explicit = os.getenv('REPORT_LOGO_PATH')
    if explicit and os.path.exists(explicit):
        return explicit
    default_path = os.path.join(app.root_path, 'static', 'img', 'logo.png')
    if os.path.exists(default_path):
        return default_path
    return None


def draw_report_branding(c, page_width, page_height):
    from reportlab.lib.utils import ImageReader
    from reportlab.lib.units import cm

    logo_path = get_report_logo_path()
    if logo_path:
        try:
            c.drawImage(ImageReader(logo_path), 2 * cm, page_height - 4 * cm, 3 * cm, 3 * cm, mask='auto')
        except Exception:
            pass

    return page_height - 2 * cm


def draw_report_signature(c, y):
    from reportlab.lib.units import cm
    from reportlab.lib.utils import ImageReader

    name = os.getenv('REPORT_SIGNATURE_NAME', '').strip()
    title = os.getenv('REPORT_SIGNATURE_TITLE', '').strip()
    sig_path = os.getenv('REPORT_SIGNATURE_IMAGE', '').strip()
    if sig_path and os.path.exists(sig_path):
        try:
            c.drawImage(ImageReader(sig_path), 2 * cm, y - 2.2 * cm, 4 * cm, 1.6 * cm, mask='auto')
            return y - 2.4 * cm
        except Exception:
            pass
    if not name:
        return y
    line_y = y - 0.4 * cm
    c.line(2 * cm, line_y, 8 * cm, line_y)
    c.setFont('Helvetica', 9)
    c.drawString(2 * cm, line_y - 0.45 * cm, name)
    if title:
        c.drawString(2 * cm, line_y - 0.85 * cm, title)
        return line_y - 1.1 * cm
    return line_y - 0.7 * cm


def build_report_pdf(title, start_str, end_str, rows, summary, include_qr=False, chart_title='', compare_summary=None, compare_label=''):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import cm
    from reportlab.lib.utils import ImageReader
    import qrcode

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = draw_report_branding(c, width, height)

    if include_qr:
        qr_img = qrcode.make(url_for('index', _external=True))
        qr_buffer = io.BytesIO()
        qr_img.save(qr_buffer, format='PNG')
        qr_buffer.seek(0)
        c.drawImage(ImageReader(qr_buffer), width - 5 * cm, height - 5 * cm, 3 * cm, 3 * cm)

    c.setFont('Helvetica-Bold', 14)
    c.drawString(2 * cm, y, title)
    y -= 0.8 * cm
    c.setFont('Helvetica', 10)
    c.drawString(2 * cm, y, f'Periodo: {start_str} a {end_str}')
    y -= 0.6 * cm
    c.drawString(2 * cm, y, f'Total: {summary["total"]} | Score: {summary["score"]}%')
    y -= 0.6 * cm
    c.drawString(2 * cm, y, f'Muito: {summary["muito"]}  Satisfeito: {summary["satis"]}  Insatisfeito: {summary["insatis"]}')
    y -= 0.8 * cm
    if compare_summary:
        delta_score = round(summary["score"] - compare_summary["score"], 1)
        delta_total = summary["total"] - compare_summary["total"]
        c.drawString(2 * cm, y, f'Comparacao ({compare_label}): Delta Score {delta_score}% | Delta Total {delta_total}')
        y -= 0.6 * cm

    if chart_title:
        start_date = parse_date_ymd(start_str)
        end_date = parse_date_ymd(end_str)
        if start_date and end_date:
            daily_totals = build_daily_totals(start_date, end_date)
            chart_buf = build_chart_image(daily_totals, chart_title)
            c.drawImage(ImageReader(chart_buf), 2 * cm, y - 6 * cm, width - 4 * cm, 5.5 * cm, preserveAspectRatio=True, mask='auto')
            y -= 6.4 * cm

    c.setFont('Helvetica-Bold', 10)
    c.drawString(2 * cm, y, 'ID')
    c.drawString(4 * cm, y, 'Grau')
    c.drawString(9 * cm, y, 'Data')
    c.drawString(12 * cm, y, 'Hora')
    c.drawString(15 * cm, y, 'Dia Semana')
    y -= 0.4 * cm
    c.setFont('Helvetica', 9)

    for r in rows:
        if y < 3 * cm:
            y = draw_report_signature(c, y)
            c.showPage()
            y = height - 2 * cm
            c.setFont('Helvetica-Bold', 10)
            c.drawString(2 * cm, y, 'ID')
            c.drawString(4 * cm, y, 'Grau')
            c.drawString(9 * cm, y, 'Data')
            c.drawString(12 * cm, y, 'Hora')
            c.drawString(15 * cm, y, 'Dia Semana')
            y -= 0.4 * cm
            c.setFont('Helvetica', 9)
        c.drawString(2 * cm, y, str(r.id))
        c.drawString(4 * cm, y, r.grau_satisfacao)
        c.drawString(9 * cm, y, r.data)
        c.drawString(12 * cm, y, r.hora)
        c.drawString(15 * cm, y, r.dia_semana)
        y -= 0.35 * cm

    y = draw_report_signature(c, y)
    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer


def get_admin_setting():
    return AdminSetting.query.first()


def verify_admin_credentials(user, password):
    setting = get_admin_setting()
    if setting and setting.password_hash:
        if user == setting.username and check_password_hash(setting.password_hash, password):
            return True
        return False
    return user == ADMIN_USER and password == ADMIN_PASSWORD


def log_event(action, detail=''):
    try:
        admin_user = session.get('admin_user')
        ip = get_client_ip()
        db.session.add(AuditLog(action=action, admin_user=admin_user, ip=ip, detail=detail))
        db.session.commit()
    except Exception:
        db.session.rollback()


TIME_RE = re.compile(r'^([01]\d|2[0-3]):([0-5]\d)$')
ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
ALLOWED_PILL_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}


def parse_weekdays(value):
    if isinstance(value, str):
        return list(_parse_weekdays_cached(value))
    return parse_weekdays_strict(value) or ALL_WEEKDAYS[:]


def parse_weekdays_strict(value):
    if isinstance(value, list):
        raw_items = value
    elif isinstance(value, tuple):
        raw_items = list(value)
    elif isinstance(value, str):
        raw_items = [x.strip() for x in str(value).split(',') if x.strip()]
    else:
        raw_items = []
    days = []
    for item in raw_items:
        try:
            day = int(item)
        except Exception:
            continue
        if 0 <= day <= 6 and day not in days:
            days.append(day)
    return days


@lru_cache(maxsize=1024)
def _parse_weekdays_cached(csv_value):
    raw_items = [x.strip() for x in str(csv_value).split(',') if x.strip()]
    days = []
    for item in raw_items:
        try:
            day = int(item)
        except Exception:
            continue
        if 0 <= day <= 6 and day not in days:
            days.append(day)
    return tuple(days or [0, 1, 2, 3, 4, 5, 6])


def parse_times(value):
    if isinstance(value, list):
        raw_items = value
    elif isinstance(value, str):
        return list(_parse_times_cached(value))
    else:
        raw_items = []
    times = []
    for item in raw_items:
        t = str(item).strip()
        if not TIME_RE.match(t):
            continue
        if t not in times:
            times.append(t)
    times.sort()
    return times


@lru_cache(maxsize=2048)
def _parse_times_cached(csv_value):
    raw_items = [x.strip() for x in re.split(r'[;,]', str(csv_value)) if x.strip()]
    times = []
    for item in raw_items:
        t = str(item).strip()
        if not TIME_RE.match(t):
            continue
        if t not in times:
            times.append(t)
    times.sort()
    return tuple(times)


def times_to_csv(times):
    return ','.join(times)


def times_from_row(row):
    times = parse_times(row.times_csv or '')
    # Back-compat: if no times_csv, fall back to time_hhmm.
    if not times and row.time_hhmm and TIME_RE.match(row.time_hhmm):
        times = [row.time_hhmm]
    return times


def extract_request_list(payload, key):
    values = []
    if payload is not None and hasattr(payload, 'getlist'):
        values.extend(payload.getlist(key))
        values.extend(payload.getlist(f'{key}[]'))
    if values:
        return [v for v in values if v not in (None, '')]
    if isinstance(payload, dict):
        raw = payload.get(key)
        if raw is None:
            raw = payload.get(f'{key}[]')
        if isinstance(raw, list):
            return [v for v in raw if v not in (None, '')]
        if raw not in (None, ''):
            return [raw]
    return []


def normalize_schedule_mode(value, fallback='daily'):
    mode = str(value or fallback or 'daily').strip().lower()
    return 'weekly' if mode == 'weekly' else 'daily'


def infer_schedule_mode(days):
    normalized = sorted(parse_weekdays_strict(days))
    return 'daily' if normalized == ALL_WEEKDAYS else 'weekly'


def get_pill_upload_dir():
    upload_dir = os.path.join(get_runtime_data_dir(), 'pill_images')
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def pill_image_url(filename):
    if not filename:
        return None
    return url_for('pill_media', filename=filename)


def delete_pill_image(filename):
    if not filename:
        return
    try:
        path = os.path.join(get_pill_upload_dir(), filename)
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def save_pill_image(file_storage, previous_filename=None):
    if not file_storage or not getattr(file_storage, 'filename', ''):
        return previous_filename

    original_name = str(file_storage.filename or '').strip()
    _, ext = os.path.splitext(original_name)
    ext = ext.lower()
    if ext not in ALLOWED_PILL_IMAGE_EXTENSIONS:
        raise ValueError('Formato de imagem invalido. Use PNG, JPG ou WEBP.')

    safe_stem = secure_filename(os.path.splitext(original_name)[0]) or 'comprimido'
    safe_stem = safe_stem[:60]
    filename = f"{safe_stem}_{secrets.token_hex(8)}{ext}"
    path = os.path.join(get_pill_upload_dir(), filename)
    file_storage.save(path)

    if previous_filename and previous_filename != filename:
        delete_pill_image(previous_filename)
    return filename


def get_config(key, default=None):
    row = AppConfig.query.filter_by(key=key).first()
    if not row or row.value is None or row.value == '':
        return default
    return row.value


def set_config(key, value):
    row = AppConfig.query.filter_by(key=key).first()
    if not row:
        row = AppConfig(key=key, value=str(value) if value is not None else None)
        db.session.add(row)
    else:
        row.value = str(value) if value is not None else None
    db.session.commit()
    return row.value


def format_weekdays(days):
    return ','.join(str(d) for d in sorted(days))


def serialize_reminder(r):
    days = parse_weekdays(r.weekdays)
    times = times_from_row(r)
    schedule_mode = normalize_schedule_mode(getattr(r, 'schedule_mode', None), infer_schedule_mode(days))
    return {
        'id': r.id,
        'patient_id': r.patient_id,
        'patient_name': r.patient_name,
        'medicine_name': r.medicine_name,
        'dose': r.dose,
        'time_hhmm': r.time_hhmm,
        'times': times,
        'weekdays': days,
        'schedule_mode': schedule_mode,
        'is_active': bool(r.is_active),
        'stock_count': r.stock_count,
        'stock_low_threshold': r.stock_low_threshold,
        'color': r.color,
        'pill_image_url': pill_image_url(getattr(r, 'pill_image_path', None)),
        'created_at': (r.created_at or datetime.utcnow()).isoformat()
    }


def resolve_patient_id(payload=None):
    # Priority: explicit request param / payload -> session -> first patient
    raw = request.args.get('patient_id')
    if raw in ('all', '*', '0'):
        return None
    if raw is None and payload is not None:
        raw = payload.get('patient_id')
    if raw is None:
        raw = session.get('patient_id')
    try:
        pid = int(raw) if raw not in (None, '') else None
    except Exception:
        pid = None
    if pid:
        return pid
    p = Patient.query.order_by(Patient.id.asc()).first()
    return p.id if p else None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/reminders', methods=['GET'])
def reminders_list():
    pid = resolve_patient_id()
    q = MedicationReminder.query
    if pid:
        q = q.filter(MedicationReminder.patient_id == pid)
    rows = q.order_by(MedicationReminder.time_hhmm.asc(), MedicationReminder.id.asc()).all()
    return jsonify({'ok': True, 'items': [serialize_reminder(r) for r in rows]})


@app.route('/api/reminders', methods=['POST'])
def reminders_create():
    if not verify_public_write():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    payload = request.get_json(silent=True) or request.form
    pid = resolve_patient_id(payload)
    default_patient = get_config('default_patient_name', 'Utente')
    patient_name = (payload.get('patient_name') or default_patient or 'Utente').strip()[:100]
    medicine_name = (payload.get('medicine_name') or '').strip()[:120]
    dose = (payload.get('dose') or '').strip()[:80]
    time_hhmm = (payload.get('time_hhmm') or '').strip()
    schedule_mode = normalize_schedule_mode(payload.get('schedule_mode'))
    weekdays_raw = extract_request_list(payload, 'weekdays') or extract_request_list(payload, 'days')
    weekdays = ALL_WEEKDAYS[:] if schedule_mode == 'daily' else parse_weekdays_strict(weekdays_raw)
    times_input = extract_request_list(payload, 'times') or payload.get('times_csv') or ''
    times = parse_times(times_input)
    if not times and time_hhmm:
        times = parse_times([time_hhmm])
    stock_count = payload.get('stock_count')
    stock_low_threshold = payload.get('stock_low_threshold')
    color = (payload.get('color') or 'teal').strip()[:16]
    image_file = request.files.get('pill_image')

    if not medicine_name:
        return jsonify({'ok': False, 'message': 'Nome do medicamento e obrigatorio.'}), 400
    if not dose:
        return jsonify({'ok': False, 'message': 'Dose e obrigatoria.'}), 400
    if not times:
        return jsonify({'ok': False, 'message': 'Hora invalida. Use HH:MM.'}), 400
    if schedule_mode == 'weekly' and not weekdays:
        return jsonify({'ok': False, 'message': 'Selecione pelo menos um dia para o modo semanal.'}), 400

    def _to_int(v):
        if v is None or v == '':
            return None
        try:
            return int(v)
        except Exception:
            return None

    stock_count_i = _to_int(stock_count)
    stock_low_i = _to_int(stock_low_threshold)
    if stock_count_i is not None and stock_count_i < 0:
        return jsonify({'ok': False, 'message': 'Stock invalido.'}), 400
    if stock_low_i is not None and stock_low_i < 0:
        return jsonify({'ok': False, 'message': 'Limite de stock invalido.'}), 400

    try:
        pill_image_path = save_pill_image(image_file)
    except ValueError as exc:
        return jsonify({'ok': False, 'message': str(exc)}), 400

    row = MedicationReminder(
        patient_id=pid,
        patient_name=patient_name or 'Utente',
        medicine_name=medicine_name,
        dose=dose,
        time_hhmm=times[0],
        times_csv=times_to_csv(times),
        weekdays=format_weekdays(weekdays),
        schedule_mode=schedule_mode,
        is_active=True
        ,stock_count=stock_count_i
        ,stock_low_threshold=stock_low_i
        ,color=color or 'teal'
        ,pill_image_path=pill_image_path
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({'ok': True, 'item': serialize_reminder(row)})


@app.route('/api/reminders/<int:reminder_id>', methods=['PATCH'])
def reminders_update(reminder_id):
    if not verify_public_write():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    row = MedicationReminder.query.get_or_404(reminder_id)
    payload = request.get_json(silent=True) or request.form
    current_days = parse_weekdays(row.weekdays)
    schedule_mode = normalize_schedule_mode(
        payload.get('schedule_mode') if 'schedule_mode' in payload else getattr(row, 'schedule_mode', None),
        infer_schedule_mode(current_days)
    )
    weekdays_from_payload = 'weekdays' in payload or 'days' in payload or bool(extract_request_list(payload, 'weekdays')) or bool(extract_request_list(payload, 'days'))
    image_file = request.files.get('pill_image')

    if 'is_active' in payload:
        raw = payload.get('is_active')
        if isinstance(raw, bool):
            row.is_active = raw
        else:
            row.is_active = str(raw).strip().lower() in ('1', 'true', 'yes', 'on')
    if 'time_hhmm' in payload:
        time_hhmm = (payload.get('time_hhmm') or '').strip()
        if not TIME_RE.match(time_hhmm):
            return jsonify({'ok': False, 'message': 'Hora invalida. Use HH:MM.'}), 400
        row.time_hhmm = time_hhmm
        times = times_from_row(row)
        if time_hhmm not in times:
            times.append(time_hhmm)
            times.sort()
        row.times_csv = times_to_csv(times)
    if 'schedule_mode' in payload:
        row.schedule_mode = schedule_mode
    if weekdays_from_payload or 'schedule_mode' in payload:
        weekdays_raw = extract_request_list(payload, 'weekdays') or extract_request_list(payload, 'days')
        if schedule_mode == 'daily':
            row.weekdays = format_weekdays(ALL_WEEKDAYS)
        else:
            weekdays = parse_weekdays_strict(weekdays_raw)
            if not weekdays:
                return jsonify({'ok': False, 'message': 'Selecione pelo menos um dia para o modo semanal.'}), 400
            row.weekdays = format_weekdays(weekdays)
    if 'times' in payload or 'times_csv' in payload:
        times = parse_times(extract_request_list(payload, 'times') or payload.get('times_csv') or '')
        if not times:
            return jsonify({'ok': False, 'message': 'Horas invalidas. Use HH:MM.'}), 400
        row.times_csv = times_to_csv(times)
        row.time_hhmm = times[0]
    if 'stock_count' in payload:
        try:
            row.stock_count = None if payload.get('stock_count') in (None, '') else int(payload.get('stock_count'))
        except Exception:
            return jsonify({'ok': False, 'message': 'Stock invalido.'}), 400
    if 'stock_low_threshold' in payload:
        try:
            row.stock_low_threshold = None if payload.get('stock_low_threshold') in (None, '') else int(payload.get('stock_low_threshold'))
        except Exception:
            return jsonify({'ok': False, 'message': 'Limite de stock invalido.'}), 400
    if 'color' in payload:
        row.color = (payload.get('color') or 'teal').strip()[:16] or 'teal'
    if str(payload.get('remove_pill_image') or '').strip().lower() in ('1', 'true', 'yes', 'on'):
        delete_pill_image(getattr(row, 'pill_image_path', None))
        row.pill_image_path = None
    if image_file and getattr(image_file, 'filename', ''):
        try:
            row.pill_image_path = save_pill_image(image_file, previous_filename=getattr(row, 'pill_image_path', None))
        except ValueError as exc:
            return jsonify({'ok': False, 'message': str(exc)}), 400

    db.session.commit()
    return jsonify({'ok': True, 'item': serialize_reminder(row)})


@app.route('/api/reminders/<int:reminder_id>', methods=['DELETE'])
def reminders_delete(reminder_id):
    if not verify_public_write():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    row = MedicationReminder.query.get_or_404(reminder_id)
    delete_pill_image(getattr(row, 'pill_image_path', None))
    db.session.delete(row)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/reminders/import_csv', methods=['POST'])
@admin_required
def reminders_import_csv():
    if not verify_csrf():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'ok': False, 'message': 'Ficheiro CSV em falta.'}), 400
    if not str(file.filename).lower().endswith('.csv'):
        return jsonify({'ok': False, 'message': 'Formato invalido. Envie um ficheiro .csv.'}), 400
    pid = resolve_patient_id(request.form)

    try:
        content = file.read().decode('utf-8', errors='ignore')
    except Exception:
        return jsonify({'ok': False, 'message': 'Nao foi possivel ler o ficheiro.'}), 400

    reader = csv.DictReader(io.StringIO(content))
    fieldnames = {str(x or '').strip().lower() for x in (reader.fieldnames or [])}
    if not {'medicine_name', 'dose'}.issubset(fieldnames):
        return jsonify({'ok': False, 'message': 'CSV invalido. Colunas obrigatorias: medicine_name,dose'}), 400
    created = 0
    errors = 0
    processed = 0
    for row in reader:
        processed += 1
        if processed > MAX_CSV_IMPORT_ROWS:
            db.session.rollback()
            return jsonify({'ok': False, 'message': f'CSV excede o limite de {MAX_CSV_IMPORT_ROWS} linhas.'}), 400
        try:
            patient_name = (row.get('patient_name') or get_config('default_patient_name', 'Utente') or 'Utente').strip()[:100]
            medicine_name = (row.get('medicine_name') or '').strip()[:120]
            dose = (row.get('dose') or '').strip()[:80]
            weekdays = parse_weekdays(row.get('weekdays') or row.get('days') or '')
            times = parse_times(row.get('times') or row.get('times_csv') or row.get('time_hhmm') or '')
            if not (medicine_name and dose and times):
                errors += 1
                continue
            stock_count = row.get('stock_count') or ''
            stock_low_threshold = row.get('stock_low_threshold') or ''
            try:
                stock_count_i = int(stock_count) if str(stock_count).strip() != '' else None
            except Exception:
                stock_count_i = None
            try:
                stock_low_i = int(stock_low_threshold) if str(stock_low_threshold).strip() != '' else None
            except Exception:
                stock_low_i = None
            color = (row.get('color') or 'teal').strip()[:16] or 'teal'

            rr = MedicationReminder(
                patient_id=pid,
                patient_name=patient_name,
                medicine_name=medicine_name,
                dose=dose,
                time_hhmm=times[0],
                times_csv=times_to_csv(times),
                weekdays=format_weekdays(weekdays),
                schedule_mode=infer_schedule_mode(weekdays),
                is_active=True,
                stock_count=stock_count_i,
                stock_low_threshold=stock_low_i,
                color=color
            )
            db.session.add(rr)
            created += 1
        except Exception:
            errors += 1
            continue

    db.session.commit()
    return jsonify({'ok': True, 'created': created, 'errors': errors})


@app.route('/api/config', methods=['GET'])
@admin_required
def config_get():
    keys = [
        'default_patient_name',
        'stock_low_default',
        'escalation_minutes',
        'kiosk_admin_pin',
        'caregiver_email'
    ]
    data = {k: get_config(k, '') for k in keys}
    return jsonify({'ok': True, 'config': data})


@app.route('/api/config', methods=['POST'])
@admin_required
def config_set():
    if not verify_csrf():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    payload = request.get_json(silent=True) or request.form
    allowed = {
        'default_patient_name',
        'stock_low_default',
        'escalation_minutes',
        'kiosk_admin_pin',
        'caregiver_email'
    }
    for k in allowed:
        if k in payload:
            set_config(k, payload.get(k))
    return jsonify({'ok': True})


@app.route('/api/alerts/escalate', methods=['POST'])
def alert_escalate():
    if not verify_public_write():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    if alert_rate_limited():
        return jsonify({'ok': False, 'message': 'Aguarde antes de enviar novo alerta.'}), 429
    # No auth: the kiosk can call this, but it only sends if configured.
    to_email = (get_config('caregiver_email', '') or '').strip()
    if not to_email:
        return jsonify({'ok': False, 'message': 'Email do cuidador nao configurado.'}), 400
    payload = request.get_json(silent=True) or request.form
    subject = (payload.get('subject') or 'LembreMe - Alerta de Medicacao').strip()[:120]
    body = (payload.get('body') or '').strip()
    if not body:
        body = 'Alerta: toma nao confirmada.'
    try:
        send_email_plain(subject, body, [to_email])
        return jsonify({'ok': True})
    except Exception:
        return jsonify({'ok': False, 'message': 'Falha ao enviar email.'}), 500


@app.route('/api/admin/pin_login', methods=['POST'])
def admin_pin_login_api():
    blocked_for = ip_rate_limit_seconds_left('admin_pin_login_api')
    if blocked_for > 0:
        return jsonify({'ok': False, 'message': 'Muitas tentativas deste IP. Tente novamente mais tarde.'}), 429
    pin = (get_config('kiosk_admin_pin', '') or '').strip()
    if not pin:
        return jsonify({'ok': False, 'message': 'PIN nao configurado.'}), 400
    payload = request.get_json(silent=True) or request.form
    entered = (payload.get('pin') or '').strip()
    if entered != pin:
        if register_ip_failed_attempt('admin_pin_login_api'):
            return jsonify({'ok': False, 'message': 'IP temporariamente bloqueado por excesso de tentativas.'}), 429
        return jsonify({'ok': False, 'message': 'PIN invalido.'}), 403
    clear_ip_failed_attempts('admin_pin_login_api')
    session.clear()
    session['admin_logged_in'] = True
    session['admin_user'] = 'kiosk'
    session.permanent = True
    log_event('pin_login_success', 'api')
    return jsonify({'ok': True})


@app.route('/api/reminders/<int:reminder_id>/confirm', methods=['POST'])
def reminders_confirm(reminder_id):
    if not verify_public_write():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    row = MedicationReminder.query.get_or_404(reminder_id)
    payload = request.get_json(silent=True) or request.form
    scheduled_time = (payload.get('scheduled_time_hhmm') or payload.get('scheduled_time') or '').strip()
    if scheduled_time and not TIME_RE.match(scheduled_time):
        scheduled_time = ''
    scheduled_date = datetime.now().strftime('%Y-%m-%d')
    late_minutes = None
    if scheduled_time:
        try:
            now = datetime.now()
            sched = datetime.strptime(f'{scheduled_date} {scheduled_time}:00', '%Y-%m-%d %H:%M:%S')
            delta = int((now - sched).total_seconds() // 60)
            late_minutes = delta if delta > 0 else 0
        except Exception:
            late_minutes = None

    # Stock handling: decrement by 1 per confirmation when stock_count is set.
    if row.stock_count is not None:
        row.stock_count = max(int(row.stock_count) - 1, 0)

    log = MedicationLog(
        patient_id=row.patient_id,
        reminder_id=row.id,
        medicine_name=row.medicine_name,
        dose=row.dose,
        status='taken',
        scheduled_date=scheduled_date,
        scheduled_time_hhmm=scheduled_time or None,
        late_minutes=late_minutes
    )
    db.session.add(log)
    db.session.commit()

    low = None
    if row.stock_count is not None:
        threshold = row.stock_low_threshold
        if threshold is None:
            try:
                threshold = int(get_config('stock_low_default', '3'))
            except Exception:
                threshold = 3
        if threshold is not None and row.stock_count <= int(threshold):
            low = {'stock_count': row.stock_count, 'threshold': int(threshold)}

    return jsonify({'ok': True, 'message': 'Toma confirmada.', 'low_stock': low, 'stock_count': row.stock_count})


@app.route('/api/stats/today', methods=['GET'])
def stats_today():
    today = datetime.now().date()
    start = datetime(today.year, today.month, today.day, 0, 0, 0)
    end = start + timedelta(days=1)
    pid = resolve_patient_id()
    taken_q = MedicationLog.query.filter(MedicationLog.confirmed_at >= start, MedicationLog.confirmed_at < end)
    if pid:
        taken_q = taken_q.filter(MedicationLog.patient_id == pid)
    taken_today = taken_q.count()
    rem_q = MedicationReminder.query.filter_by(is_active=True)
    if pid:
        rem_q = rem_q.filter(MedicationReminder.patient_id == pid)
    reminders = rem_q.all()
    active_reminders = len(reminders)

    weekday = datetime.now().weekday()
    weekday_js = (weekday + 1) % 7  # python Mon=0..Sun=6 -> js Sun=0..Sat=6
    expected = 0
    for r in reminders:
        if weekday_js not in parse_weekdays(r.weekdays):
            continue
        expected += len(times_from_row(r))
    adherence = round((taken_today / expected * 100), 1) if expected else 0.0
    missed_today = max(int(expected) - int(taken_today), 0)

    return jsonify({
        'ok': True,
        'taken_today': taken_today,
        'active_reminders': active_reminders,
        'expected_today': expected,
        'adherence_today': adherence,
        'missed_today': missed_today
    })


@app.route('/api/schedule/today', methods=['GET'])
def schedule_today():
    now = datetime.now()
    date_str = now.strftime('%Y-%m-%d')
    weekday_js = now.weekday()
    weekday_js = (weekday_js + 1) % 7

    pid = resolve_patient_id()
    taken_q = MedicationLog.query.filter(MedicationLog.scheduled_date == date_str)
    if pid:
        taken_q = taken_q.filter(MedicationLog.patient_id == pid)
    taken_rows = taken_q.with_entities(MedicationLog.reminder_id, MedicationLog.scheduled_time_hhmm).all()
    taken_keys = {(rid, hhmm) for rid, hhmm in taken_rows if rid and hhmm}

    items = []
    rem_q = MedicationReminder.query.filter_by(is_active=True)
    if pid:
        rem_q = rem_q.filter(MedicationReminder.patient_id == pid)
    for r in rem_q.all():
        if weekday_js not in parse_weekdays(r.weekdays):
            continue
        for t in times_from_row(r):
            status = 'upcoming'
            if (r.id, t) in taken_keys:
                status = 'taken'
            else:
                try:
                    sched = datetime.strptime(f'{date_str} {t}:00', '%Y-%m-%d %H:%M:%S')
                    if sched < now:
                        status = 'missed'
                except Exception:
                    pass
            items.append({
                'reminder_id': r.id,
                'time_hhmm': t,
                'patient_name': r.patient_name,
                'medicine_name': r.medicine_name,
                'dose': r.dose,
                'color': r.color,
                'status': status,
                'stock_count': r.stock_count,
                'stock_low_threshold': r.stock_low_threshold,
                'pill_image_url': pill_image_url(getattr(r, 'pill_image_path', None))
            })

    items.sort(key=lambda x: x['time_hhmm'])
    return jsonify({'ok': True, 'date': date_str, 'items': items})


@app.route('/api/history/recent', methods=['GET'])
def history_recent():
    pid = resolve_patient_id()
    q = MedicationLog.query
    if pid:
        q = q.filter(MedicationLog.patient_id == pid)
    rows = (
        q.order_by(MedicationLog.confirmed_at.desc(), MedicationLog.id.desc())
        .limit(3)
        .all()
    )
    reminder_ids = [row.reminder_id for row in rows if getattr(row, 'reminder_id', None)]
    reminder_map = {}
    if reminder_ids:
        reminder_rows = MedicationReminder.query.filter(MedicationReminder.id.in_(reminder_ids)).all()
        reminder_map = {row.id: row for row in reminder_rows}
    items = []
    for row in rows:
        reminder = reminder_map.get(row.reminder_id)
        items.append({
            'medicine_name': row.medicine_name,
            'dose': row.dose,
            'status': row.status,
            'late_minutes': row.late_minutes or 0,
            'confirmed_at': row.confirmed_at.strftime('%Y-%m-%d %H:%M') if row.confirmed_at else '',
            'pill_image_url': pill_image_url(getattr(reminder, 'pill_image_path', None)) if reminder else None
        })
    return jsonify({'ok': True, 'items': items})


@app.route('/media/pills/<path:filename>', methods=['GET'])
def pill_media(filename):
    return send_from_directory(get_pill_upload_dir(), filename)


@app.route('/healthz', methods=['GET'])
def healthz():
    try:
        db.session.execute(db.text('SELECT 1'))
        return jsonify({'ok': True}), 200
    except Exception:
        app.logger.exception('Healthcheck falhou.')
        return jsonify({'ok': False, 'message': 'Base de dados indisponivel.'}), 503


@app.route('/api/stats/week', methods=['GET'])
def stats_week():
    # Optimized 7-day adherence summary (preloads reminders + grouped log counts).
    pid = resolve_patient_id()
    today = datetime.now().date()
    start_day = today - timedelta(days=6)

    rem_q = MedicationReminder.query.filter_by(is_active=True)
    if pid:
        rem_q = rem_q.filter(MedicationReminder.patient_id == pid)
    reminders = rem_q.all()
    expected_by_weekday = {d: 0 for d in range(7)}
    for r in reminders:
        times_count = len(times_from_row(r))
        if times_count <= 0:
            continue
        for d in parse_weekdays(r.weekdays):
            expected_by_weekday[d] = expected_by_weekday.get(d, 0) + times_count

    start_str = start_day.strftime('%Y-%m-%d')
    end_str = today.strftime('%Y-%m-%d')
    taken_q = db.session.query(MedicationLog.scheduled_date, func.count(MedicationLog.id))
    taken_q = taken_q.filter(MedicationLog.scheduled_date >= start_str, MedicationLog.scheduled_date <= end_str)
    if pid:
        taken_q = taken_q.filter(MedicationLog.patient_id == pid)
    taken_q = taken_q.group_by(MedicationLog.scheduled_date)
    taken_map = {d: int(c) for d, c in taken_q.all() if d}

    days = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        date_str = d.strftime('%Y-%m-%d')
        weekday_js = (d.weekday() + 1) % 7  # python Mon=0..Sun=6 -> js Sun=0..Sat=6
        expected = int(expected_by_weekday.get(weekday_js, 0))
        taken = int(taken_map.get(date_str, 0))
        adherence = round((taken / expected * 100), 1) if expected else 0.0
        days.append({'date': date_str, 'expected': expected, 'taken': taken, 'adherence': adherence})
    return jsonify({'ok': True, 'days': days})


@app.route('/api/public_config', methods=['GET'])
def public_config():
    esc = get_config('escalation_minutes', '10')
    pin = (get_config('kiosk_admin_pin', '') or '').strip()
    return jsonify({
        'ok': True,
        'escalation_minutes': esc,
        'has_kiosk_pin': bool(pin)
    })


@app.route('/api/patients', methods=['GET'])
def patients_list():
    rows = Patient.query.order_by(Patient.display_name.asc(), Patient.id.asc()).all()
    current = session.get('patient_id')
    return jsonify({
        'ok': True,
        'current_patient_id': current,
        'items': [{'id': p.id, 'display_name': p.display_name} for p in rows]
    })


@app.route('/api/patients', methods=['POST'])
@admin_required
def patients_create():
    if not verify_csrf():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    payload = request.get_json(silent=True) or request.form
    name = (payload.get('display_name') or payload.get('name') or '').strip()[:100]
    if not name:
        return jsonify({'ok': False, 'message': 'Nome do utente e obrigatorio.'}), 400
    p = Patient(display_name=name)
    db.session.add(p)
    db.session.commit()
    return jsonify({'ok': True, 'item': {'id': p.id, 'display_name': p.display_name}})


@app.route('/api/patients/<int:patient_id>', methods=['PATCH'])
@admin_required
def patients_update(patient_id):
    if not verify_csrf():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    p = Patient.query.get_or_404(patient_id)
    payload = request.get_json(silent=True) or request.form
    name = (payload.get('display_name') or payload.get('name') or '').strip()[:100]
    if name:
        p.display_name = name
        db.session.commit()
    return jsonify({'ok': True, 'item': {'id': p.id, 'display_name': p.display_name}})


@app.route('/api/patients/<int:patient_id>', methods=['DELETE'])
@admin_required
def patients_delete(patient_id):
    if not verify_csrf():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    p = Patient.query.get_or_404(patient_id)
    # Prevent deleting last patient.
    if Patient.query.count() <= 1:
        return jsonify({'ok': False, 'message': 'Nao pode apagar o ultimo utente.'}), 400
    # Reassign reminders/logs to the first patient (fallback).
    fallback = Patient.query.filter(Patient.id != p.id).order_by(Patient.id.asc()).first()
    if fallback:
        MedicationReminder.query.filter(MedicationReminder.patient_id == p.id).update({'patient_id': fallback.id})
        MedicationLog.query.filter(MedicationLog.patient_id == p.id).update({'patient_id': fallback.id})
    db.session.delete(p)
    db.session.commit()
    if session.get('patient_id') == p.id:
        session['patient_id'] = fallback.id if fallback else None
    return jsonify({'ok': True})


@app.route('/api/patient/current', methods=['GET'])
def patient_current_get():
    pid = resolve_patient_id()
    p = Patient.query.get(pid) if pid else None
    return jsonify({'ok': True, 'patient_id': pid, 'display_name': p.display_name if p else None})


@app.route('/api/patient/auto', methods=['POST'])
def patient_auto():
    if not verify_public_write():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    payload = request.get_json(silent=True) or request.form

    # 1) If client sent a patient_id and it exists, attach session to it.
    raw = payload.get('patient_id')
    if raw not in (None, ''):
        try:
            pid = int(raw)
            p = Patient.query.get(pid)
            if p:
                session['patient_id'] = p.id
                return jsonify({'ok': True, 'patient_id': p.id, 'display_name': p.display_name})
        except Exception:
            pass

    # 2) If session already has a patient, return it.
    pid = session.get('patient_id')
    if pid:
        p = Patient.query.get(pid)
        if p:
            return jsonify({'ok': True, 'patient_id': p.id, 'display_name': p.display_name})

    # 3) Create a new patient for this browser.
    base = (get_config('default_patient_name', 'Utente') or 'Utente').strip()[:100]
    if not base:
        base = 'Utente'
    p = Patient(display_name=base)
    db.session.add(p)
    db.session.commit()
    session['patient_id'] = p.id
    return jsonify({'ok': True, 'patient_id': p.id, 'display_name': p.display_name, 'created': True})


@app.route('/api/patient/current', methods=['POST'])
def patient_current_set():
    if not verify_public_write():
        return jsonify({'ok': False, 'message': 'Sessao expirada. Atualize a pagina.'}), 400
    payload = request.get_json(silent=True) or request.form
    raw = payload.get('patient_id')
    try:
        pid = int(raw)
    except Exception:
        return jsonify({'ok': False, 'message': 'patient_id invalido.'}), 400
    if not Patient.query.get(pid):
        return jsonify({'ok': False, 'message': 'Utente nao existe.'}), 404
    session['patient_id'] = pid
    return jsonify({'ok': True})


@app.route('/submit_feedback', methods=['POST'])
def submit_feedback():
    if feedback_rate_limited():
        return jsonify({'ok': False, 'message': 'Aguarde um momento antes de enviar novamente.'}), 429
    grau = request.form.get('grau') or (request.get_json(silent=True) or {}).get('grau')
    if PUBLIC_PIN:
        pin = request.form.get('pin') or (request.get_json(silent=True) or {}).get('pin') or ''
        if pin != PUBLIC_PIN:
            return jsonify({'ok': False, 'message': 'PIN invalido'}), 403
    if grau not in ('muito_satisfeito', 'satisfeito', 'insatisfeito'):
        return jsonify({'ok': False, 'message': 'Grau invalido'}), 400
    now = datetime.now()
    feedback = Feedback(
        grau_satisfacao=grau,
        data=now.strftime("%Y-%m-%d"),
        hora=now.strftime("%H:%M:%S"),
        dia_semana=weekday_pt(now.strftime("%A"))
    )
    db.session.add(feedback)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/admin_2026/login', methods=['GET', 'POST'])
def admin_login():
    error = None
    if request.method == 'POST':
        if not verify_csrf():
            error = "Sessao expirada. Atualiza a pagina e tenta novamente."
            return render_template('admin_login.html', error=error)
        blocked_for = ip_rate_limit_seconds_left('admin_login')
        if blocked_for > 0:
            error = "Muitas tentativas deste IP. Tenta novamente mais tarde."
            return render_template('admin_login.html', error=error)
        lock_until = parse_iso_datetime(session.get('login_lock_until'))
        if lock_until and datetime.utcnow() < lock_until:
            error = "Muitas tentativas. Tenta novamente mais tarde."
            return render_template('admin_login.html', error=error)
        user = (request.form.get('user') or '').strip()
        password = request.form.get('password') or ''
        if verify_admin_credentials(user, password):
            clear_ip_failed_attempts('admin_login')
            session.clear()
            session['admin_logged_in'] = True
            session['admin_user'] = user
            session['login_fail_count'] = 0
            session['login_lock_until'] = None
            session.permanent = True
            log_event('login_success', f'user={user}')
            return redirect(url_for('admin_med_dashboard'))
        ip_locked = register_ip_failed_attempt('admin_login')
        fail_count = int(session.get('login_fail_count', 0)) + 1
        session['login_fail_count'] = fail_count
        log_event('login_failed', f'user={user}')
        if ip_locked:
            error = "IP bloqueado temporariamente por excesso de tentativas."
        elif fail_count >= ADMIN_MAX_FAILS:
            session['login_fail_count'] = 0
            session['login_lock_until'] = (datetime.utcnow() + timedelta(minutes=ADMIN_LOCK_MINUTES)).isoformat()
            error = "Conta bloqueada temporariamente. Tenta mais tarde."
        else:
            error = "Credenciais invalidas."
    return render_template('admin_login.html', error=error)


@app.route('/admin')
def admin_alias():
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/login')
def admin_login_alias():
    return redirect(url_for('admin_login'))


@app.route('/admin_2026/pin', methods=['GET', 'POST'])
def admin_pin_login():
    pin = (get_config('kiosk_admin_pin', '') or '').strip()
    if not pin:
        return render_template('admin_pin.html', error='PIN ainda nao configurado. Configure em Admin -> Definicoes.')
    error = None
    if request.method == 'POST':
        if not verify_csrf():
            error = "Sessao expirada. Atualiza a pagina e tenta novamente."
            return render_template('admin_pin.html', error=error)
        blocked_for = ip_rate_limit_seconds_left('admin_pin_login')
        if blocked_for > 0:
            error = "Muitas tentativas deste IP. Tenta novamente mais tarde."
            return render_template('admin_pin.html', error=error)
        entered = (request.form.get('pin') or '').strip()
        if entered == pin:
            clear_ip_failed_attempts('admin_pin_login')
            session.clear()
            session['admin_logged_in'] = True
            session['admin_user'] = 'kiosk'
            session.permanent = True
            log_event('pin_login_success', '')
            return redirect(url_for('admin_reminders'))
        ip_locked = register_ip_failed_attempt('admin_pin_login')
        error = "PIN invalido."
        if ip_locked:
            error = "IP bloqueado temporariamente por excesso de tentativas."
        log_event('pin_login_failed', '')
    return render_template('admin_pin.html', error=error)




@app.route('/admin_2026/logout')
@admin_required
def admin_logout():
    log_event('logout', '')
    session.clear()
    return redirect(url_for('admin_login'))


@app.route('/admin_2026')
@admin_required
def admin_dashboard():
    return redirect(url_for('admin_med_dashboard'))


@app.route('/admin_2026/dashboard')
@admin_required
def admin_med_dashboard():
    return render_template('admin_med_dashboard.html')


@app.route('/admin_2026/export')
@admin_required
def export_data():
    fmt = request.args.get('format', 'csv').lower()
    start = request.args.get('start') or ''
    end = request.args.get('end') or ''

    q = Feedback.query
    if start:
        q = q.filter(Feedback.data >= start)
    if end:
        q = q.filter(Feedback.data <= end)

    rows = q.order_by(Feedback.data.desc(), Feedback.hora.desc()).all()

    if fmt == 'pdf':
        summary = count_by_grau(q)
        start_str = start or '-'
        end_str = end or '-'
        compare_summary = None
        compare_label = ''
        if start and end:
            start_d = parse_date_ymd(start)
            end_d = parse_date_ymd(end)
            if start_d and end_d and start_d.month == end_d.month and start_d.year == end_d.year:
                month_start, _ = month_range(start_d)
                prev_month_date = (month_start - timedelta(days=1)).replace(day=1)
                prev_start, prev_end = month_range(prev_month_date)
                prev_start_str = prev_start.strftime("%Y-%m-%d")
                prev_end_str = prev_end.strftime("%Y-%m-%d")
                compare_summary = count_by_grau(
                    Feedback.query.filter(Feedback.data >= prev_start_str, Feedback.data <= prev_end_str)
                )
                compare_label = f'{prev_start_str} a {prev_end_str}'
        buffer = build_report_pdf(
            title='Relatorio de Feedback',
            start_str=start_str,
            end_str=end_str,
            rows=rows,
            summary=summary,
            include_qr=True,
            chart_title='Total diario no periodo',
            compare_summary=compare_summary,
            compare_label=compare_label
        )
        log_event('export_pdf', f'start={start},end={end},rows={len(rows)}')
        return send_file(buffer, mimetype='application/pdf', download_name='feedback.pdf', as_attachment=True)

    if fmt == 'xlsx':
        import pandas as pd
        df = pd.DataFrame([{
            'ID': r.id,
            'Grau': r.grau_satisfacao,
            'Data': r.data,
            'Hora': r.hora,
            'Dia Semana': r.dia_semana
        } for r in rows])
        output = io.BytesIO()
        df.to_excel(output, index=False)
        output.seek(0)
        log_event('export_xlsx', f'start={start},end={end},rows={len(rows)}')
        return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', download_name='feedback.xlsx', as_attachment=True)

    output = io.StringIO()
    writer = csv.writer(output, delimiter='	' if fmt == 'txt' else ',')
    writer.writerow(['ID', 'Grau', 'Data', 'Hora', 'Dia Semana'])
    for r in rows:
        writer.writerow([r.id, r.grau_satisfacao, r.data, r.hora, r.dia_semana])

    output.seek(0)
    mimetype = 'text/plain' if fmt == 'txt' else 'text/csv'
    filename = 'feedback.txt' if fmt == 'txt' else 'feedback.csv'
    log_event('export_data', f'format={fmt},start={start},end={end},rows={len(rows)}')
    return send_file(io.BytesIO(output.getvalue().encode()), mimetype=mimetype, download_name=filename, as_attachment=True)


@app.route('/admin_2026/password', methods=['POST'])
@admin_required
def admin_change_password():
    if not verify_csrf():
        return redirect(url_for('admin_dashboard', pw='err'))
    current = request.form.get('current') or ''
    new_pw = request.form.get('new') or ''
    confirm = request.form.get('confirm') or ''
    user = session.get('admin_user') or ADMIN_USER

    if new_pw != confirm or len(new_pw) < 6:
        return redirect(url_for('admin_dashboard', pw='err'))

    if not verify_admin_credentials(user, current):
        log_event('password_change_failed', 'invalid_current')
        return redirect(url_for('admin_dashboard', pw='err'))

    setting = get_admin_setting()
    if not setting:
        setting = AdminSetting(username=user)
        db.session.add(setting)
    setting.password_hash = generate_password_hash(new_pw)
    db.session.commit()
    log_event('password_changed', f'user={user}')
    return redirect(url_for('admin_dashboard', pw='ok'))


@app.route('/admin_2026/report/monthly')
@admin_required
def monthly_report():
    month_raw = request.args.get('month') or datetime.now().strftime("%Y-%m")
    month_date = parse_month_ym(month_raw) or datetime.now().date().replace(day=1)
    start, end = month_range(month_date)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    q = Feedback.query.filter(Feedback.data >= start_str, Feedback.data <= end_str)
    rows = q.order_by(Feedback.data.asc(), Feedback.hora.asc()).all()
    summary = count_by_grau(q)

    prev_month_date = (start - timedelta(days=1)).replace(day=1)
    prev_start, prev_end = month_range(prev_month_date)
    prev_start_str = prev_start.strftime("%Y-%m-%d")
    prev_end_str = prev_end.strftime("%Y-%m-%d")
    prev_summary = count_by_grau(Feedback.query.filter(Feedback.data >= prev_start_str, Feedback.data <= prev_end_str))

    buffer = build_report_pdf(
        title=f'Relatorio Mensal de Feedback ({month_raw})',
        start_str=start_str,
        end_str=end_str,
        rows=rows,
        summary=summary,
        include_qr=False,
        chart_title='Total diario no mes',
        compare_summary=prev_summary,
        compare_label=f'{prev_start_str} a {prev_end_str}'
    )
    log_event('monthly_report', f'month={month_raw},rows={len(rows)}')
    return send_file(buffer, mimetype='application/pdf', download_name=f'feedback_{month_raw}.pdf', as_attachment=True)


def send_email_with_attachment(subject, body, to_list, attachment_bytes, filename):
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.application import MIMEApplication

    host = os.getenv('SMTP_HOST', '')
    port = int(os.getenv('SMTP_PORT', '587'))
    user = os.getenv('SMTP_USER', '')
    password = os.getenv('SMTP_PASSWORD', '')
    use_tls = os.getenv('SMTP_USE_TLS', '1') == '1'
    from_email = os.getenv('SMTP_FROM', user)

    if not host or not from_email or not to_list:
        raise ValueError('SMTP config incomplete')

    msg = MIMEMultipart()
    msg['From'] = from_email
    msg['To'] = ', '.join(to_list)
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    part = MIMEApplication(attachment_bytes, Name=filename)
    part['Content-Disposition'] = f'attachment; filename="{filename}"'
    msg.attach(part)

    server = smtplib.SMTP(host, port, timeout=20)
    try:
        if use_tls:
            server.starttls()
        if user and password:
            server.login(user, password)
        server.sendmail(from_email, to_list, msg.as_string())
    finally:
        server.quit()


def send_email_plain(subject, body, to_list):
    import smtplib
    from email.mime.text import MIMEText

    host = os.getenv('SMTP_HOST', '')
    port = int(os.getenv('SMTP_PORT', '587'))
    user = os.getenv('SMTP_USER', '')
    password = os.getenv('SMTP_PASSWORD', '')
    use_tls = os.getenv('SMTP_USE_TLS', '1') == '1'
    from_email = os.getenv('SMTP_FROM', user)

    if not host or not from_email or not to_list:
        raise ValueError('SMTP config incomplete')

    msg = MIMEText(body or '', 'plain')
    msg['From'] = from_email
    msg['To'] = ', '.join(to_list)
    msg['Subject'] = subject

    server = smtplib.SMTP(host, port, timeout=20)
    try:
        if use_tls:
            server.starttls()
        if user and password:
            server.login(user, password)
        server.sendmail(from_email, to_list, msg.as_string())
    finally:
        server.quit()


def monthly_email_already_sent(month_raw):
    marker = f'month={month_raw}'
    return AuditLog.query.filter(AuditLog.action == 'monthly_email_sent', AuditLog.detail == marker).first() is not None


def get_month_for_email():
    mode = os.getenv('MONTHLY_EMAIL_MODE', 'previous')
    today = datetime.now().date()
    if mode == 'current':
        return today.replace(day=1).strftime("%Y-%m")
    last_month = today.replace(day=1) - timedelta(days=1)
    return last_month.replace(day=1).strftime("%Y-%m")


def send_monthly_report_email(month_raw):
    month_date = parse_month_ym(month_raw) or datetime.now().date().replace(day=1)
    start, end = month_range(month_date)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    q = Feedback.query.filter(Feedback.data >= start_str, Feedback.data <= end_str)
    rows = q.order_by(Feedback.data.asc(), Feedback.hora.asc()).all()
    summary = count_by_grau(q)
    pdf_buffer = build_report_pdf(
        title=f'Relatorio Mensal de Feedback ({month_raw})',
        start_str=start_str,
        end_str=end_str,
        rows=rows,
        summary=summary,
        include_qr=False,
        chart_title='Total diario no mes'
    )

    to_list = [e.strip() for e in os.getenv('MONTHLY_EMAIL_TO', '').split(',') if e.strip()]
    subject = f'Relatorio Mensal de Feedback - {month_raw}'
    body = f'Relatorio do periodo {start_str} a {end_str}. Total: {summary["total"]}. Score: {summary["score"]}%'
    send_email_with_attachment(subject, body, to_list, pdf_buffer.getvalue(), f'feedback_{month_raw}.pdf')

    log_event('monthly_email_sent', f'month={month_raw}')


def run_monthly_email_job():
    day = int(os.getenv('MONTHLY_EMAIL_DAY', '1'))
    today = datetime.now().date()
    if today.day != day:
        return
    with app.app_context():
        month_raw = get_month_for_email()
        if monthly_email_already_sent(month_raw):
            return
        send_monthly_report_email(month_raw)


@app.route('/admin_2026/report/monthly/send')
@admin_required
def monthly_report_send():
    try:
        month_raw = request.args.get('month') or get_month_for_email()
        if monthly_email_already_sent(month_raw):
            return redirect(url_for('admin_dashboard', email='sent'))
        send_monthly_report_email(month_raw)
        return redirect(url_for('admin_dashboard', email='ok'))
    except Exception:
        return redirect(url_for('admin_dashboard', email='err'))


@app.route('/admin_2026/backup')
@admin_required
def admin_backup():
    db_path = get_sqlite_db_path()
    if not db_path or not os.path.exists(db_path):
        return jsonify({'ok': False, 'message': 'Backup apenas para SQLite'}), 400
    backup_path = create_backup_copy()
    if not backup_path:
        return jsonify({'ok': False, 'message': 'Falha ao criar backup'}), 500
    log_event('backup_db', os.path.basename(backup_path))
    return send_file(backup_path, mimetype='application/octet-stream', as_attachment=True, download_name=os.path.basename(backup_path))


@app.route('/admin_2026/restore', methods=['POST'])
@admin_required
def admin_restore():
    if not verify_csrf():
        return redirect(url_for('admin_dashboard'))
    db_path = get_sqlite_db_path()
    if not db_path:
        return jsonify({'ok': False, 'message': 'Restore apenas para SQLite'}), 400
    file = request.files.get('backup')
    if not file or not file.filename:
        return redirect(url_for('admin_dashboard'))
    if not str(file.filename).lower().endswith('.db'):
        return jsonify({'ok': False, 'message': 'Formato invalido. Envie um ficheiro .db'}), 400
    try:
        header = file.stream.read(16)
        file.stream.seek(0)
    except Exception:
        return jsonify({'ok': False, 'message': 'Nao foi possivel ler o ficheiro enviado.'}), 400
    if header != b'SQLite format 3\x00':
        return jsonify({'ok': False, 'message': 'Ficheiro .db invalido para restore.'}), 400
    temp_dir = os.path.join(get_runtime_data_dir(), 'restore_tmp')
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, f'restore_{datetime.now().strftime("%Y%m%d_%H%M%S")}.db')
    file.save(temp_path)
    try:
        db.session.remove()
        db.engine.dispose()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        shutil.copy2(temp_path, db_path)
        log_event('restore_db', os.path.basename(temp_path))
    except Exception:
        return redirect(url_for('admin_dashboard'))
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
    return redirect(url_for('admin_dashboard'))


_scheduler = None


def start_scheduler():
    global _scheduler
    if _scheduler:
        return
    from apscheduler.schedulers.background import BackgroundScheduler
    _scheduler = BackgroundScheduler()
    if os.getenv('ENABLE_MONTHLY_EMAIL', '0') == '1':
        hour = int(os.getenv('MONTHLY_EMAIL_HOUR', '8'))
        minute = int(os.getenv('MONTHLY_EMAIL_MINUTE', '0'))
        _scheduler.add_job(run_monthly_email_job, 'cron', hour=hour, minute=minute)
    if os.getenv('ENABLE_AUTO_BACKUP', '0') == '1':
        b_hour = int(os.getenv('BACKUP_HOUR', '2'))
        b_minute = int(os.getenv('BACKUP_MINUTE', '0'))
        _scheduler.add_job(run_backup_job, 'cron', hour=b_hour, minute=b_minute)
    _scheduler.start()


@app.route('/admin_2026/qr')
@admin_required
def qr_page():
    return render_template('qr.html', target_url=url_for('index', _external=True))


@app.route('/admin_2026/qr.png')
@admin_required
def qr_png():
    import qrcode
    target_url = url_for('index', _external=True)
    img = qrcode.make(target_url)
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    return send_file(buffer, mimetype='image/png')


@app.route('/manifest.webmanifest')
def webmanifest():
    resp = make_response(send_from_directory(os.path.join(app.root_path, 'static'), 'manifest.webmanifest', mimetype='application/manifest+json'))
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/sw.js')
def service_worker():
    # Must be served from / to control the whole site scope.
    resp = make_response(send_from_directory(os.path.join(app.root_path, 'static'), 'sw.js', mimetype='application/javascript'))
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/reset')
def reset_client_cache():
    # Helper page: unregister SW + clear caches for users without DevTools.
    return render_template('reset.html')


@app.route('/admin_2026/users')
@admin_required
def admin_users_redirect():
    return redirect(url_for('admin_reminders'))


@app.route('/admin_2026/users/<int:patient_id>')
@admin_required
def admin_user_detail(patient_id):
    patient = Patient.query.get_or_404(patient_id)
    session['patient_id'] = patient.id

    weekday_map = {
        0: 'Dom',
        1: 'Seg',
        2: 'Ter',
        3: 'Qua',
        4: 'Qui',
        5: 'Sex',
        6: 'Sab'
    }

    reminders = (
        MedicationReminder.query
        .filter(MedicationReminder.patient_id == patient.id)
        .order_by(MedicationReminder.time_hhmm.asc(), MedicationReminder.id.asc())
        .all()
    )
    meds = []
    for row in reminders:
        times = times_from_row(row)
        days = parse_weekdays(row.weekdays)
        days_text = ', '.join(weekday_map.get(d, str(d)) for d in days) if days else '-'
        meds.append({
            'nome': row.medicine_name,
            'dose': row.dose,
            'hora': ', '.join(times) if times else (row.time_hhmm or '-'),
            'data': f'Dias: {days_text}'
        })

    logs = (
        MedicationLog.query
        .filter(MedicationLog.patient_id == patient.id)
        .order_by(MedicationLog.confirmed_at.desc(), MedicationLog.id.desc())
        .limit(300)
        .all()
    )
    tomas = []
    late_count = 0
    missed_count = 0
    for row in logs:
        confirmed_at = row.confirmed_at or datetime.utcnow()
        status = row.status or 'taken'
        late_minutes = int(row.late_minutes) if row.late_minutes is not None else 0
        note_parts = []
        if status != 'taken':
            note_parts.append(f'Estado: {status}')
            missed_count += 1
        if late_minutes > 0:
            note_parts.append(f'Atraso: {late_minutes} min')
            if status == 'taken':
                late_count += 1
        tomas.append({
            'nome': row.medicine_name,
            'dose': row.dose,
            'nota': ' | '.join(note_parts),
            'status': status,
            'late_minutes': late_minutes,
            'data': row.scheduled_date or confirmed_at.strftime('%Y-%m-%d'),
            'hora': row.scheduled_time_hhmm or confirmed_at.strftime('%H:%M')
        })

    total_logs = len(logs)
    tomas_stats = {
        'total': total_logs,
        'late': late_count,
        'missed': missed_count,
        'on_time': max(total_logs - late_count - missed_count, 0),
        'scope': total_logs
    }

    return render_template('admin_user.html', patient=patient, meds=meds, tomas=tomas, tomas_stats=tomas_stats)


@app.route('/admin_2026/users/<int:patient_id>/rename', methods=['POST'])
@admin_required
def admin_user_rename(patient_id):
    patient = Patient.query.get_or_404(patient_id)
    if not verify_csrf():
        flash('Sessao expirada. Atualize a pagina e tente novamente.', 'error')
        return redirect(url_for('admin_user_detail', patient_id=patient.id))

    flash('Edicao de utentes desativada neste modo.', 'info')
    return redirect(url_for('admin_user_detail', patient_id=patient.id))


@app.route('/admin_2026/users/<int:patient_id>/history.csv')
@admin_required
def admin_user_history_csv(patient_id):
    patient = Patient.query.get_or_404(patient_id)
    rows = (
        MedicationLog.query
        .filter(MedicationLog.patient_id == patient.id)
        .order_by(MedicationLog.confirmed_at.desc(), MedicationLog.id.desc())
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Medicamento', 'Dose', 'Estado', 'Data', 'Hora', 'Atraso (min)', 'Confirmado em'])
    for row in rows:
        confirmed_at = row.confirmed_at.strftime('%Y-%m-%d %H:%M:%S') if row.confirmed_at else ''
        writer.writerow([
            row.id,
            row.medicine_name,
            row.dose,
            row.status,
            row.scheduled_date or '',
            row.scheduled_time_hhmm or '',
            '' if row.late_minutes is None else row.late_minutes,
            confirmed_at
        ])

    output.seek(0)
    filename = f'utente_{patient.id}_historico.csv'
    log_event('patient_history_export_csv', f'patient_id={patient.id},rows={len(rows)}')
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        download_name=filename,
        as_attachment=True
    )


@app.route('/admin_2026/reminders')
@admin_required
def admin_reminders():
    return render_template('admin_reminders.html')


if os.getenv('START_SCHEDULER', '0') == '1' and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
    start_scheduler()


if __name__ == '__main__':
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_scheduler()
    debug_mode = os.getenv('FLASK_DEBUG', '1') == '1'
    host = os.getenv('FLASK_HOST', '127.0.0.1')
    port = int(os.getenv('PORT', os.getenv('FLASK_PORT', '5000')))
    app.run(host=host, port=port, debug=debug_mode)
