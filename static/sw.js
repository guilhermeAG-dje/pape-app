const CACHE = "lembreme-v9";
const DEFAULT_ICON = "/static/icons/icon-192.png";
const SNOOZE_MINUTES = 5;
const RECENT_NOTIFICATION_KEYS = new Set();
const ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/static/css/style.css",
  "/static/css/admin.css",
  "/static/js/pwa.js",
  "/static/js/script.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/icon-512-maskable.png",
  "/static/offline.html"
];

function buildNotificationKey(reminderId, time) {
  return `${String(reminderId)}-${String(time)}-${new Date().toISOString().slice(0, 10)}`;
}

function absoluteUrl(path) {
  if (!path) return "";
  try {
    return new URL(path, self.location.origin).href;
  } catch (_err) {
    return "";
  }
}

function compactParts(parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean);
}

function buildNotificationData(item, reminderId, time) {
  return {
    reminder_id: reminderId,
    scheduled_time_hhmm: time,
    patient_id: item.patient_id || "",
    medicine_name: item.medicine_name || "medicacao",
    patient_name: item.patient_name || "Utente",
    dose: item.dose || "",
    pill_image_url: item.pill_image_url || "",
    confirm_url: `/?notification_action=confirm&reminder_id=${encodeURIComponent(String(reminderId))}&scheduled_time_hhmm=${encodeURIComponent(time)}#summary`,
    snooze_url: `/?notification_action=snooze&reminder_id=${encodeURIComponent(String(reminderId))}&scheduled_time_hhmm=${encodeURIComponent(time)}#summary`,
    url: "/?notification_action=open#summary"
  };
}

function buildMedicationNotification(item, reminderId, time, titlePrefix) {
  const imageUrl = absoluteUrl(item.pill_image_url);
  const title = `${titlePrefix || "Hora de tomar"} ${item.medicine_name || "medicacao"}`;
  const body = compactParts([item.patient_name || "Utente", item.dose || "", time]).join(" - ");

  return {
    title,
    options: {
      body,
      icon: imageUrl || DEFAULT_ICON,
      badge: DEFAULT_ICON,
      image: imageUrl || undefined,
      tag: `lembreme-schedule-${reminderId}-${time}`,
      timestamp: Date.now(),
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [400, 160, 400, 160, 800],
      data: buildNotificationData(item, reminderId, time),
      actions: [
        { action: "confirm", title: "Foi tomado" },
        { action: "snooze", title: `Adiar ${SNOOZE_MINUTES} min` }
      ]
    }
  };
}

async function showMedicationNotification(item, reminderId, time, titlePrefix) {
  const notification = buildMedicationNotification(item, reminderId, time, titlePrefix);
  await self.registration.showNotification(notification.title, notification.options);
}

async function fetchTodayScheduleAndNotify() {
  try {
    const response = await fetch("/api/schedule/today", { credentials: "include" });
    if (!response.ok) return;

    const data = await response.json();
    if (!data || !data.ok || !Array.isArray(data.items)) return;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    for (const item of data.items) {
      const time = String(item.time_hhmm || item.scheduled_time_hhmm || "").trim();
      if (!/^\d{2}:\d{2}$/.test(time)) continue;

      const [hour, minute] = time.split(":").map((value) => Number(value));
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;

      const itemMinutes = hour * 60 + minute;
      const diff = itemMinutes - nowMinutes;
      if (diff < -5 || diff > 5) continue;

      const reminderId = item.reminder_id || item.id || "unknown";
      const key = buildNotificationKey(reminderId, time);
      if (RECENT_NOTIFICATION_KEYS.has(key)) continue;

      RECENT_NOTIFICATION_KEYS.add(key);
      while (RECENT_NOTIFICATION_KEYS.size > 200) {
        RECENT_NOTIFICATION_KEYS.delete(RECENT_NOTIFICATION_KEYS.values().next().value);
      }

      await showMedicationNotification(item, reminderId, time);
    }
  } catch (_err) {
    // Background checks are opportunistic; failures should not interrupt the app.
  }
}

async function confirmReminderFromNotification(data) {
  const reminderId = data && data.reminder_id;
  if (!reminderId) return false;

  try {
    const response = await fetch(`/api/reminders/${encodeURIComponent(String(reminderId))}/confirm`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_time_hhmm: data.scheduled_time_hhmm || null })
    });
    return response.ok;
  } catch (_err) {
    return false;
  }
}

async function notifyClients(action, data, extra) {
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clientList.forEach((client) => {
    client.postMessage({
      type: "LEMBREME_NOTIFICATION_ACTION",
      action,
      payload: data,
      extra: extra || {}
    });
  });
  return clientList;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "lembreme-check") {
    event.waitUntil(fetchTodayScheduleAndNotify());
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "lembreme-check") {
    event.waitUntil(fetchTodayScheduleAndNotify());
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (event.data && event.data.type === "LEMBREME_CHECK_NOW") {
    event.waitUntil(fetchTodayScheduleAndNotify());
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_err) {
    payload = {};
  }

  const title = payload.title || "Hora da medicacao";
  const image = payload.image || payload.icon || DEFAULT_ICON;
  const data = payload.data || {};
  const options = {
    body: payload.body || "Esta na hora de confirmar a toma.",
    icon: image,
    badge: DEFAULT_ICON,
    image: payload.image || undefined,
    tag: payload.tag || `lembreme-${Date.now()}`,
    timestamp: Date.now(),
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [400, 160, 400, 160, 800],
    data,
    actions: [
      { action: "confirm", title: "Foi tomado" },
      { action: "snooze", title: `Adiar ${SNOOZE_MINUTES} min` }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/static/offline.html"))
    );
    return;
  }

  if (!sameOrigin) return;

  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
    event.respondWith(fetch(req));
    return;
  }

  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification && notification.data ? notification.data : {};
  const action = event.action || "open";
  const targetUrl = action === "confirm"
    ? (data.confirm_url || data.url || "/")
    : action === "snooze"
      ? (data.snooze_url || data.url || "/")
      : (data.url || "/");

  notification.close();

  event.waitUntil((async () => {
    if (action === "confirm") {
      const ok = await confirmReminderFromNotification(data);
      await notifyClients(action, data, { confirmed: ok });
      if (!ok && self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
      return;
    }

    if (action === "snooze") {
      await notifyClients(action, data);
      const reminderId = data.reminder_id || "unknown";
      const time = data.scheduled_time_hhmm || "";
      await wait(SNOOZE_MINUTES * 60 * 1000);
      await showMedicationNotification(data, reminderId, time, "Lembrete:");
      return;
    }

    const clientList = await notifyClients(action, data);
    for (const client of clientList) {
      if ("focus" in client) {
        await client.focus();
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
