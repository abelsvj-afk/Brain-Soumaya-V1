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
 *
 * ONE deliberate exception: the heavy, un-hashed binaries (3D models .glb and the
 * Draco/Basis decoders) live in ASSET_CACHE, which is NOT build-stamped and survives
 * deploys. They are 6-40 MB per visit and rarely change, yet the browser's own HTTP
 * cache would not keep the largest ones (measured: a 14 MB and a 10.5 MB model were
 * re-downloaded in full on EVERY visit while smaller files revalidated). They are served
 * from ASSET_CACHE at once and re-validated in the background with a conditional
 * request (If-None-Match), so a file replaced in place on the server shows up on the
 * next launch. Code (JS/CSS), pages and /api are untouched by this and stay network-first.
 */
const CACHE = "soumaya-__BUILD_ID__";
const ASSET_CACHE = "soumaya-assets-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
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

  // Heavy binaries (models, decoders): persistent cache + background validation. A Range
  // request (partial content — audio/video seeking) is never intercepted.
  if (isHeavyAsset(url) && !req.headers.has("range")) {
    e.respondWith(heavyAsset(e, req));
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

function isHeavyAsset(url) {
  return url.pathname.endsWith(".glb") || url.pathname.startsWith("/draco/") || url.pathname.startsWith("/basis/");
}

/** Only a complete, real file is worth keeping: a 200 from our own origin that is not an
 *  HTML page — the SPA fallback answers an unknown path with index.html and a 200, and
 *  caching that as a model would serve a web page to the 3D loader forever. */
function isGoodAsset(res) {
  return (
    res.status === 200 &&
    res.type === "basic" &&
    !/text\/html/i.test(res.headers.get("content-type") || "")
  );
}

const inflight = new Map(); // url -> Promise<Response> of a download in progress

async function heavyAsset(e, req) {
  let cache;
  try {
    cache = await caches.open(ASSET_CACHE);
  } catch {
    return fetch(req); // cache storage unavailable — behave as if this worker weren't here
  }
  const cached = await cache.match(req).catch(() => undefined);
  if (cached) {
    e.waitUntil(revalidateAsset(cache, req, cached));
    return cached;
  }
  // One download per file at a time. The destination world's models are prefetched during the
  // flight; if the scene mounts and asks for the same file while that is still streaming, it
  // must JOIN it, not start a second 14 MB download. Each caller gets its own clone.
  let pending = inflight.get(req.url);
  if (!pending) {
    pending = fetch(req).then((res) => {
      if (isGoodAsset(res)) {
        // put() only resolves once the whole body is read, so an interrupted download is never kept.
        e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      }
      return res;
    });
    inflight.set(req.url, pending);
    const forget = () => inflight.delete(req.url);
    pending.then(forget, forget);
  }
  return (await pending).clone();
}

/** Ask the server "has this changed?" with the cached copy's validator. 304 = keep it (a
 *  few hundred bytes); 200 = the file was replaced, store the new one for the next launch. */
async function revalidateAsset(cache, req, cached) {
  const etag = cached.headers.get("etag");
  const modified = cached.headers.get("last-modified");
  if (!etag && !modified) return; // nothing to validate against
  try {
    const res = await fetch(req.url, {
      cache: "no-store", // bypass the HTTP cache so OUR validator is what the server sees
      credentials: "same-origin",
      headers: {
        ...(etag ? { "If-None-Match": etag } : { "If-Modified-Since": modified }),
        // REQUIRED, and subtle: `cache: "no-store"` makes the browser add
        // `Cache-Control: no-cache` to the request, and Express's freshness check
        // (the `fresh` module behind static files) treats that as a forced reload and
        // IGNORES the validator — answering 200 with the whole 14 MB body instead of
        // 304 (measured). Supplying our own Cache-Control stops the browser adding its
        // own, and max-age=0 is not "no-cache", so the validator is honoured.
        "Cache-Control": "max-age=0",
      },
    });
    if (res.status === 304) return;
    if (isGoodAsset(res)) await cache.put(req, res);
  } catch {
    /* offline or server down — the cached copy keeps serving */
  }
}

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
