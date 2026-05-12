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
