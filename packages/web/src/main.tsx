import { createRoot } from "react-dom/client";
import App from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { maybeReloadForChunkError } from "./lib/chunkReload.js";
import "./index.css";

// Stale-shell recovery (deploy renamed the hashed chunks; this shell is old):
// Vite's preload helper dispatches `vite:preloadError` when a lazy chunk fails
// to load. Reload once into the fresh shell (loop-guarded in chunkReload);
// preventDefault only when a reload was actually triggered — inside the guard
// window Vite's rethrow proceeds and the normal error path shows, as before.
window.addEventListener("vite:preloadError", (event) => {
  const payload = (event as Event & { payload?: unknown }).payload;
  if (maybeReloadForChunkError(payload)) {
    event.preventDefault();
  }
});

// Global error visibility (vanilla DOM, not React — works even if React itself is
// wedged). An uncaught error or promise rejection anywhere — a WebGL/three.js tick,
// an async handler, a bad chunk — used to die silently and leave the app looking
// "frozen" with no clue why. Now it surfaces the actual message in a dismissible bar
// so a stuck user can read (and screenshot) exactly what broke instead of a black hole.
(function installGlobalErrorBar() {
  // Known-benign noise from the 3D library / browser that isn't worth alarming over:
  // stray multitouch pointer events on the WebGL canvas, ResizeObserver's harmless loop
  // warning, and cross-origin "Script error" with no detail.
  const BENIGN = /pointerId|pointercapture|ResizeObserver loop|^Script error\.?$|Non-Error promise rejection/i;
  let shown = 0;
  const show = (label: string, detail: string) => {
    if (BENIGN.test(detail)) return;
    if (shown >= 3) return; // don't paper the screen if something loops
    shown++;
    const bar = document.createElement("div");
    bar.setAttribute("role", "alert");
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:100000;background:#2a0e14;color:#ffdce0;" +
      "font:12px/1.5 system-ui,sans-serif;padding:10px 14px;border-top:1px solid #ff6b81;" +
      "box-shadow:0 -6px 24px rgba(0,0,0,.5);display:flex;gap:10px;align-items:flex-start";
    const msg = document.createElement("div");
    msg.style.cssText = "flex:1 1 auto;overflow:hidden;text-overflow:ellipsis";
    msg.textContent = `${label}: ${detail}`.slice(0, 300);
    const x = document.createElement("button");
    x.textContent = "×";
    x.style.cssText = "background:none;border:none;color:#ffdce0;font-size:18px;line-height:1;cursor:pointer;flex:0 0 auto";
    x.onclick = () => bar.remove();
    bar.appendChild(msg);
    bar.appendChild(x);
    document.body.appendChild(bar);
  };
  window.addEventListener("error", (e) => {
    if (e?.message) show("Error", `${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r: unknown = (e as PromiseRejectionEvent).reason;
    show("Unhandled", r instanceof Error ? `${r.message}` : String(r));
  });
})();

// Note: no StrictMode — the 3D scene does one-time imperative setup (bloom,
// starfield, render loop) that double-invocation would duplicate.
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Register the service worker so the app is installable (Add to Home Screen) and
// resilient offline. Prod only — the dev server shouldn't be intercepted. The SW
// itself never caches /api, so live brain data is always fresh.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Actively check for a new SW every launch (otherwise the browser may not
        // notice a deploy for up to a day). The new SW skipWaiting()s + claims, so
        // it takes control immediately and serves fresh assets on the NEXT natural
        // navigation. We deliberately do NOT force a reload here: a `controllerchange`
        // fires whenever the SW first claims an uncontrolled page (e.g. the very first
        // load after a cache clear), and reloading on it yanked the page out from
        // under the user — turning a normal first paint into an endless reload/reset
        // loop that read as a freeze. Letting the fresh code load on the next visit is
        // both correct and safe; the manual "Reset app" button covers the rare stuck case.
        reg.update();
      })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed:", err);
      });
  });
}

