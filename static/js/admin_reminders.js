const form = document.getElementById("reminder-form");
const msg = document.getElementById("form-message");
const listEl = document.getElementById("reminders-list");
const remindersFilter = document.getElementById("reminders-filter");
const remindersVisibleEl = document.getElementById("reminders-visible");
const remindersTotalEl = document.getElementById("reminders-total");
const remindersEmptyEl = document.getElementById("reminders-empty");
const remindersEmptyAction = document.getElementById("reminders-empty-action");
const remindersEmptyFocus = document.getElementById("reminders-empty-focus");
const remindersActiveToggle = document.getElementById("reminders-active-toggle");
const remindersClear = document.querySelector('[data-clear-target="reminders-filter"]');
const remindersStockButtons = Array.from(document.querySelectorAll("[data-stock-filter]"));
const configForm = document.getElementById("config-form");
const configMsg = document.getElementById("config-message");
const csvForm = document.getElementById("csv-form");
const csvMsg = document.getElementById("csv-message");
const patientNameEl = document.getElementById("patient-current");
const patientIdEl = document.getElementById("patient-id");
const timesExtraGroup = form ? form.querySelector("[data-times-extra-group]") : null;
const timesExtraAddBtn = form ? form.querySelector("[data-times-extra-add]") : null;
const createScheduleInputs = form ? Array.from(form.querySelectorAll('input[name="schedule_mode"]')) : [];
const createWeekdayPicker = form ? form.querySelector("[data-weekday-picker]") : null;
const createPillInput = form ? form.querySelector('input[name="pill_image"]') : null;
const createPillPreviewCard = form ? form.querySelector("[data-pill-preview-card]") : null;
const createPillPreviewImg = form ? form.querySelector("[data-pill-preview]") : null;
const createPillPreviewName = form ? form.querySelector("[data-pill-preview-name]") : null;
const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
const csrfToken = csrfTokenMeta ? String(csrfTokenMeta.getAttribute("content") || "") : "";

const STORAGE_KEY = "lm_kiosk_patient_id_v1";

let reminders = [];
let currentPatientId = null;
let filterActiveOnly = false;
let editingId = null;
let stockFilter = "";
let stockDefaultThreshold = 3;
let configCache = {};

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

function addExtraTimeInput(container, value) {
  if (!container) return;
  const row = document.createElement("div");
  row.className = "times-extra-item";
  const input = document.createElement("input");
  input.type = "time";
  input.name = "times_extra";
  input.setAttribute("aria-label", "Outras horas");
  if (value) {
    input.value = value;
  }
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-outline btn-inline times-extra-remove";
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

function setExtraTimes(container, values) {
  if (!container) return;
  container.innerHTML = "";
  if (!values || !values.length) {
    addExtraTimeInput(container, "");
    return;
  }
  values.forEach((val) => addExtraTimeInput(container, val));
}

function renderEditExtraInputs(values, safeId) {
  const list = Array.isArray(values) && values.length ? values : [""];
  return list
    .map((val) => `
      <div class="times-extra-item">
        <input class="input-base" type="time" data-edit-extra-time value="${escapeHtml(val || "")}" />
        <button type="button" class="btn-outline btn-inline times-extra-remove" data-action="remove-extra" data-id="${safeId}">Remover</button>
      </div>
    `)
    .join("");
}

function buildEditExtraRow(value, safeId) {
  const row = document.createElement("div");
  row.className = "times-extra-item";
  const input = document.createElement("input");
  input.type = "time";
  input.className = "input-base";
  input.setAttribute("data-edit-extra-time", "");
  if (value) {
    input.value = value;
  }
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-outline btn-inline times-extra-remove";
  removeBtn.textContent = "Remover";
  removeBtn.setAttribute("data-action", "remove-extra");
  removeBtn.setAttribute("data-id", String(safeId || ""));
  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
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

function showMsg(text, kind) {
  if (!msg) return;
  msg.style.display = "block";
  msg.className = `status ${kind || ""}`.trim();
  msg.textContent = text;
}

function showBox(el, text, kind) {
  if (!el) return;
  el.style.display = "block";
  el.className = `status ${kind || ""}`.trim();
  el.textContent = text;
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
  if (patientNameEl) {
    patientNameEl.textContent = displayName || "Utente";
  }
  if (patientIdEl) {
    patientIdEl.textContent = currentPatientId ? `#${currentPatientId}` : "--";
  }
  if (currentPatientId) {
    setStoredPatientId(currentPatientId);
  }
}

async function initPatient() {
  try {
    const stored = getStoredPatientId();
    const res = await apiFetch("/api/patient/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: stored || null })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.ok) {
      applyPatientContext(data.patient_id || null, data.display_name || "");
    }
  } catch (_err) {
    if (patientNameEl) {
      patientNameEl.textContent = "Nao foi possivel identificar";
    }
    if (patientIdEl) {
      patientIdEl.textContent = "--";
    }
  }
}

window.addEventListener("admin:patient-changed", (event) => {
  const detail = event.detail || {};
  applyPatientContext(detail.patientId || null, detail.displayName || "");
  load();
});

function dayNames(days) {
  const map = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sab" };
  const list = (days || []).map(d => map[d]).filter(Boolean);
  return list.length ? list.join(", ") : "-";
}

function dayOptions() {
  return [
    { value: 1, label: "Seg" },
    { value: 2, label: "Ter" },
    { value: 3, label: "Qua" },
    { value: 4, label: "Qui" },
    { value: 5, label: "Sex" },
    { value: 6, label: "Sab" },
    { value: 0, label: "Dom" }
  ];
}

function getSelectedScheduleMode(inputs) {
  const checked = (inputs || []).find((input) => input.checked);
  return checked ? String(checked.value || "daily") : "daily";
}

function syncWeekdayPicker(inputs, picker) {
  if (!picker) return;
  picker.hidden = getSelectedScheduleMode(inputs) !== "weekly";
}

function resetWeekdayChecks(container) {
  if (!container) return;
  Array.from(container.querySelectorAll('input[name="weekdays"]')).forEach((input) => {
    if (input instanceof HTMLInputElement) {
      input.checked = false;
    }
  });
}

function updatePillPreview(input, card, image, label) {
  if (!card || !image) return;
  const previousUrl = card.dataset.objectUrl || "";
  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
    delete card.dataset.objectUrl;
  }

  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) {
    card.hidden = true;
    image.removeAttribute("src");
    if (label) label.textContent = "";
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  card.dataset.objectUrl = objectUrl;
  image.src = objectUrl;
  if (label) label.textContent = file.name;
  card.hidden = false;
}

function scheduleLabel(reminder) {
  if (String(reminder.schedule_mode || "") === "weekly") {
    return `Semanal: ${dayNames(reminder.weekdays || [])}`;
  }
  return "Diario";
}

function pillThumb(url, medicineName, className) {
  if (!url) {
    return `<div class="rem-admin-thumb rem-admin-thumb-placeholder ${className || ""}" aria-hidden="true">Sem foto</div>`;
  }
  return `<img class="rem-admin-thumb ${className || ""}" src="${escapeHtml(url)}" alt="Comprimido ${escapeHtml(medicineName || "")}" />`;
}

function syncEditWeekdayBlock(rowEl) {
  if (!rowEl) return;
  const checked = rowEl.querySelector('[data-edit-schedule-mode]:checked');
  const daysBlock = rowEl.querySelector("[data-edit-days-block]");
  if (!daysBlock) return;
  const mode = checked instanceof HTMLInputElement ? String(checked.value || "daily") : "daily";
  daysBlock.classList.toggle("is-hidden", mode !== "weekly");
}

function buildSearch(r) {
  const times = (r.times && r.times.length) ? r.times.join(" ") : r.time_hhmm;
  const days = dayNames(r.weekdays || []);
  const stock = (r.stock_count === null || r.stock_count === undefined) ? "" : String(r.stock_count);
  const stockLow = (r.stock_low_threshold === null || r.stock_low_threshold === undefined) ? "" : String(r.stock_low_threshold);
  return normalizeText(`${r.medicine_name} ${r.dose} ${times} ${days} ${scheduleLabel(r)} ${stock} ${stockLow}`);
}

function parseTimes(base, extra) {
  const values = [];
  const rawBase = String(base || "").trim();
  if (rawBase) {
    values.push(rawBase);
  }
  const extraParts = String(extra || "")
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  extraParts.forEach((val) => values.push(val));

  const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const unique = [];
  const seen = new Set();
  for (const t of values) {
    if (!TIME_RE.test(t)) {
      return { ok: false, message: "Hora invalida. Use HH:MM." };
    }
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  if (!unique.length) {
    return { ok: false, message: "Indique pelo menos uma hora valida." };
  }
  unique.sort();
  return { ok: true, times: unique };
}

function getStockInfo(r) {
  const stock = (r.stock_count === null || r.stock_count === undefined) ? null : Number(r.stock_count);
  if (!Number.isFinite(stock)) {
    return { stock: null, threshold: null, isLow: false, isZero: false };
  }
  let threshold = (r.stock_low_threshold === null || r.stock_low_threshold === undefined) ? NaN : Number(r.stock_low_threshold);
  if (!Number.isFinite(threshold)) {
    threshold = stockDefaultThreshold;
  }
  const isZero = stock <= 0;
  const isLow = !isZero && Number.isFinite(threshold) && stock <= threshold;
  return { stock, threshold: Number.isFinite(threshold) ? threshold : null, isLow, isZero };
}

function getFilteredReminders() {
  const query = normalizeText(remindersFilter ? remindersFilter.value : "");
  const tokens = query.split(/\s+/).filter(Boolean);
  return reminders.filter((r) => {
    if (filterActiveOnly && !r.is_active) {
      return false;
    }
    if (stockFilter) {
      const stockInfo = getStockInfo(r);
      if (stockFilter === "low" && !stockInfo.isLow) {
        return false;
      }
      if (stockFilter === "zero" && !stockInfo.isZero) {
        return false;
      }
    }
    if (!tokens.length) {
      return true;
    }
    if (!r.__search) {
      r.__search = buildSearch(r);
    }
    return tokens.every((token) => r.__search.includes(token));
  });
}

function updateFilterToggle() {
  if (!remindersActiveToggle) return;
  remindersActiveToggle.classList.toggle("is-active", filterActiveOnly);
  remindersActiveToggle.setAttribute("aria-pressed", filterActiveOnly ? "true" : "false");
}

function updateStockFilterButtons() {
  if (!remindersStockButtons.length) return;
  remindersStockButtons.forEach((btn) => {
    const value = btn.dataset.stockFilter || "";
    const isActive = value && value === stockFilter;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function render() {
  if (!listEl) return;
  const total = reminders.length;
  const filtered = getFilteredReminders();
  const visible = filtered.length;

  if (remindersTotalEl) {
    remindersTotalEl.textContent = String(total);
  }
  if (remindersVisibleEl) {
    remindersVisibleEl.textContent = String(visible);
  }
  if (remindersClear) {
    remindersClear.hidden = !normalizeText(remindersFilter ? remindersFilter.value : "");
  }

  listEl.innerHTML = "";
  if (remindersEmptyEl) {
    remindersEmptyEl.hidden = true;
  }
  if (remindersEmptyAction) {
    remindersEmptyAction.hidden = true;
  }

  if (!filtered.length) {
    if (remindersEmptyEl) {
      remindersEmptyEl.textContent = total === 0 ? "Sem alarmes registados." : "Sem resultados para o filtro atual.";
      remindersEmptyEl.hidden = false;
    } else {
      listEl.innerHTML = `<p class="muted">${total === 0 ? "Sem alarmes. Adiciona o primeiro acima." : "Sem resultados para o filtro atual."}</p>`;
    }
    if (remindersEmptyAction && total === 0) {
      remindersEmptyAction.hidden = false;
    }
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "rem-admin-list";

  for (const r of filtered) {
    const isEditing = Number(editingId) === Number(r.id);
    const row = document.createElement("div");
    row.className = `rem-admin-row ${r.is_active ? "" : "off"}${isEditing ? " is-editing" : ""}`.trim();
    row.dataset.reminderId = String(r.id);
    const times = (r.times && r.times.length) ? r.times.join(", ") : r.time_hhmm;
    const mainTime = (r.times && r.times.length) ? r.times[0] : r.time_hhmm;
    const extraTimes = (r.times && r.times.length > 1) ? r.times.slice(1) : [];
    const stockRaw = (r.stock_count === null || r.stock_count === undefined) ? "" : String(r.stock_count);
    const stockLowRaw = (r.stock_low_threshold === null || r.stock_low_threshold === undefined) ? "" : String(r.stock_low_threshold);
    const stockInfo = getStockInfo(r);
    const safeId = Number(r.id) || 0;
    const scheduleMode = String(r.schedule_mode || "") === "weekly" ? "weekly" : "daily";
    const tags = [];
    tags.push(`<span class="tag ${r.is_active ? "tag-ok" : "tag-danger"}">${r.is_active ? "Ativo" : "Inativo"}</span>`);
    if (stockInfo.stock !== null) {
      if (stockInfo.isZero) {
        tags.push(`<span class="tag tag-danger">Stock esgotado: ${escapeHtml(stockInfo.stock)}</span>`);
      } else if (stockInfo.isLow) {
        const limitLabel = stockInfo.threshold !== null ? ` (limite ${escapeHtml(stockInfo.threshold)})` : "";
        tags.push(`<span class="tag tag-warning">Stock baixo: ${escapeHtml(stockInfo.stock)}${limitLabel}</span>`);
      } else {
        tags.push(`<span class="tag">Stock: ${escapeHtml(stockInfo.stock)}</span>`);
      }
    }
    row.innerHTML = `
      <div class="rem-admin-main">
        ${pillThumb(r.pill_image_url, r.medicine_name)}
        <div class="rem-admin-time">${escapeHtml(times)}</div>
        <div>
          <div class="rem-admin-title">${escapeHtml(r.medicine_name)}</div>
          <div class="muted">${escapeHtml(r.dose)} | ${escapeHtml(scheduleLabel(r))}</div>
          ${tags.length ? `<div class="rem-admin-tags">${tags.join("")}</div>` : ""}
          ${isEditing ? `
            <div class="rem-admin-edit">
              <div class="edit-grid">
                <div>
                  <label for="edit-main-${safeId}">Hora principal</label>
                  <input id="edit-main-${safeId}" class="input-base" type="time" data-edit-main value="${escapeHtml(mainTime || "")}" required />
                </div>
                <div>
                  <label>Outras horas</label>
                  <div class="edit-extra-times" data-edit-extra-group>
                    ${renderEditExtraInputs(extraTimes, safeId)}
                  </div>
                  <button type="button" class="btn-outline btn-inline" data-action="add-extra" data-id="${safeId}">Adicionar hora</button>
                </div>
                <div>
                  <label for="edit-stock-${safeId}">Stock atual</label>
                  <input id="edit-stock-${safeId}" class="input-base" type="number" min="0" step="1" data-edit-stock value="${escapeHtml(stockRaw)}" placeholder="Ex: 12" />
                </div>
                <div>
                  <label for="edit-stock-low-${safeId}">Limite de stock baixo</label>
                  <input id="edit-stock-low-${safeId}" class="input-base" type="number" min="0" step="1" data-edit-stock-low value="${escapeHtml(stockLowRaw)}" placeholder="${Number.isFinite(stockDefaultThreshold) ? "Defeito: " + stockDefaultThreshold : "Sem limite"}" />
                  <p class="muted small">Deixe vazio para usar o limite global.</p>
                </div>
                <div class="edit-schedule">
                  <span class="muted small">Frequencia</span>
                  <div class="edit-days-list">
                    <label class="edit-day">
                      <input type="radio" name="edit-schedule-${safeId}" data-edit-schedule-mode value="daily" ${scheduleMode === "daily" ? "checked" : ""} />
                      Diario
                    </label>
                    <label class="edit-day">
                      <input type="radio" name="edit-schedule-${safeId}" data-edit-schedule-mode value="weekly" ${scheduleMode === "weekly" ? "checked" : ""} />
                      Semanal
                    </label>
                  </div>
                </div>
                <div class="edit-days${scheduleMode === "weekly" ? "" : " is-hidden"}" data-edit-days-block>
                  <div class="edit-days-header">
                    <span class="muted small">Dias</span>
                    <div class="edit-day-actions">
                      <button type="button" class="btn-outline btn-inline" data-action="days-all" data-id="${safeId}">Todos</button>
                      <button type="button" class="btn-outline btn-inline" data-action="days-none" data-id="${safeId}">Nenhum</button>
                    </div>
                  </div>
                  <div class="edit-days-list" data-edit-weekday-picker>
                    ${dayOptions().map((d) => `
                      <label class="edit-day">
                        <input type="checkbox" data-edit-weekday value="${d.value}" ${Array.isArray(r.weekdays) && r.weekdays.includes(d.value) ? "checked" : ""} />
                        ${d.label}
                      </label>
                    `).join("")}
                  </div>
                </div>
                <div class="edit-pill-panel">
                  <label>Imagem do comprimido</label>
                  <div class="edit-pill-current">
                    ${pillThumb(r.pill_image_url, r.medicine_name, "rem-admin-thumb-small")}
                    <div>
                      <div class="muted small">${r.pill_image_url ? "Imagem atual guardada." : "Sem imagem guardada."}</div>
                      <input class="input-base" type="file" data-edit-pill-image accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" />
                      <label class="edit-remove-pill"><input type="checkbox" data-edit-remove-pill /> Remover imagem atual</label>
                    </div>
                  </div>
                </div>
              </div>
              <div class="rem-admin-edit-actions">
                <button type="button" class="btn-primary" data-action="save" data-id="${safeId}">Guardar</button>
                <button type="button" class="btn-outline" data-action="cancel" data-id="${safeId}">Cancelar</button>
              </div>
            </div>
          ` : ""}
        </div>
      </div>
      <div class="rem-admin-actions">
        <button class="btn-outline" data-action="edit" data-id="${safeId}">${isEditing ? "Fechar" : "Editar"}</button>
        <button class="btn-outline" data-action="toggle" data-id="${safeId}">${r.is_active ? "Desativar" : "Ativar"}</button>
        <button class="btn-primary" data-action="delete" data-id="${safeId}">Apagar</button>
      </div>
    `;
    wrap.appendChild(row);
  }

  listEl.appendChild(wrap);
}

async function load() {
  if (!currentPatientId) {
    await initPatient();
  }
  const qs = currentPatientId ? `?patient_id=${encodeURIComponent(currentPatientId)}` : "";
  try {
    const res = await apiFetch(`/api/reminders${qs}`);
    const data = await res.json();
    reminders = data.items || [];
    reminders.sort((a, b) => (a.time_hhmm > b.time_hhmm ? 1 : -1));
    reminders.forEach((r) => {
      delete r.__search;
    });
    render();
  } catch {
    reminders = [];
    render();
    showMsg("Nao foi possivel carregar os alarmes.", "error");
  }
}

function setupFilterControls() {
  if (remindersFilter) {
    remindersFilter.addEventListener("input", render);
    remindersFilter.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (!remindersFilter.value) {
        return;
      }
      event.preventDefault();
      remindersFilter.value = "";
      render();
    });
  }

  if (remindersClear) {
    remindersClear.addEventListener("click", () => {
      if (!remindersFilter) {
        return;
      }
      remindersFilter.value = "";
      render();
      remindersFilter.focus();
    });
  }

  if (remindersActiveToggle) {
    remindersActiveToggle.addEventListener("click", () => {
      filterActiveOnly = !filterActiveOnly;
      updateFilterToggle();
      render();
    });
    updateFilterToggle();
  }

  if (remindersStockButtons.length) {
    remindersStockButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.dataset.stockFilter || "";
        stockFilter = stockFilter === value ? "" : value;
        updateStockFilterButtons();
        render();
      });
    });
    updateStockFilterButtons();
  }

  if (remindersEmptyFocus && form) {
    remindersEmptyFocus.addEventListener("click", () => {
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      const focusField = form.querySelector("input[name='medicine_name']");
      if (focusField) {
        focusField.focus();
      }
    });
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
    if (!remindersFilter) {
      return;
    }
    event.preventDefault();
    remindersFilter.focus();
    remindersFilter.select();
  });
}

if (form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const selected = Array.from(form.querySelectorAll('input[name="weekdays"]:checked')).map(el => Number(el.value));
    const baseTime = fd.get("time_hhmm");
    const extraTimes = collectExtraTimes(timesExtraGroup);
    const times = [String(baseTime || "").trim()].concat(extraTimes);
    const scheduleMode = getSelectedScheduleMode(createScheduleInputs);
    const body = new FormData();
    body.append("patient_id", String(currentPatientId || ""));
    body.append("medicine_name", String(fd.get("medicine_name") || ""));
    body.append("dose", String(fd.get("dose") || ""));
    body.append("time_hhmm", String(baseTime || ""));
    body.append("schedule_mode", scheduleMode);
    times.forEach((time) => {
      if (String(time || "").trim()) {
        body.append("times", String(time).trim());
      }
    });
    if (scheduleMode === "weekly") {
      selected.forEach((day) => body.append("weekdays", String(day)));
    }
    const stockCount = fd.get("stock_count");
    const stockLow = fd.get("stock_low_threshold");
    if (String(stockCount || "").trim() !== "") body.append("stock_count", String(stockCount));
    if (String(stockLow || "").trim() !== "") body.append("stock_low_threshold", String(stockLow));
    const pillFile = createPillInput && createPillInput.files && createPillInput.files[0] ? createPillInput.files[0] : null;
    if (pillFile) body.append("pill_image", pillFile);

    const res = await apiFetch("/api/reminders", {
      method: "POST",
      body
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showMsg(data.message || "Erro ao guardar.", "error");
      return;
    }
    showMsg("Alarme guardado.", "success");
    form.reset();
    setExtraTimes(timesExtraGroup, []);
    resetWeekdayChecks(createWeekdayPicker);
    syncWeekdayPicker(createScheduleInputs, createWeekdayPicker);
    updatePillPreview(createPillInput, createPillPreviewCard, createPillPreviewImg, createPillPreviewName);
    load();
  });

  form.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const template = t.dataset.template;
    if (!template) return;
    const timeInput = form.querySelector("input[name=time_hhmm]");
    if (template === "manha") {
      if (timeInput) timeInput.value = "08:00";
      setExtraTimes(timesExtraGroup, []);
    }
    if (template === "dia") {
      if (timeInput) timeInput.value = "08:00";
      setExtraTimes(timesExtraGroup, ["14:00", "20:00"]);
    }
    if (template === "noite") {
      if (timeInput) timeInput.value = "22:00";
      setExtraTimes(timesExtraGroup, []);
    }
  });
}

if (listEl) {
  listEl.addEventListener("click", async (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) return;
    const safeId = Number(id);
    const rowEl = listEl.querySelector(`[data-reminder-id="${String(id)}"]`);

    if (action === "edit") {
      editingId = Number(editingId) === Number(safeId) ? null : safeId;
      render();
      return;
    }

    if (action === "cancel") {
      editingId = null;
      render();
      return;
    }

    if (action === "days-all" || action === "days-none") {
      if (!rowEl) return;
      const checks = Array.from(rowEl.querySelectorAll("[data-edit-weekday]"));
      const shouldCheck = action === "days-all";
      checks.forEach((el) => {
        if (el instanceof HTMLInputElement) {
          el.checked = shouldCheck;
        }
      });
      return;
    }

    if (action === "add-extra") {
      if (!rowEl) return;
      const group = rowEl.querySelector("[data-edit-extra-group]");
      if (!group) return;
      group.appendChild(buildEditExtraRow("", safeId));
      return;
    }

    if (action === "remove-extra") {
      if (!rowEl) return;
      const group = rowEl.querySelector("[data-edit-extra-group]");
      if (!group) return;
      const item = target.closest(".times-extra-item");
      if (item) {
        item.remove();
      }
      if (!group.querySelector("[data-edit-extra-time]")) {
        group.appendChild(buildEditExtraRow("", safeId));
      }
      return;
    }

    if (action === "save") {
      if (!rowEl) return;
      const mainInput = rowEl.querySelector("[data-edit-main]");
      const stockInput = rowEl.querySelector("[data-edit-stock]");
      const stockLowInput = rowEl.querySelector("[data-edit-stock-low]");
      const dayInputs = Array.from(rowEl.querySelectorAll("[data-edit-weekday]"));
      const scheduleInputs = Array.from(rowEl.querySelectorAll("[data-edit-schedule-mode]"));
      const scheduleMode = getSelectedScheduleMode(scheduleInputs);
      if (!(mainInput instanceof HTMLInputElement)) {
        return;
      }
      const weekdays = dayInputs
        .filter((el) => el instanceof HTMLInputElement && el.checked)
        .map((el) => Number(el.value))
        .filter((val) => Number.isFinite(val));
      if (scheduleMode === "weekly" && !weekdays.length) {
        showMsg("Selecione pelo menos um dia.", "error");
        return;
      }
      const extraInputs = Array.from(rowEl.querySelectorAll("[data-edit-extra-time]"));
      const extraTimes = extraInputs
        .filter((el) => el instanceof HTMLInputElement)
        .map((el) => String(el.value || "").trim())
        .filter(Boolean);
      const parsed = parseTimes(mainInput.value, extraTimes.join(", "));
      if (!parsed.ok) {
        showMsg(parsed.message, "error");
        return;
      }
      const payload = new FormData();
      payload.append("time_hhmm", parsed.times[0]);
      payload.append("schedule_mode", scheduleMode);
      parsed.times.forEach((time) => payload.append("times", time));
      if (scheduleMode === "weekly") {
        weekdays.forEach((day) => payload.append("weekdays", String(day)));
      }

      if (stockInput instanceof HTMLInputElement) {
        const raw = stockInput.value.trim();
        if (!raw) {
          payload.append("stock_count", "");
        } else {
          const num = Number(raw);
          if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
            showMsg("Stock invalido.", "error");
            return;
          }
          payload.append("stock_count", String(num));
        }
      }

      if (stockLowInput instanceof HTMLInputElement) {
        const raw = stockLowInput.value.trim();
        if (!raw) {
          payload.append("stock_low_threshold", "");
        } else {
          const num = Number(raw);
          if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
            showMsg("Limite de stock invalido.", "error");
            return;
          }
          payload.append("stock_low_threshold", String(num));
        }
      }

      const removePillInput = rowEl.querySelector("[data-edit-remove-pill]");
      if (removePillInput instanceof HTMLInputElement && removePillInput.checked) {
        payload.append("remove_pill_image", "1");
      }
      const imageInput = rowEl.querySelector("[data-edit-pill-image]");
      if (imageInput instanceof HTMLInputElement && imageInput.files && imageInput.files[0]) {
        payload.append("pill_image", imageInput.files[0]);
      }

      const res = await apiFetch(`/api/reminders/${safeId}`, {
        method: "PATCH",
        body: payload
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showMsg(data.message || "Erro ao atualizar alarme.", "error");
        return;
      }
      editingId = null;
      showMsg("Alarme atualizado.", "success");
      await load();
      return;
    }

    if (action === "toggle") {
      const r = reminders.find(x => String(x.id) === String(id));
      if (!r) return;
      await apiFetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !r.is_active, patient_id: currentPatientId })
      });
      if (Number(editingId) === Number(id)) {
        editingId = null;
      }
      load();
    }

    if (action === "delete") {
      const r = reminders.find(x => String(x.id) === String(id));
      const label = r ? `${r.medicine_name}` : "este alarme";
      const ok = confirm(`Apagar ${label}?`);
      if (!ok) return;
      await apiFetch(`/api/reminders/${id}`, { method: "DELETE" });
      if (Number(editingId) === Number(id)) {
        editingId = null;
      }
      load();
    }
  });

  listEl.addEventListener("change", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches("[data-edit-schedule-mode]")) return;
    const rowEl = target.closest("[data-reminder-id]");
    if (!(rowEl instanceof HTMLElement)) return;
    syncEditWeekdayBlock(rowEl);
  });
}

async function loadConfig() {
  if (!configForm) return;
  try {
    const res = await apiFetch("/api/config");
    const data = await res.json();
    const cfg = data.config || {};
    configCache = cfg;
    const parsed = Number(cfg.stock_low_default);
    if (Number.isFinite(parsed) && parsed >= 0) {
      stockDefaultThreshold = parsed;
    }
    for (const k of Object.keys(cfg)) {
      const el = configForm.querySelector(`[name="${k}"]`);
      if (el) el.value = cfg[k] || "";
    }
    render();
  } catch {
    showBox(configMsg, "Nao foi possivel carregar definicoes.", "error");
  }
}

if (configForm) {
  configForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(configForm);
    const payload = {};
    ["default_patient_name", "caregiver_email", "escalation_minutes", "stock_low_default", "kiosk_admin_pin"].forEach((k) => {
      payload[k] = fd.get(k) || "";
    });
    const res = await apiFetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const parsed = Number(payload.stock_low_default);
      if (Number.isFinite(parsed) && parsed >= 0) {
        stockDefaultThreshold = parsed;
      }
      configCache = { ...configCache, ...payload };
      render();
    }
    showBox(configMsg, res.ok ? "Definicoes guardadas." : "Erro ao guardar definicoes.", res.ok ? "success" : "error");
  });
}

if (csvForm) {
  csvForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(csvForm);
    if (currentPatientId) {
      fd.append("patient_id", String(currentPatientId));
    }
    const res = await apiFetch("/api/reminders/import_csv", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showBox(csvMsg, (data && data.message) ? data.message : "Erro ao importar.", "error");
      return;
    }
    showBox(csvMsg, `Importado: ${data.created} | Erros: ${data.errors}`, "success");
    load();
  });
}

if (timesExtraGroup && !timesExtraGroup.querySelector("input[name='times_extra']")) {
  addExtraTimeInput(timesExtraGroup, "");
}

if (timesExtraAddBtn) {
  timesExtraAddBtn.addEventListener("click", () => addExtraTimeInput(timesExtraGroup, ""));
}

createScheduleInputs.forEach((input) => {
  input.addEventListener("change", () => syncWeekdayPicker(createScheduleInputs, createWeekdayPicker));
});

if (createPillInput) {
  createPillInput.addEventListener("change", () => {
    updatePillPreview(createPillInput, createPillPreviewCard, createPillPreviewImg, createPillPreviewName);
  });
}

syncWeekdayPicker(createScheduleInputs, createWeekdayPicker);

setupFilterControls();
initPatient().then(load);
loadConfig();
