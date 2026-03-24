const form = document.getElementById("reminder-form");
const msg = document.getElementById("form-message");
const listEl = document.getElementById("reminders-list");
const kioskReminderForm = document.getElementById("kiosk-reminder-form");
const kioskFormMsg = document.getElementById("kiosk-form-msg");
const todayListEl = document.getElementById("today-list");
const weekListEl = document.getElementById("week-list");
const historyListEl = document.getElementById("history-list");
const clockEl = document.getElementById("live-clock");
const nextAlarmEl = document.getElementById("next-alarm-text");
const activeCountEl = document.getElementById("active-count");
const takenTodayEl = document.getElementById("taken-today");
const adherenceTodayEl = document.getElementById("adherence-today");
const missedTodayEl = document.getElementById("missed-today");
const kioskMsgEl = document.getElementById("kiosk-message");
const btnFullscreen = document.getElementById("btn-fullscreen");
const btnWakelock = document.getElementById("btn-wakelock");
const btnXl = document.getElementById("btn-xl");
const btnContrast = document.getElementById("btn-contrast");
const btnVoice = document.getElementById("btn-voice");
const patientCurrentEl = document.getElementById("patient-current");
const kioskTitle = document.getElementById("kiosk-title");
const kioskTimesExtraList = document.getElementById("times-extra-list");
const addTimeExtraBtn = document.getElementById("add-time-extra");
const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));

const modal = document.getElementById("alarm-modal");
const alarmTitle = document.getElementById("alarm-title");
const alarmDetail = document.getElementById("alarm-detail");
const btnConfirm = document.getElementById("btn-confirm");
const btnSnooze = document.getElementById("btn-snooze");
const btnCaregiver = document.getElementById("btn-caregiver");
const btnClose = document.getElementById("btn-close");

let reminders = [];
let currentAlarm = null;
const firedKeys = new Set();
const snoozeUntil = {};
let todaySchedule = [];
let patientId = null;

let audioCtx = null;
let beepTimer = null;
let wakeLock = null;

let alarmRepeatTimer = null;
let alarmEscalateTimer = null;
const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
const csrfToken = csrfTokenMeta ? String(csrfTokenMeta.getAttribute("content") || "") : "";

const PREF_KEY = "lm_prefs_v1";
const PATIENT_ID_KEY = "lm_kiosk_patient_id_v1";
const PATIENT_NAME_KEY = "lm_kiosk_patient_name_v1";
const prefs = loadPrefs();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function addExtraTimeInput(container, value) {
  if (!container) return;
  const row = document.createElement("div");
  row.className = "times-extra-item";
  const input = document.createElement("input");
  input.type = "time";
  input.name = "times_extra";
  if (value) {
    input.value = value;
  }
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "times-extra-remove";
  removeBtn.textContent = "Remover";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!container.querySelector("input[name='times_extra']")) {
      addExtraTimeInput(container, "");
    }
  });
  row.appendChild(input);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function collectExtraTimes(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll("input[name='times_extra']"))
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

async function apiFetch(url, options) {
  const opts = { ...(options || {}) };
  const method = String(opts.method || "GET").toUpperCase();
  const headers = { ...(opts.headers || {}) };
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  opts.headers = headers;
  return fetch(url, opts);
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
  } catch {
    return {};
  }
}

function getStoredPatientId() {
  try {
    const raw = localStorage.getItem(PATIENT_ID_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getStoredPatientName() {
  try {
    return localStorage.getItem(PATIENT_NAME_KEY) || "";
  } catch {
    return "";
  }
}

function storePatient(id, name) {
  try {
    localStorage.setItem(PATIENT_ID_KEY, String(id));
    localStorage.setItem(PATIENT_NAME_KEY, String(name || ""));
  } catch {
    // ignore
  }
}

function clearStoredPatient() {
  try {
    localStorage.removeItem(PATIENT_ID_KEY);
    localStorage.removeItem(PATIENT_NAME_KEY);
  } catch {
    // ignore
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

if (kioskTimesExtraList && !kioskTimesExtraList.querySelector("input[name='times_extra']")) {
  addExtraTimeInput(kioskTimesExtraList, "");
}

if (addTimeExtraBtn) {
  addTimeExtraBtn.addEventListener("click", () => addExtraTimeInput(kioskTimesExtraList, ""));
}

function applyPrefs() {
  document.body.classList.toggle("xl", !!prefs.xl);
  document.body.classList.toggle("hc", !!prefs.hc);
}

function setActiveTab(name, scrollTargetId) {
  if (!name) return;

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === name;
    if (button.classList.contains("view-tab")) {
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  });

  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== name;
  });

  if (scrollTargetId) {
    const target = document.getElementById(scrollTargetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowKeyDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function qsForPatient() {
  if (!patientId) return "";
  return `?patient_id=${encodeURIComponent(String(patientId))}`;
}

function updateClock() {
  const d = new Date();
  if (clockEl) {
    clockEl.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tabTarget, button.dataset.scrollTarget);
  });
});

setActiveTab("summary");

async function fetchStats() {
  try {
    const res = await apiFetch(`/api/stats/today${qsForPatient()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (activeCountEl) {
      activeCountEl.textContent = String(data.active_reminders || 0);
    }
    if (takenTodayEl) {
      takenTodayEl.textContent = String(data.taken_today || 0);
    }
    if (adherenceTodayEl) {
      const pct = (data.adherence_today ?? 0);
      adherenceTodayEl.textContent = `${pct}%`;
    }
    if (missedTodayEl) {
      missedTodayEl.textContent = String(data.missed_today || 0);
    }
  } catch {
    // ignore transient failures
  }
}

function dayNames(days) {
  const map = {
    0: "Dom",
    1: "Seg",
    2: "Ter",
    3: "Qua",
    4: "Qui",
    5: "Sex",
    6: "Sab"
  };
  return days.map(d => map[d]).join(", ");
}

function formatNextAlarmText() {
  if (!nextAlarmEl) return;
  const now = new Date();
  const active = reminders.filter(r => r.is_active);
  if (!active.length) {
    nextAlarmEl.textContent = "Sem alarmes ativos.";
    return;
  }

  let best = null;
  for (const r of active) {
    const times = Array.isArray(r.times) && r.times.length ? r.times : [r.time_hhmm];
    for (let plus = 0; plus <= 7; plus += 1) {
      const d = new Date(now);
      d.setDate(now.getDate() + plus);
      const weekday = d.getDay();
      if (!r.weekdays.includes(weekday)) {
        continue;
      }
      let foundForDay = false;
      for (const tt of times) {
        const [h, m] = String(tt).split(":").map(Number);
        const when = new Date(d);
        when.setHours(h, m, 0, 0);
        if (when < now) {
          continue;
        }
        foundForDay = true;
        if (!best || when < best.when) {
          best = { when: when, reminder: r, time: tt };
        }
      }
      if (foundForDay) {
        break;
      }
    }
  }

  if (!best) {
    nextAlarmEl.textContent = "Sem alarme futuro nos proximos dias.";
    return;
  }

  const when = best.when;
  const label = when.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" });
  nextAlarmEl.textContent = `${best.time} - ${best.reminder.medicine_name} (${best.reminder.dose}) em ${label}`;
}

function renderReminders() {
  if (!listEl) {
    return;
  }
  listEl.innerHTML = "";
  if (!reminders.length) {
    listEl.innerHTML = "<p>Sem alarmes. Crie o primeiro acima.</p>";
    return;
  }

  for (const r of reminders) {
    const card = document.createElement("article");
    card.className = `reminder-card ${r.is_active ? "" : "off"}`;
    const times = (r.times && r.times.length) ? r.times.join(", ") : r.time_hhmm;
    const safeId = Number(r.id) || 0;
    card.innerHTML = `
      <div class="reminder-top">
        <div>
          <div class="reminder-time">${escapeHtml(times)}</div>
          <div class="reminder-title">${escapeHtml(r.medicine_name)}</div>
          <div class="reminder-meta">${escapeHtml(r.dose)} | ${escapeHtml(r.patient_name)} | ${escapeHtml(dayNames(r.weekdays))}</div>
        </div>
      </div>
      <div class="reminder-actions">
        <button class="btn-mini toggle" data-id="${safeId}">${r.is_active ? "Desativar" : "Ativar"}</button>
        <button class="btn-mini delete" data-id="${safeId}">Apagar</button>
      </div>
    `;
    listEl.appendChild(card);
  }
}

function renderTodaySchedule() {
  if (!todayListEl) {
    return;
  }
  todayListEl.innerHTML = "";
  if (!todaySchedule.length) {
    todayListEl.innerHTML = "<p>Sem alarmes ativos para hoje.</p>";
    return;
  }

  for (const r of todaySchedule) {
    const item = document.createElement("div");
    item.className = `today-item ${r.status || ""}`.trim();
    const stock = (r.stock_count === null || r.stock_count === undefined) ? "" : ` | Stock: ${r.stock_count}`;
    item.innerHTML = `
      <div class="today-time">${escapeHtml(r.time_hhmm)}</div>
      <div class="today-main">
        <div class="today-title">${escapeHtml(r.medicine_name)}</div>
        <div class="today-meta">${escapeHtml(r.dose)} | ${escapeHtml(r.patient_name)}${escapeHtml(stock)}</div>
      </div>
    `;
    todayListEl.appendChild(item);
  }
}

async function loadReminders() {
  try {
    const res = await apiFetch(`/api/reminders${qsForPatient()}`);
    if (!res.ok) throw new Error("load reminders failed");
    const data = await res.json();
    reminders = data.items || [];
    reminders.sort((a, b) => (a.time_hhmm > b.time_hhmm ? 1 : -1));
    renderReminders();
    formatNextAlarmText();
    fetchStats();
  } catch {
    reminders = [];
    renderReminders();
    if (kioskMsgEl) kioskMsgEl.textContent = "Nao foi possivel carregar os alarmes.";
  }
}

async function loadSchedule() {
  try {
    const res = await apiFetch(`/api/schedule/today${qsForPatient()}`);
    if (!res.ok) throw new Error("load schedule failed");
    const data = await res.json();
    todaySchedule = data.items || [];
    renderTodaySchedule();
  } catch {
    todaySchedule = [];
    renderTodaySchedule();
  }
}

async function loadWeek() {
  if (!weekListEl) return;
  try {
    const res = await apiFetch(`/api/stats/week${qsForPatient()}`);
    if (!res.ok) throw new Error("load week failed");
    const data = await res.json();
    const days = data.days || [];
    weekListEl.innerHTML = "";
    for (const d of days) {
      const row = document.createElement("div");
      row.className = "week-row";
      const pct = `${d.adherence}%`;
      row.innerHTML = `<span>${escapeHtml(d.date)}</span><strong>${escapeHtml(pct)}</strong>`;
      weekListEl.appendChild(row);
    }
  } catch {
    weekListEl.innerHTML = "<p>Sem dados dos ultimos 7 dias.</p>";
  }
}

async function loadHistory() {
  if (!historyListEl) return;
  try {
    const res = await apiFetch(`/api/history/recent${qsForPatient()}`);
    if (!res.ok) throw new Error("load history failed");
    const data = await res.json();
    const items = data.items || [];
    historyListEl.innerHTML = "";
    if (!items.length) {
      historyListEl.innerHTML = `
        <div class="history-item">
          <div class="history-title">Sem historico ainda</div>
          <div class="history-meta">As ultimas confirmacoes aparecem aqui.</div>
        </div>
      `;
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "history-item";
      const late = Number(item.late_minutes || 0);
      const status = item.status === "taken" ? (late > 0 ? `Atraso ${late} min` : "Em dia") : (item.status || "Sem estado");
      row.innerHTML = `
        <div class="history-title">${escapeHtml(item.medicine_name)}</div>
        <div class="history-meta">${escapeHtml(item.dose)} | ${escapeHtml(status)} | ${escapeHtml(item.confirmed_at || "")}</div>
      `;
      historyListEl.appendChild(row);
    }
  } catch {
    historyListEl.innerHTML = `
      <div class="history-item">
        <div class="history-title">Historico indisponivel</div>
        <div class="history-meta">Nao foi possivel carregar os registos recentes.</div>
      </div>
    `;
  }
}

async function initKioskPatient() {
  try {
    const storedId = getStoredPatientId();
    const res = await apiFetch("/api/patient/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: storedId || "" })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.patient_id) {
      throw new Error("init failed");
    }
    patientId = data.patient_id;
    const name = data.display_name || getStoredPatientName() || "Utente";
    storePatient(patientId, name);
    if (patientCurrentEl) patientCurrentEl.textContent = name;
    if (kioskMsgEl) kioskMsgEl.textContent = "";
    return true;
  } catch {
    if (kioskMsgEl) kioskMsgEl.textContent = "Nao foi possivel iniciar o kiosk.";
    return false;
  }
}

async function setCurrentPatient(id) {
  const res = await apiFetch("/api/patient/current", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id: id })
  });
  if (!res.ok) return;
  patientId = id;
  await loadCurrentPatientLabel();
  await loadReminders();
  await loadSchedule();
  await loadWeek();
}

async function loadCurrentPatientLabel() {
  if (!patientCurrentEl) return;
  const res = await apiFetch(`/api/patient/current${qsForPatient()}`);
  const data = await res.json().catch(() => ({}));
  patientCurrentEl.textContent = data.display_name || "-";
}

function playAlarmTone() {
  if (beepTimer) {
    return;
  }
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  beepTimer = setInterval(() => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    setTimeout(() => osc.stop(), 220);
  }, 450);
}

function stopAlarmTone() {
  if (!beepTimer) {
    return;
  }
  clearInterval(beepTimer);
  beepTimer = null;
}

function speak(text) {
  if (!prefs.voice) return;
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-PT";
    u.rate = 0.95;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}

async function notify(text) {
  if (!("Notification" in window)) return;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission === "granted") {
      new Notification("LembreMe", { body: text });
    }
  } catch {
    // ignore
  }
}

function showAlarm(reminder) {
  currentAlarm = reminder;
  if (alarmTitle) {
    alarmTitle.textContent = "Hora da medicacao";
  }
  if (alarmDetail) {
    alarmDetail.textContent = `${reminder.patient_name}: ${reminder.medicine_name} (${reminder.dose})`;
  }
  if (modal) {
    modal.classList.remove("hidden");
  }
  if (btnCaregiver) {
    btnCaregiver.style.display = "none";
  }
  playAlarmTone();

  const text = `${reminder.patient_name}. Hora de ${reminder.medicine_name}. ${reminder.dose}.`;
  speak(text);
  notify(`${reminder.medicine_name} (${reminder.dose})`);

  // Repeat voice/notification every minute until confirmed/closed.
  if (alarmRepeatTimer) clearInterval(alarmRepeatTimer);
  alarmRepeatTimer = setInterval(() => {
    if (!currentAlarm) return;
    speak(text);
  }, 60 * 1000);

  // Escalate to caregiver after X minutes (shows button; optional email).
  const escMin = Number(prefs.escalation_minutes || 10);
  if (alarmEscalateTimer) clearTimeout(alarmEscalateTimer);
  alarmEscalateTimer = setTimeout(() => {
    if (!currentAlarm) return;
    if (btnCaregiver) btnCaregiver.style.display = "inline-flex";
    if (kioskMsgEl) kioskMsgEl.textContent = "Toma nao confirmada. Pode chamar o cuidador.";
  }, Math.max(1, escMin) * 60 * 1000);
}

function closeAlarm() {
  if (modal) {
    modal.classList.add("hidden");
  }
  stopAlarmTone();
  currentAlarm = null;
  if (alarmRepeatTimer) {
    clearInterval(alarmRepeatTimer);
    alarmRepeatTimer = null;
  }
  if (alarmEscalateTimer) {
    clearTimeout(alarmEscalateTimer);
    alarmEscalateTimer = null;
  }
}

function checkDueReminders() {
  if (!reminders.length) {
    return;
  }
  const now = new Date();
  const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const day = now.getDay();
  const dateKey = nowKeyDate();
  const nowMs = Date.now();

  for (const r of reminders) {
    if (!r.is_active || !r.weekdays.includes(day)) {
      continue;
    }
    const times = Array.isArray(r.times) && r.times.length ? r.times : [r.time_hhmm];
    if (!times.includes(hhmm)) {
      continue;
    }
    if (snoozeUntil[r.id] && nowMs < snoozeUntil[r.id]) {
      continue;
    }
    const key = `${r.id}-${dateKey}-${hhmm}`;
    if (firedKeys.has(key)) {
      continue;
    }
    firedKeys.add(key);
    showAlarm(Object.assign({}, r, { scheduled_time_hhmm: hhmm }));
    break;
  }
}

if (form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const selected = Array.from(form.querySelectorAll(".days input:checked")).map(el => Number(el.value));
    const payload = {
      patient_name: fd.get("patient_name") || "Utente",
      medicine_name: fd.get("medicine_name"),
      dose: fd.get("dose"),
      time_hhmm: fd.get("time_hhmm"),
      weekdays: selected
    };

    const res = await apiFetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (msg) {
        msg.textContent = data.message || "Erro ao guardar.";
      }
      return;
    }
    if (msg) {
      msg.textContent = "Alarme guardado com sucesso.";
    }
    form.reset();
    form.querySelectorAll(".days input").forEach(el => {
      el.checked = true;
    });
    loadReminders();
  });
}

if (kioskReminderForm) {
  kioskReminderForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!patientId) {
      const ok = await initKioskPatient();
      if (!ok || !patientId) {
        if (kioskFormMsg) kioskFormMsg.textContent = "Selecione um utente primeiro.";
        return;
      }
    }
    const fd = new FormData(kioskReminderForm);
    const base = String(fd.get("time_hhmm") || "").trim();
    const extraTimes = collectExtraTimes(kioskTimesExtraList);
    const times = [base].concat(extraTimes);
    const payload = {
      patient_id: patientId,
      patient_name: (patientCurrentEl && patientCurrentEl.textContent) ? patientCurrentEl.textContent : "Utente",
      medicine_name: fd.get("medicine_name"),
      dose: fd.get("dose"),
      time_hhmm: base,
      times: times,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      stock_count: String(fd.get("stock_count") || "").trim() === "" ? null : Number(fd.get("stock_count"))
    };
    const res = await apiFetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (kioskFormMsg) kioskFormMsg.textContent = data.message || "Erro ao guardar.";
      return;
    }
    if (kioskFormMsg) kioskFormMsg.textContent = "Medicamento guardado.";
    kioskReminderForm.reset();
    if (kioskTimesExtraList) {
      kioskTimesExtraList.innerHTML = "";
      addExtraTimeInput(kioskTimesExtraList, "");
    }
    await loadReminders();
    await loadSchedule();
    await loadWeek();
    await loadHistory();
  });
}

if (listEl) {
  listEl.addEventListener("click", async (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const id = target.dataset.id;
    if (!id) {
      return;
    }

    if (target.classList.contains("toggle")) {
      const r = reminders.find(x => String(x.id) === String(id));
      if (!r) {
        return;
      }
      await apiFetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !r.is_active, patient_id: patientId })
      });
      loadReminders();
    }

    if (target.classList.contains("delete")) {
      await apiFetch(`/api/reminders/${id}`, { method: "DELETE" });
      loadReminders();
    }
  });
}

if (btnConfirm) {
  btnConfirm.addEventListener("click", async () => {
    if (!currentAlarm) {
      closeAlarm();
      return;
    }
    const payload = { scheduled_time_hhmm: currentAlarm.scheduled_time_hhmm || null };
    const res = await apiFetch(`/api/reminders/${currentAlarm.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    try {
      const data = await res.json();
      if (data && data.low_stock && kioskMsgEl) {
        kioskMsgEl.textContent = `Stock baixo: ${data.low_stock.stock_count} (limite ${data.low_stock.threshold}).`;
      }
    } catch {
      // ignore
    }
    closeAlarm();
    loadReminders();
    loadSchedule();
    loadHistory();
  });
}

if (btnSnooze) {
  btnSnooze.addEventListener("click", () => {
    if (currentAlarm) {
      snoozeUntil[currentAlarm.id] = Date.now() + 5 * 60 * 1000;
    }
    closeAlarm();
  });
}

if (btnClose) {
  btnClose.addEventListener("click", closeAlarm);
}

// (kioskTitle currently unused but kept for possible future UX tweaks)

if (btnCaregiver) {
  btnCaregiver.addEventListener("click", async () => {
    if (!currentAlarm) return;
    const body = `Alerta: toma nao confirmada.\nUtente: ${currentAlarm.patient_name}\nMedicamento: ${currentAlarm.medicine_name}\nDose: ${currentAlarm.dose}\nHora: ${currentAlarm.scheduled_time_hhmm || currentAlarm.time_hhmm}\n`;
    const res = await apiFetch("/api/alerts/escalate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "LembreMe - Alerta de Medicacao", body })
    });
    let message = "";
    try {
      const payload = await res.json();
      message = (payload && payload.message) ? String(payload.message) : "";
    } catch {
      message = "";
    }
    if (kioskMsgEl) {
      kioskMsgEl.textContent = res.ok ? "Cuidador notificado." : (message || "Nao foi possivel notificar (configura email no Admin).");
    }
  });
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    if (kioskMsgEl) {
      kioskMsgEl.textContent = "Este navegador nao suporta manter o ecran ligado.";
    }
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    if (kioskMsgEl) {
      kioskMsgEl.textContent = "Ecran ligado: ativo.";
    }
    wakeLock.addEventListener("release", () => {
      if (kioskMsgEl) {
        kioskMsgEl.textContent = "Ecran ligado: desativado.";
      }
    });
  } catch {
    if (kioskMsgEl) {
      kioskMsgEl.textContent = "Nao foi possivel ativar o ecran ligado.";
    }
  }
}

async function requestFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      if (kioskMsgEl) {
        kioskMsgEl.textContent = "Ecran inteiro: ativo.";
      }
    }
  } catch {
    if (kioskMsgEl) {
      kioskMsgEl.textContent = "Nao foi possivel entrar em ecran inteiro.";
    }
  }
}

if (btnWakelock) {
  btnWakelock.addEventListener("click", requestWakeLock);
}

if (btnFullscreen) {
  btnFullscreen.addEventListener("click", requestFullscreen);
}

if (btnXl) {
  btnXl.addEventListener("click", () => {
    prefs.xl = !prefs.xl;
    applyPrefs();
    savePrefs();
  });
}

if (btnContrast) {
  btnContrast.addEventListener("click", () => {
    prefs.hc = !prefs.hc;
    applyPrefs();
    savePrefs();
  });
}

if (btnVoice) {
  btnVoice.addEventListener("click", async () => {
    prefs.voice = !prefs.voice;
    applyPrefs();
    savePrefs();
    if (prefs.voice && "speechSynthesis" in window) {
      speak("Voz ativada.");
    }
    if (prefs.voice && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch {}
    }
  });
}

async function loadPublicConfig() {
  try {
    const res = await apiFetch("/api/public_config");
    const data = await res.json();
    const esc = Number(data.escalation_minutes);
    if (!Number.isNaN(esc) && esc > 0) {
      prefs.escalation_minutes = esc;
      savePrefs();
    }
  } catch {
    // ignore
  }
}

applyPrefs();
updateClock();
initKioskPatient().then(async (ok) => {
  if (!ok && !patientId) {
    await loadCurrentPatientLabel();
    await loadReminders();
    await loadSchedule();
    await loadWeek();
    await loadHistory();
    return;
  }
  await loadCurrentPatientLabel();
  await loadReminders();
  await loadSchedule();
  await loadWeek();
  await loadHistory();
});
loadPublicConfig();
setInterval(updateClock, 1000);
setInterval(checkDueReminders, 1000);
setInterval(loadSchedule, 60 * 1000);
setInterval(loadWeek, 10 * 60 * 1000);
setInterval(loadHistory, 5 * 60 * 1000);
