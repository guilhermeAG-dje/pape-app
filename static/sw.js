const CACHE = "lembreme-v6";
// Precache only the kiosk essentials. Admin assets are kept network-first to avoid stale UI.
const ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/static/css/style.css",
  "/static/css/admin.css",
  "/static/js/pwa.js",
  "/static/js/script.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // For navigations (HTML), always go to network first.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match("/"))
    );
    return;
  }

  if (!sameOrigin) {
    return;
  }

  // API responses must never be cached, otherwise Render can show stale data.
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
    event.respondWith(fetch(req));
    return;
  }

  // For /static/*, prefer network to always reflect local changes.
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Other same-origin assets: cache-first.
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
