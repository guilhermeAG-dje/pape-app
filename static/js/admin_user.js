(() => {
  "use strict";

  const body = document.body;
  const patientId = body ? String(body.dataset.patientId || "") : "";

  const normalizeText = (value) => {
    return (value || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  };

  const makeStorageKey = (inputId) => `admin-user-filter:${patientId}:${inputId}`;

  const loadStoredFilter = (inputId) => {
    try {
      return sessionStorage.getItem(makeStorageKey(inputId)) || "";
    } catch (_err) {
      return "";
    }
  };

  const saveStoredFilter = (inputId, value) => {
    try {
      sessionStorage.setItem(makeStorageKey(inputId), String(value || ""));
    } catch (_err) {
      // Ignore storage failures silently.
    }
  };

  const setupFilter = ({ inputId, listId, countId }) => {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    const count = document.getElementById(countId);
    if (!input || !list || !count) {
      return;
    }

    input.value = loadStoredFilter(inputId);

    const items = Array.from(list.querySelectorAll("[data-filter-item]"));
    const emptyState = list.querySelector("[data-empty-state]");
    const emptyAction = list.querySelector("[data-empty-action]");
    const defaultEmptyMessage = list.dataset.emptyMessage || "Sem registos.";
    const clearButton = document.querySelector(`[data-clear-target="${inputId}"]`);

    const render = () => {
      const query = normalizeText(input.value);
      const tokens = query.split(/\s+/).filter(Boolean);
      let visible = 0;

      items.forEach((item) => {
        const searchable = normalizeText(item.dataset.search || item.textContent);
        const matches = tokens.length === 0 || tokens.every((token) => searchable.includes(token));
        item.hidden = !matches;
        if (matches) {
          visible += 1;
        }
      });

      count.textContent = String(visible);
      list.classList.toggle("is-filtered", query.length > 0);

      if (clearButton) {
        clearButton.hidden = query.length === 0;
      }

      if (!emptyState) {
        return;
      }

      if (items.length === 0) {
        emptyState.textContent = defaultEmptyMessage;
        emptyState.hidden = false;
        if (emptyAction) {
          emptyAction.hidden = false;
        }
        return;
      }

      if (emptyAction) {
        emptyAction.hidden = true;
      }

      if (visible === 0) {
        emptyState.textContent = "Sem resultados para o filtro atual.";
        emptyState.hidden = false;
      } else {
        emptyState.textContent = defaultEmptyMessage;
        emptyState.hidden = true;
      }
    };

    input.addEventListener("input", () => {
      saveStoredFilter(inputId, input.value);
      render();
    });

    if (clearButton) {
      clearButton.addEventListener("click", () => {
        input.value = "";
        saveStoredFilter(inputId, "");
        render();
        input.focus();
      });
    }

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (!input.value) {
        return;
      }
      event.preventDefault();
      input.value = "";
      saveStoredFilter(inputId, "");
      render();
    });

    render();
  };

  const setupFilterChips = () => {
    const chips = Array.from(document.querySelectorAll("[data-filter-target][data-filter-value]"));
    if (!chips.length) {
      return;
    }

    const chipsByTarget = new Map();
    chips.forEach((chip) => {
      const targetId = chip.dataset.filterTarget;
      if (!targetId) {
        return;
      }
      if (!chipsByTarget.has(targetId)) {
        chipsByTarget.set(targetId, []);
      }
      chipsByTarget.get(targetId).push(chip);
    });

    const syncChips = (targetId) => {
      const input = document.getElementById(targetId);
      if (!input) {
        return;
      }
      const current = normalizeText(input.value);
      const group = chipsByTarget.get(targetId) || [];
      group.forEach((chip) => {
        const value = normalizeText(chip.dataset.filterValue || "");
        chip.classList.toggle("is-active", Boolean(value) && value === current);
      });
    };

    chips.forEach((chip) => {
      const targetId = chip.dataset.filterTarget;
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) {
        return;
      }
      chip.addEventListener("click", () => {
        const value = chip.dataset.filterValue || "";
        const current = normalizeText(input.value);
        const next = normalizeText(value);
        input.value = current === next ? "" : value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        syncChips(targetId);
      });
    });

    chipsByTarget.forEach((_group, targetId) => {
      const input = document.getElementById(targetId);
      if (!input) {
        return;
      }
      input.addEventListener("input", () => syncChips(targetId));
      syncChips(targetId);
    });
  };

  const updateTomasChipCounts = () => {
    const list = document.getElementById("tomas-list");
    if (!list) {
      return;
    }
    const items = Array.from(list.querySelectorAll("[data-filter-item]"));
    let late = 0;
    let missed = 0;
    let onTime = 0;

    items.forEach((item) => {
      if (item.dataset.tomaLate === "1") late += 1;
      if (item.dataset.tomaMissed === "1") missed += 1;
      if (item.dataset.tomaOnTime === "1") onTime += 1;
    });

    const counts = { late, missed, on_time: onTime };
    const chips = Array.from(document.querySelectorAll("[data-chip-count]"));
    chips.forEach((chip) => {
      const key = chip.dataset.chipCount;
      if (!key || !(key in counts)) {
        return;
      }
      chip.textContent = String(counts[key]);
    });
  };

  const setupCopyButtons = () => {
    const buttons = Array.from(document.querySelectorAll("[data-copy-text]"));
    if (!buttons.length) {
      return;
    }

    if (!navigator.clipboard) {
      buttons.forEach((button) => {
        button.hidden = true;
      });
      return;
    }

    buttons.forEach((button) => {
      const text = button.getAttribute("data-copy-text") || "";
      if (!text) {
        button.hidden = true;
        return;
      }

      const defaultLabel = button.getAttribute("data-copy-label") || button.textContent;
      const successLabel = button.getAttribute("data-copy-success") || "Copiado";
      const failLabel = button.getAttribute("data-copy-fail") || "Falhou";

      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = successLabel;
        } catch (_err) {
          button.textContent = failLabel;
        }
        window.setTimeout(() => {
          button.textContent = defaultLabel;
        }, 1200);
      });
    });
  };

  const setupShortcut = () => {
    window.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const target = event.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") {
        return;
      }
      const medsPanel = document.getElementById("meds-panel");
      const tomasPanel = document.getElementById("tomas-panel");
      const medsFilter = document.getElementById("meds-filter");
      const tomasFilter = document.getElementById("tomas-filter");
      if (!medsFilter || !tomasFilter || !medsPanel || !tomasPanel) {
        return;
      }

      const medsTop = Math.abs(medsPanel.getBoundingClientRect().top);
      const tomasTop = Math.abs(tomasPanel.getBoundingClientRect().top);
      const targetInput = tomasTop < medsTop ? tomasFilter : medsFilter;
      event.preventDefault();
      targetInput.focus();
      targetInput.select();
    });
  };

  const highlightPanel = (panel) => {
    if (!panel) {
      return;
    }
    panel.classList.remove("panel-pulse");
    void panel.offsetWidth;
    panel.classList.add("panel-pulse");
    window.setTimeout(() => {
      panel.classList.remove("panel-pulse");
    }, 1400);
  };

  const setupPanelAnchors = () => {
    const links = Array.from(document.querySelectorAll('a[href^="#"]'));
    links.forEach((link) => {
      const targetId = (link.getAttribute("href") || "").slice(1);
      if (!targetId) {
        return;
      }
      const target = document.getElementById(targetId);
      if (!target) {
        return;
      }

      link.addEventListener("click", (event) => {
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        highlightPanel(target);
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, "", `#${targetId}`);
        }
      });
    });

    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    if (!hash) {
      return;
    }
    const target = document.getElementById(hash);
    highlightPanel(target);
  };

  setupFilter({ inputId: "meds-filter", listId: "meds-list", countId: "meds-visible" });
  setupFilter({ inputId: "tomas-filter", listId: "tomas-list", countId: "tomas-visible" });
  setupFilterChips();
  updateTomasChipCounts();
  setupCopyButtons();
  setupShortcut();
  setupPanelAnchors();
})();
