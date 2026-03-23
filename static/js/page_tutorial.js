(function () {
  const path = (window.location.pathname || "").toLowerCase();
  const MARGIN = 12;

  function buildSteps() {
    if (path === "/" || path.startsWith("/reset")) {
      return [
        { selector: "#patient-current", title: "Utente", text: "Este navegador guarda o utente automaticamente. Em outro browser sera outro utente.", pos: "bottom" },
        { selector: "#kiosk-reminder-form [name='medicine_name']", title: "Medicamento", text: "Comeca por escrever o nome do medicamento.", pos: "right" },
        { selector: "#kiosk-reminder-form [name='time_hhmm']", title: "Hora principal", text: "Define a primeira hora da toma.", pos: "right" },
        { selector: "#kiosk-reminder-form [name='stock_count']", title: "Stock (opcional)", text: "Preenche para receber alertas de stock baixo.", pos: "right" },
        { selector: "#reminders-list", title: "Meus medicamentos", text: "Os teus alarmes aparecem aqui, por ordem de hora.", pos: "top" },
        { selector: "#btn-confirm-next", title: "Confirmar toma", text: "Quando for a hora, confirma aqui.", pos: "top" }
      ];
    }

    if (path.includes("/admin_2026/login")) {
      return [
        { selector: "#user", title: "Utilizador", text: "Insere o utilizador de admin.", pos: "right" },
        { selector: "#password", title: "Palavra-passe", text: "Insere a palavra-passe de admin.", pos: "right" },
        { selector: ".login-box button[type='submit']", title: "Entrar", text: "Valida as credenciais e abre o painel.", pos: "top" },
        { selector: ".login-actions a[href='/admin_2026/pin']", title: "Entrar com PIN", text: "Alternativa rapida para entrar no admin.", pos: "top" }
      ];
    }

    if (path.includes("/admin_2026/pin")) {
      return [
        { selector: "#pin", title: "PIN", text: "Insere o PIN configurado no sistema.", pos: "right" },
        { selector: ".login-box button[type='submit']", title: "Entrar", text: "Valida o PIN e segue para alarmes.", pos: "top" },
        { selector: ".login-actions a[href='/']", title: "Voltar ao kiosk", text: "Regressa ao modo kiosk.", pos: "top" }
      ];
    }

    if (path.includes("/admin_2026/reminders")) {
      return [
        { selector: "#patient-current", title: "Utente deste browser", text: "Os alarmes ficam associados ao mesmo utente do kiosk.", pos: "bottom" },
        { selector: "#reminder-form [name='medicine_name']", title: "Novo alarme", text: "Cria um novo alarme de medicacao.", pos: "right" },
        { selector: "#reminder-form [name='time_hhmm']", title: "Hora principal", text: "Define a primeira hora da toma.", pos: "right" },
        { selector: "#config-form", title: "Definicoes", text: "Ajusta PIN, email e configuracoes globais.", pos: "left" },
        { selector: "#csv-form", title: "Importar CSV", text: "Importa alarmes em massa via ficheiro.", pos: "top" },
        { selector: "#reminders-filter", title: "Filtrar alarmes", text: "Pesquisa por medicamento, dose ou hora.", pos: "bottom" },
        { selector: "#reminders-active-toggle", title: "Ativos", text: "Mostra apenas alarmes ativos.", pos: "bottom" }
      ];
    }

    if (path.includes("/admin_2026/users/")) {
      return [
        { selector: ".user-overview", title: "Resumo", text: "Visao geral do utente neste dispositivo.", pos: "bottom" },
        { selector: "#meds-filter", title: "Filtrar medicamentos", text: "Pesquisa por nome, dose, hora ou dias.", pos: "bottom" },
        { selector: "#tomas-filter", title: "Filtrar historico", text: "Procura tomas por nome, estado, data ou hora.", pos: "bottom" },
        { selector: ".list-chips", title: "Filtros rapidos", text: "Aplica filtros com um clique para atraso, em falta ou em dia.", pos: "bottom" },
        { selector: "#tomas-list", title: "Historico de tomas", text: "Lista das tomas mais recentes (ate 300).", pos: "top" }
      ];
    }

    if (path.includes("/admin_2026/dashboard")) {
      return [
        { selector: "#patient-current", title: "Utente deste browser", text: "Este painel segue o utente reconhecido neste navegador.", pos: "bottom" },
        { selector: "#weekChart", title: "Adesao semanal", text: "Grafico de adesao dos ultimos 7 dias.", pos: "top" },
        { selector: "#today-table", title: "Agenda de hoje", text: "Lista das tomas previstas e estado atual.", pos: "top" },
        { selector: "#today-filter", title: "Filtrar agenda", text: "Pesquisa por medicamento, dose ou hora.", pos: "bottom" },
        { selector: "#dashboard-refresh", title: "Atualizar", text: "Atualiza os indicadores agora.", pos: "bottom" }
      ];
    }

    if (path.startsWith("/admin_2026")) {
      return [
        { selector: ".admin-actions a[href='/admin_2026/dashboard']", title: "Monitorizacao", text: "Abre indicadores e historico.", pos: "bottom" },
        { selector: ".admin-actions a[href='/admin_2026/reminders']", title: "Alarmes", text: "Gestao de alarmes e configuracoes.", pos: "bottom" },
        { selector: ".admin-actions a[href='/admin_2026/logout']", title: "Sair", text: "Termina a sessao de admin.", pos: "bottom" }
      ];
    }

    return [];
  }

  function injectStyles() {
    if (document.getElementById("page-tutorial-style")) return;
    const style = document.createElement("style");
    style.id = "page-tutorial-style";
    style.textContent = `
      .pt-overlay {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: rgba(2, 6, 23, 0.52);
      }
      .pt-focus {
        position: fixed;
        z-index: 10001;
        border: 2px solid #f59e0b;
        border-radius: 12px;
        box-shadow: 0 0 0 9999px rgba(2, 6, 23, 0.24), 0 0 0 4px rgba(245, 158, 11, 0.25);
        pointer-events: none;
      }
      .pt-tooltip {
        position: fixed;
        z-index: 10003;
        width: min(360px, calc(100vw - 24px));
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: #ffffff;
        color: #0f172a;
        padding: 12px;
        box-shadow: 0 18px 40px rgba(2, 6, 23, 0.3);
      }
      body.admin-page .pt-tooltip {
        background: #0f172a;
        color: #e2e8f0;
      }
      .pt-title {
        margin: 0 0 6px;
        font-weight: 800;
        font-size: 1rem;
      }
      .pt-text {
        margin: 0 0 10px;
        line-height: 1.35;
      }
      .pt-meta {
        margin: 0 0 10px;
        font-size: 0.85rem;
        opacity: 0.8;
      }
      .pt-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .pt-btn {
        border: 0;
        border-radius: 8px;
        padding: 8px 10px;
        font-weight: 700;
        cursor: pointer;
      }
      .pt-btn-next {
        background: #0f766e;
        color: #ffffff;
      }
      body.admin-page .pt-btn-next {
        background: #0ea5e9;
      }
      .pt-btn-ghost {
        background: rgba(148, 163, 184, 0.2);
        color: inherit;
      }
      .pt-arrow-line {
        position: fixed;
        z-index: 10002;
        height: 2px;
        background: #f59e0b;
        transform-origin: 0 50%;
      }
      .pt-arrow-head {
        position: fixed;
        z-index: 10002;
        width: 0;
        height: 0;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-left: 10px solid #f59e0b;
        transform-origin: 50% 50%;
      }
      .pt-launcher {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 9998;
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        font-weight: 800;
        cursor: pointer;
        background: #0f766e;
        color: #ffffff;
        box-shadow: 0 8px 20px rgba(2, 6, 23, 0.3);
      }
      body.admin-page .pt-launcher {
        background: #0ea5e9;
      }
    `;
    document.head.appendChild(style);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getAnchor(rect, side) {
    if (side === "top") return { x: rect.left + rect.width / 2, y: rect.top };
    if (side === "left") return { x: rect.left, y: rect.top + rect.height / 2 };
    if (side === "right") return { x: rect.right, y: rect.top + rect.height / 2 };
    return { x: rect.left + rect.width / 2, y: rect.bottom };
  }

  function pickTooltipPosition(targetRect, width, height, preferred) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const options = [preferred, "bottom", "top", "right", "left"];

    for (let i = 0; i < options.length; i += 1) {
      const side = options[i];
      let top = MARGIN;
      let left = MARGIN;
      if (side === "top") {
        top = targetRect.top - height - 18;
        left = targetRect.left + targetRect.width / 2 - width / 2;
      } else if (side === "bottom") {
        top = targetRect.bottom + 18;
        left = targetRect.left + targetRect.width / 2 - width / 2;
      } else if (side === "left") {
        top = targetRect.top + targetRect.height / 2 - height / 2;
        left = targetRect.left - width - 18;
      } else if (side === "right") {
        top = targetRect.top + targetRect.height / 2 - height / 2;
        left = targetRect.right + 18;
      }
      left = clamp(left, MARGIN, vw - width - MARGIN);
      top = clamp(top, MARGIN, vh - height - MARGIN);

      const fits =
        top >= MARGIN &&
        left >= MARGIN &&
        top + height <= vh - MARGIN &&
        left + width <= vw - MARGIN;
      if (fits || i === options.length - 1) {
        return { top: top, left: left };
      }
    }
    return { top: MARGIN, left: MARGIN };
  }

  function resolveSteps(rawSteps) {
    const resolved = [];
    for (let i = 0; i < rawSteps.length; i += 1) {
      const step = rawSteps[i];
      const element = document.querySelector(step.selector);
      if (!element) continue;
      resolved.push({
        element: element,
        title: step.title,
        text: step.text,
        pos: step.pos || "bottom"
      });
    }
    return resolved;
  }

  function runTour(steps, onClose) {
    if (!steps.length) return;
    injectStyles();

    const overlay = document.createElement("div");
    overlay.className = "pt-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const focus = document.createElement("div");
    focus.className = "pt-focus";

    const tooltip = document.createElement("div");
    tooltip.className = "pt-tooltip";

    const title = document.createElement("h3");
    title.className = "pt-title";

    const text = document.createElement("p");
    text.className = "pt-text";

    const meta = document.createElement("p");
    meta.className = "pt-meta";

    const actions = document.createElement("div");
    actions.className = "pt-actions";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "pt-btn pt-btn-ghost";
    prev.textContent = "Anterior";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "pt-btn pt-btn-ghost";
    close.textContent = "Fechar";

    const next = document.createElement("button");
    next.type = "button";
    next.className = "pt-btn pt-btn-next";
    next.textContent = "Seguinte";

    const arrowLine = document.createElement("div");
    arrowLine.className = "pt-arrow-line";
    const arrowHead = document.createElement("div");
    arrowHead.className = "pt-arrow-head";

    actions.appendChild(prev);
    actions.appendChild(close);
    actions.appendChild(next);
    tooltip.appendChild(title);
    tooltip.appendChild(text);
    tooltip.appendChild(meta);
    tooltip.appendChild(actions);

    document.body.appendChild(overlay);
    document.body.appendChild(focus);
    document.body.appendChild(arrowLine);
    document.body.appendChild(arrowHead);
    document.body.appendChild(tooltip);

    let index = 0;

    function destroy() {
      overlay.remove();
      focus.remove();
      tooltip.remove();
      arrowLine.remove();
      arrowHead.remove();
      window.removeEventListener("resize", renderStep);
      window.removeEventListener("scroll", renderStep, true);
      document.removeEventListener("keydown", onKeyDown);
      if (typeof onClose === "function") onClose();
    }

    function renderArrow(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      arrowLine.style.left = from.x + "px";
      arrowLine.style.top = from.y + "px";
      arrowLine.style.width = Math.max(8, length - 10) + "px";
      arrowLine.style.transform = "rotate(" + angle + "deg)";

      arrowHead.style.left = (to.x - 10) + "px";
      arrowHead.style.top = (to.y - 6) + "px";
      arrowHead.style.transform = "rotate(" + angle + "deg)";
    }

    function renderStep() {
      const step = steps[index];
      if (!step) return;

      const rect = step.element.getBoundingClientRect();
      step.element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      const freshRect = step.element.getBoundingClientRect();

      focus.style.left = (freshRect.left - 6) + "px";
      focus.style.top = (freshRect.top - 6) + "px";
      focus.style.width = (freshRect.width + 12) + "px";
      focus.style.height = (freshRect.height + 12) + "px";

      title.textContent = step.title;
      text.textContent = step.text;
      meta.textContent = "Passo " + (index + 1) + " de " + steps.length;
      prev.disabled = index === 0;
      next.textContent = index === steps.length - 1 ? "Terminar" : "Seguinte";

      tooltip.style.visibility = "hidden";
      tooltip.style.left = MARGIN + "px";
      tooltip.style.top = MARGIN + "px";
      const tooltipRect = tooltip.getBoundingClientRect();
      const pos = pickTooltipPosition(freshRect, tooltipRect.width, tooltipRect.height, step.pos);
      tooltip.style.left = pos.left + "px";
      tooltip.style.top = pos.top + "px";
      tooltip.style.visibility = "visible";

      const tipRect = tooltip.getBoundingClientRect();
      const targetPoint = getAnchor(freshRect, step.pos === "top" ? "top" : step.pos === "left" ? "left" : step.pos === "right" ? "right" : "bottom");
      const tipSide =
        tipRect.top > freshRect.bottom ? "top" :
        tipRect.bottom < freshRect.top ? "bottom" :
        tipRect.left > freshRect.right ? "left" : "right";
      const tooltipPoint = getAnchor(tipRect, tipSide);
      renderArrow(tooltipPoint, targetPoint);
    }

    function onKeyDown(ev) {
      if (ev.key === "Escape") {
        destroy();
      } else if (ev.key === "ArrowRight") {
        next.click();
      } else if (ev.key === "ArrowLeft") {
        prev.click();
      }
    }

    prev.addEventListener("click", function () {
      index = Math.max(0, index - 1);
      renderStep();
    });

    next.addEventListener("click", function () {
      if (index >= steps.length - 1) {
        destroy();
        return;
      }
      index += 1;
      renderStep();
    });

    close.addEventListener("click", destroy);
    overlay.addEventListener("click", destroy);
    window.addEventListener("resize", renderStep);
    window.addEventListener("scroll", renderStep, true);
    document.addEventListener("keydown", onKeyDown);

    renderStep();
    next.focus();
  }

  function start() {
    const rawSteps = buildSteps();
    if (!rawSteps.length) return;
    const steps = resolveSteps(rawSteps);
    if (!steps.length) return;
    injectStyles();

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "pt-launcher";
    launcher.textContent = "Tutorial";
    document.body.appendChild(launcher);

    let isOpen = false;
    function openTour() {
      if (isOpen) return;
      isOpen = true;
      launcher.style.display = "none";
      runTour(steps, function () {
        isOpen = false;
        launcher.style.display = "";
      });
    }

    launcher.addEventListener("click", openTour);
    openTour();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
