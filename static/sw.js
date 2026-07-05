const CACHE = "lembreme-v8";
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

const RECENT_NOTIFICATION_KEYS = new Set();

function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildNotificationKey(reminderId, time) {
  return `${String(reminderId)}-${String(time)}-${new Date().toISOString().slice(0, 10)}`;
}

async function fetchTodayScheduleAndNotify() {
  try {
    const response = await fetch('/api/schedule/today', { credentials: 'include' });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (!data || !data.ok || !Array.isArray(data.items)) {
      return;
    }
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    for (const item of data.items) {
      const time = String(item.time_hhmm || item.scheduled_time_hhmm || '').trim();
      if (!/^\d{2}:\d{2}$/.test(time)) {
        continue;
      }
      const [hour, minute] = time.split(':').map((value) => Number(value));
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        continue;
      }
      const itemMinutes = hour * 60 + minute;
      const diff = itemMinutes - nowMinutes;
      if (diff < -5 || diff > 5) {
        continue;
      }
      const reminderId = item.reminder_id || item.id || 'unknown';
      const key = buildNotificationKey(reminderId, time);
      if (RECENT_NOTIFICATION_KEYS.has(key)) {
        continue;
      }
      RECENT_NOTIFICATION_KEYS.add(key);
      while (RECENT_NOTIFICATION_KEYS.size > 200) {
        RECENT_NOTIFICATION_KEYS.delete(RECENT_NOTIFICATION_KEYS.values().next().value);
      }

      const title = `Hora de ${item.medicine_name || 'medicação'}`;
      const body = `${item.patient_name || 'Utente'} · ${item.dose || ''} · ${time}`.trim();
      const options = {
        body,
        icon: item.pill_image_url ? item.pill_image_url : '/static/icons/icon-192.png',
        badge: '/static/icons/icon-192.png',
        tag: `lembreme-schedule-${reminderId}-${time}`,
        renotify: true,
        requireInteraction: true,
        data: {
          reminder_id: reminderId,
          scheduled_time_hhmm: time,
          confirm_url: `/?notification_action=confirm&reminder_id=${encodeURIComponent(String(reminderId))}&scheduled_time_hhmm=${encodeURIComponent(time)}#summary`,
          snooze_url: `/?notification_action=snooze&reminder_id=${encodeURIComponent(String(reminderId))}&scheduled_time_hhmm=${encodeURIComponent(time)}#summary`,
          url: `/?notification_action=open#summary`
        },
        actions: [
          { action: 'confirm', title: 'Confirmar toma' },
          { action: 'snooze', title: 'Adiar 5 min' }
        ]
      };
      await self.registration.showNotification(title, options);
    }
  } catch (_err) {
    // ignore failures
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'lembreme-check') {
    event.waitUntil(fetchTodayScheduleAndNotify());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'lembreme-check') {
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
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action || 'open';
  let targetUrl = data.url || '/';

  if (action === 'confirm' && data.confirm_url) {
    targetUrl = data.confirm_url;
  } else if (action === 'snooze' && data.snooze_url) {
    targetUrl = data.snooze_url;
  }

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) {
        await client.focus();
      }
      if (action === 'confirm' || action === 'snooze') {
        client.postMessage({
          type: 'LEMBREME_NOTIFICATION_ACTION',
          action,
          payload: data
        });
      }
      return;
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Hora da medicação";
  const image = payload.image || payload.icon || "/static/icons/icon-192.png";
  const data = payload.data || {};
  const options = {
    body: payload.body || "Está na hora de confirmar a toma.",
    icon: image,
    badge: "/static/icons/icon-192.png",
    image: payload.image || undefined,
    tag: payload.tag || `lembreme-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    data,
    actions: [
      { action: "confirm", title: "Confirmar toma" },
      { action: "snooze", title: "Adiar 5 min" }
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

  if (!sameOrigin) {
    return;
  }

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
    const clientList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of clientList) {
      if ("focus" in client) {
        await client.focus();
      }
      if (action === "confirm" || action === "snooze") {
        client.postMessage({
          type: "LEMBREME_NOTIFICATION_ACTION",
          action,
          payload: data
        });
      }
      return;
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
