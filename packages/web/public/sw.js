/*
 * Soumaya service worker — makes the app installable + resilient offline.
 *
 * Deliberately conservative so it can never serve stale/incorrect data:
 *  - /api/* is NEVER cached (always hits the network — it's per-brain, live data).
 *  - Navigations are network-first, falling back to the cached shell when offline.
 *  - Other same-origin GETs (JS/CSS/images/models/decoder) are cache-first with a
 *    background network fill, so the galaxy loads instantly and works offline.
 * CACHE is stamped with a unique build id at build time (scripts/stamp-sw.mjs),
 * so every deploy gets a fresh cache name and `activate` evicts the old one —
 * no installed PWA can keep serving a stale shell.
 */
const CACHE = "soumaya-__BUILD_ID__";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through
  if (url.pathname.startsWith("/api/")) return; // never cache live brain data

  // App navigations: network-first so deploys show up; cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache a GOOD shell. Without this, a 5xx maintenance page or a
          // captive-portal interstitial would be written as the offline shell and
          // then served on every later offline navigation.
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || caches.match(req))),
    );
    return;
  }

  // Static assets: NETWORK-FIRST (was cache-first). Cache-first could serve a stale
  // JS bundle forever on an installed PWA — the infinite-loading-screen bug. Fetch
  // fresh when online (content-hashed assets stay HTTP-immutable, so this is cheap),
  // fill the cache for offline, and fall back to cache only when the network fails.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});

// Web push (Immersion Round 3, CL3): the server sends a minimal JSON payload
// { title, body, url } when a reminder fires for this brain. These handlers
// are purely additive — they never touch the cache/fetch behavior above, and
// a malformed payload still produces an honest generic notification rather
// than silence (a push event that shows nothing can get the subscription
// flagged by the browser).
self.addEventListener("push", (e) => {
  let data = { title: "Soumaya", body: "You have a new reminder.", url: "/" };
  try {
    if (e.data) {
      const parsed = e.data.json();
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.title === "string" && parsed.title) data.title = parsed.title;
        if (typeof parsed.body === "string" && parsed.body) data.body = parsed.body;
        if (typeof parsed.url === "string" && parsed.url) data.url = parsed.url;
      }
    }
  } catch {
    try {
      const text = e.data && e.data.text();
      if (text) data.body = text;
    } catch {
      /* keep the generic body */
    }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          try {
            if (new URL(client.url).origin === self.location.origin && "focus" in client) {
              if ("navigate" in client) {
                return client.navigate(target).then((c) => (c ? c.focus() : client.focus()));
              }
              return client.focus();
            }
          } catch {
            /* try the next window */
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
        return undefined;
      }),
  );
});
