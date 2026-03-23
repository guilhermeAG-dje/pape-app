(() => {
  "use strict";

  const STORAGE_KEY = "lm_kiosk_patient_id_v1";
  const select = document.querySelector("[data-patient-select]");
  const refreshButton = document.querySelector("[data-patient-refresh]");
  const caption = document.querySelector("[data-patient-caption]");
  const detailLink = document.querySelector("[data-patient-detail]");
  const navLinks = Array.from(document.querySelectorAll("[data-patient-nav]"));
  const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfTokenMeta ? String(csrfTokenMeta.getAttribute("content") || "") : "";

  if (!select) {
    return;
  }

  const getStoredPatientId = () => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch (_err) {
      return "";
    }
  };

  const setStoredPatientId = (value) => {
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, String(value));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_err) {
      // Ignore storage failures.
    }
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const apiFetch = (url, options) => {
    const opts = { ...(options || {}) };
    const method = String(opts.method || "GET").toUpperCase();
    const headers = { ...(opts.headers || {}) };
    if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers["X-CSRF-Token"] = csrfToken;
    }
    opts.headers = headers;
    return fetch(url, opts);
  };

  const updateLinks = (patientId) => {
    const pid = String(patientId || "").trim();
    if (detailLink) {
      detailLink.setAttribute("href", pid ? `/admin_2026/users/${encodeURIComponent(pid)}` : "/admin_2026/users");
      detailLink.classList.toggle("is-disabled", !pid);
      detailLink.setAttribute("aria-disabled", pid ? "false" : "true");
    }
    navLinks.forEach((link) => {
      const page = link.getAttribute("data-patient-nav") || "";
      const href = page === "dashboard" ? "/admin_2026/dashboard" : "/admin_2026/reminders";
      link.setAttribute("href", href);
    });
  };

  const updateCaption = (item) => {
    if (!caption) {
      return;
    }
    if (!item) {
      caption.textContent = "Nao foi possivel identificar um utente.";
      return;
    }
    caption.innerHTML = `Selecionado: <strong>${escapeHtml(item.display_name)}</strong> (#${escapeHtml(item.id)})`;
  };

  const dispatchChange = (item) => {
    window.dispatchEvent(new CustomEvent("admin:patient-changed", {
      detail: {
        patientId: item ? item.id : null,
        displayName: item ? item.display_name : ""
      }
    }));
  };

  const syncSessionPatient = async (patientId) => {
    if (!patientId) {
      return;
    }
    try {
      await apiFetch("/api/patient/current", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: Number(patientId) })
      });
    } catch (_err) {
      // Keep local context even if session sync fails.
    }
  };

  const populateSelect = (items, selectedId) => {
    select.innerHTML = "";
    if (!items.length) {
      select.innerHTML = '<option value="">Sem utentes</option>';
      updateLinks("");
      updateCaption(null);
      return null;
    }

    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = `${item.display_name} (#${item.id})`;
      if (String(item.id) === String(selectedId)) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    const active = items.find((item) => String(item.id) === String(select.value)) || items[0];
    if (active && String(select.value) !== String(active.id)) {
      select.value = String(active.id);
    }
    updateLinks(active ? active.id : "");
    updateCaption(active);
    return active || null;
  };

  const loadPatients = async () => {
    select.disabled = true;
    try {
      const res = await apiFetch("/api/patients");
      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data.items) ? data.items : [];
      const explicit = select.getAttribute("data-selected-patient") || "";
      const stored = getStoredPatientId();
      const selectedId = explicit || stored || data.current_patient_id || (items[0] ? items[0].id : "");
      const active = populateSelect(items, selectedId);
      if (active) {
        setStoredPatientId(active.id);
        await syncSessionPatient(active.id);
        dispatchChange(active);
      } else {
        dispatchChange(null);
      }
    } catch (_err) {
      select.innerHTML = '<option value="">Erro ao carregar utentes</option>';
      updateLinks("");
      updateCaption(null);
    } finally {
      select.disabled = false;
    }
  };

  select.addEventListener("change", async () => {
    const option = select.options[select.selectedIndex];
    const item = option ? { id: option.value, display_name: option.textContent.replace(/\s*\(#.*$/, "") } : null;
    setStoredPatientId(item ? item.id : "");
    updateLinks(item ? item.id : "");
    updateCaption(item);
    await syncSessionPatient(item ? item.id : "");
    dispatchChange(item);
  });

  if (refreshButton) {
    refreshButton.addEventListener("click", loadPatients);
  }

  if (detailLink) {
    detailLink.addEventListener("click", (event) => {
      if (detailLink.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
      }
    });
  }

  loadPatients();
})();
