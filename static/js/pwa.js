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

      try {
        if ('periodicSync' in reg) {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
          if (status.state === 'granted') {
            await reg.periodicSync.register('lembreme-check', { minInterval: 15 * 60 * 1000 });
          }
        } else if ('sync' in reg) {
          await reg.sync.register('lembreme-check');
        }
      } catch (_err) {
        // Background sync não suportado ou sem permissão.
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

  window.lembremeCheckNotificationsNow = async function () {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.active) {
        reg.active.postMessage({ type: "LEMBREME_CHECK_NOW" });
      }
    } catch (_) {}
  };

  window.addEventListener("load", registerWorker);

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    window.location.reload();
  });

  // Push subscription helper
  async function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const res = await fetch('/api/push/public_key');
      if (!res.ok) return;
      const data = await res.json();
      const vapidKey = data.public_key || '';
      if (!vapidKey) return;
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        // send to server to ensure stored
        await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(existing.toJSON()) });
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await urlBase64ToUint8Array(vapidKey)
      });
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
    } catch (_err) {
      // ignore
    }
  }

  // Try to subscribe after load if permission granted
  window.addEventListener('load', async () => {
    try {
      if (Notification && Notification.permission === 'granted') {
        await subscribeToPush();
      }
    } catch (_) {}
  });
})();
