(function () {
  const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const installButton = document.getElementById("install-app-btn");
  let installPrompt = null;

  if (!("serviceWorker" in navigator)) {
    return;
  }

  function toggleInstallButton(visible) {
    if (!installButton) return;
    installButton.hidden = !visible;
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    installPrompt = event;
    toggleInstallButton(true);
  });

  window.addEventListener("appinstalled", function () {
    installPrompt = null;
    toggleInstallButton(false);
  });

  if (installButton) {
    installButton.addEventListener("click", async function () {
      if (!installPrompt) {
        toggleInstallButton(false);
        return;
      }

      installPrompt.prompt();

      try {
        await installPrompt.userChoice;
      } catch (_) {}

      installPrompt = null;
      toggleInstallButton(false);
    });
  }

  async function unregisterLocalWorkers() {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch (_) {}
  }

  async function registerWorker() {
    if (isLocal) {
      await unregisterLocalWorkers();
      toggleInstallButton(false);
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      reg.update();

      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      reg.addEventListener("updatefound", function () {
        const nextWorker = reg.installing;
        if (!nextWorker) return;

        nextWorker.addEventListener("statechange", function () {
          if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
            nextWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    } catch (_) {}
  }

  window.addEventListener("load", registerWorker);

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    window.location.reload();
  });
})();
