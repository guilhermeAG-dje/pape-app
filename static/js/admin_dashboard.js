const patientCurrentEl = document.getElementById("patient-current");
const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
const csrfToken = csrfTokenMeta ? String(csrfTokenMeta.getAttribute("content") || "") : "";
const adherenceEl = document.getElementById("adherence-today");
const todayDetailEl = document.getElementById("today-detail");
const activeEl = document.getElementById("active-reminders");
const takenEl = document.getElementById("taken-today");
const missedEl = document.getElementById("missed-today");
const todayTableEl = document.getElementById("today-table");
const refreshBtn = document.getElementById("dashboard-refresh");
const updatedEl = document.getElementById("dashboard-updated");
const todayFilter = document.getElementById("today-filter");
const todayVisibleEl = document.getElementById("today-visible");
const todayTotalEl = document.getElementById("today-total");
const todayClear = document.querySelector('[data-clear-target="today-filter"]');
const todayStatusButtons = Array.from(document.querySelectorAll("[data-today-status]"));
const stockLowEl = document.getElementById("stock-low-count");
const stockZeroEl = document.getElementById("stock-zero-count");

const STORAGE_KEY = "lm_kiosk_patient_id_v1";

let weekChart = null;
let todayItems = [];
let todayStatusFilter = "";
let stockDefaultThreshold = 3;
let stockConfigLoaded = false;
let currentPatientId = null;
let currentPatientName = "";

function setHint(text) {
  if (patientCurrentEl) patientCurrentEl.textContent = text;
}

function setUpdated(ok) {
  if (!updatedEl) return;
  if (!ok) {
    updatedEl.textContent = "Atualizacao falhou.";
    return;
  }
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  updatedEl.textContent = `Atualizado: ${hh}:${mm}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function qsForPatient(pid) {
  if (!pid) return "";
  return `?patient_id=${encodeURIComponent(pid)}`;
}

function getStoredPatientId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch (_err) {
    return "";
  }
}

function setStoredPatientId(value) {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, String(value));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (_err) {
    // ignore storage errors
  }
}

function applyPatientContext(patientId, displayName) {
  currentPatientId = patientId || null;
  currentPatientName = displayName || "";
  if (currentPatientId) {
    setStoredPatientId(currentPatientId);
  }
  const label = currentPatientName
    ? `${currentPatientName} (#${currentPatientId})`
    : (currentPatientId ? `#${currentPatientId}` : "A reconhecer...");
  setHint(label);
}

async function initPatient() {
  try {
    const stored = getStoredPatientId();
    const headers = { "Content-Type": "application/json" };
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
    const res = await fetch("/api/patient/auto", {
      method: "POST",
      headers,
      body: JSON.stringify({ patient_id: stored || null })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.ok) {
      applyPatientContext(data.patient_id || null, data.display_name || "");
    }
  } catch {
    setHint("Nao foi possivel identificar o utente.");
  }
}

function getStockInfo(item) {
  const stock = (item.stock_count === null || item.stock_count === undefined) ? null : Number(item.stock_count);
  if (!Number.isFinite(stock)) {
    return { stock: null, threshold: null, isLow: false, isZero: false };
  }
  let threshold = (item.stock_low_threshold === null || item.stock_low_threshold === undefined) ? NaN : Number(item.stock_low_threshold);
  if (!Number.isFinite(threshold)) {
    threshold = stockDefaultThreshold;
  }
  const isZero = stock <= 0;
  const isLow = !isZero && Number.isFinite(threshold) && stock <= threshold;
  return { stock, threshold: Number.isFinite(threshold) ? threshold : null, isLow, isZero };
}

async function loadStockConfig() {
  if (stockConfigLoaded) return true;
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Falha ao carregar configuracoes.");
    const data = await res.json();
    const raw = data && data.config ? data.config.stock_low_default : null;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      stockDefaultThreshold = parsed;
    }
    stockConfigLoaded = true;
    return true;
  } catch {
    return false;
  }
}

async function loadToday(pid) {
  try {
    const res = await fetch(`/api/schedule/today${qsForPatient(pid)}`);
    if (!res.ok) throw new Error("Falha ao carregar agenda.");
    const data = await res.json();
    const items = data.items || [];
    let missed = 0;
    for (const it of items) {
      if (it.status === "missed") missed += 1;
    }

    const statsRes = await fetch(`/api/stats/today${qsForPatient(pid)}`);
    if (!statsRes.ok) throw new Error("Falha ao carregar estatisticas.");
    const stats = await statsRes.json();

    if (adherenceEl) adherenceEl.textContent = `${stats.adherence_today || 0}%`;
    if (todayDetailEl) todayDetailEl.textContent = `${stats.taken_today || 0}/${stats.expected_today || 0}`;
    if (activeEl) activeEl.textContent = String(stats.active_reminders || 0);
    if (takenEl) takenEl.textContent = String(stats.taken_today || 0);
    if (missedEl) missedEl.textContent = String(missed);

    todayItems = items;
    renderTodayTable();
    return true;
  } catch {
    todayItems = [];
    renderTodayTable();
    setHint("Não foi possível carregar dados de hoje.");
  }
  return false;
}

function buildTodaySearch(it) {
  return normalizeText(`${it.time_hhmm} ${it.medicine_name} ${it.dose} ${it.status || ""}`);
}

function getFilteredTodayItems() {
  const query = normalizeText(todayFilter ? todayFilter.value : "");
  const tokens = query.split(/\s+/).filter(Boolean);
  return todayItems.filter((it) => {
    if (todayStatusFilter && it.status !== todayStatusFilter) {
      return false;
    }
    if (!tokens.length) {
      return true;
    }
    const haystack = it.__search || buildTodaySearch(it);
    it.__search = haystack;
    return tokens.every((token) => haystack.includes(token));
  });
}

function updateTodayStatusButtons() {
  if (!todayStatusButtons.length) return;
  todayStatusButtons.forEach((btn) => {
    const status = btn.dataset.todayStatus || "";
    const isActive = status === todayStatusFilter && status !== "";
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function renderTodayTable() {
  if (!todayTableEl) return;
  const filtered = getFilteredTodayItems();
  if (todayTotalEl) {
    todayTotalEl.textContent = String(todayItems.length);
  }
  if (todayVisibleEl) {
    todayVisibleEl.textContent = String(filtered.length);
  }
  if (todayClear) {
    todayClear.hidden = !normalizeText(todayFilter ? todayFilter.value : "");
  }
  if (!filtered.length) {
    const emptyMessage = todayItems.length ? "Sem resultados para o filtro atual." : "Sem alarmes para hoje.";
    todayTableEl.innerHTML = `<p class="muted">${emptyMessage}</p>`;
    return;
  }
  const rows = filtered.map((it) => {
    const s = it.status || "upcoming";
    const badge = s === "taken" ? "success" : (s === "missed" ? "error" : "");
    const label = s === "taken" ? "Tomou" : (s === "missed" ? "Em falta" : "Por vir");
    const rowClass = s === "taken" ? "table-row-taken" : (s === "missed" ? "table-row-missed" : "table-row-upcoming");
    const stockInfo = getStockInfo(it);
    let stockTag = "";
    if (stockInfo.stock !== null) {
      if (stockInfo.isZero) {
        stockTag = `<span class="tag tag-danger">Stock esgotado: ${escapeHtml(stockInfo.stock)}</span>`;
      } else if (stockInfo.isLow) {
        const limitLabel = stockInfo.threshold !== null ? ` (limite ${escapeHtml(stockInfo.threshold)})` : "";
        stockTag = `<span class="tag tag-warning">Stock baixo: ${escapeHtml(stockInfo.stock)}${limitLabel}</span>`;
      } else {
        stockTag = `<span class="tag">Stock: ${escapeHtml(stockInfo.stock)}</span>`;
      }
    }
    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(it.time_hhmm)}</td>
        <td>${escapeHtml(it.medicine_name)}</td>
        <td>${escapeHtml(it.dose)}</td>
        <td>
          <div class="table-status">
            <span class="status ${badge}">${label}</span>
            ${stockTag}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  todayTableEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Hora</th>
          <th>Medicamento</th>
          <th>Dose</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadWeek(pid) {
  const ctx = document.getElementById("weekChart");
  if (!ctx) return true;
  try {
    const res = await fetch(`/api/stats/week${qsForPatient(pid)}`);
    if (!res.ok) throw new Error("Falha ao carregar semana.");
    const data = await res.json();
    const days = data.days || [];
    const labels = days.map((d) => d.date);
    const values = days.map((d) => d.adherence);

    if (weekChart) weekChart.destroy();
    weekChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Adesão (%)",
          data: values,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34, 197, 94, 0.12)",
          fill: true,
          tension: 0.3
        }]
      },
      options: { responsive: true, scales: { y: { min: 0, max: 100 } } }
    });
    return true;
  } catch {
    if (weekChart) weekChart.destroy();
    setHint("Não foi possível carregar o gráfico semanal.");
  }
  return false;
}

async function loadStock(pid) {
  await loadStockConfig();
  try {
    const res = await fetch(`/api/reminders${qsForPatient(pid)}`);
    if (!res.ok) throw new Error("Falha ao carregar alarmes.");
    const data = await res.json();
    const items = data.items || [];
    let low = 0;
    let zero = 0;

    items.forEach((r) => {
      if (r.is_active === false) {
        return;
      }
      const stockInfo = getStockInfo(r);
      if (stockInfo.stock === null) {
        return;
      }
      if (stockInfo.isZero) {
        zero += 1;
        return;
      }
      if (stockInfo.isLow) {
        low += 1;
      }
    });

    if (stockLowEl) stockLowEl.textContent = String(low);
    if (stockZeroEl) stockZeroEl.textContent = String(zero);
    return true;
  } catch {
    if (stockLowEl) stockLowEl.textContent = "0";
    if (stockZeroEl) stockZeroEl.textContent = "0";
    return false;
  }
}

async function refresh() {
  if (!currentPatientId) {
    await initPatient();
  }
  const pid = currentPatientId;
  if (currentPatientId) {
    const label = currentPatientName
      ? `${currentPatientName} (#${currentPatientId})`
      : `#${currentPatientId}`;
    setHint(label);
  }
  await loadStockConfig();
  const okToday = await loadToday(pid);
  const okWeek = await loadWeek(pid);
  const okStock = await loadStock(pid);
  setUpdated(okToday && okWeek && okStock);
}

initPatient().then(refresh);
setInterval(refresh, 60 * 1000);

window.addEventListener("admin:patient-changed", (event) => {
  const detail = event.detail || {};
  applyPatientContext(detail.patientId || null, detail.displayName || "");
  refresh();
});

if (refreshBtn) {
  refreshBtn.addEventListener("click", refresh);
}

if (todayFilter) {
  todayFilter.addEventListener("input", renderTodayTable);
  todayFilter.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!todayFilter.value) {
      return;
    }
    event.preventDefault();
    todayFilter.value = "";
    renderTodayTable();
  });
}

if (todayClear) {
  todayClear.addEventListener("click", () => {
    if (!todayFilter) return;
    todayFilter.value = "";
    renderTodayTable();
    todayFilter.focus();
  });
}

if (todayStatusButtons.length) {
  todayStatusButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const status = btn.dataset.todayStatus || "";
      todayStatusFilter = todayStatusFilter === status ? "" : status;
      updateTodayStatusButtons();
      renderTodayTable();
    });
  });
  updateTodayStatusButtons();
}

window.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  const target = event.target;
  const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea") {
    return;
  }
  if (!todayFilter) {
    return;
  }
  event.preventDefault();
  todayFilter.focus();
  todayFilter.select();
});

