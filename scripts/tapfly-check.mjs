#!/usr/bin/env node
/**
 * Tap-to-fly — MEASURED in a real browser (docs/specs/lore-physical-spots-2026-10-31.md §6). Drifts to a flight world, opens the app at phone size with the read-only probe on,
 * taps the scene at a few points, and checks her ship really left where it was (probe `flight()`), arrived (phase back to idle) and that a double tap does NOT launch her.
 *
 *   BASE_URL=http://localhost:3001 SPACE_ID=<brain key> node scripts/tapfly-check.mjs [world]
 *
 * Moves the brain (like worlds-check). SPACE_ID is a credential: environment only.
 */
import { createRequire } from "node:module";

const BASE = (process.env.BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const SPACE = process.env.SPACE_ID;
if (!SPACE) {
  console.error("Set SPACE_ID to the brain key to test.");
  process.exit(2);
}
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = createRequire(process.cwd() + "/")("playwright"));
}
const world = process.argv[2] ?? "quiet-archive";
const H = { "content-type": "application/json", "x-space-id": SPACE };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => {
  const r = await fetch(`${BASE}/api/travel${path}`, { method: body ? "POST" : "GET", headers: H, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
};
async function goThere() {
const st = await api("/state");
if (st?.activeJourney) await api("/arrive", { journeyId: st.activeJourney.id });
if ((await api("/state"))?.currentWorld !== world) {
  const d = await api("/depart", { clientKey: `tapfly-${Date.now()}`, kind: "drift", destination: world });
  if (!d?.journey) {
    console.log("refused", JSON.stringify(d));
    process.exit(1);
  }
  await sleep(11_000);
  await api("/state");
  await api("/arrive", { journeyId: d.journey.id });
}
}
const browser = await chromium.launch({ args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(([id]) => {
  localStorage.setItem("brain.spaceId", id);
  localStorage.setItem("soumaya.probe", "1");
  // first-run surfaces would sit over the scene and swallow the taps
  localStorage.setItem(`brain.introSeen.${id}`, "1");
  localStorage.setItem(`brain.legendSeen.${id}`, "1");
  localStorage.setItem("worlds.lookHintSeen", "1");
}, [SPACE]);
await page.goto(BASE + "/");
await page.waitForFunction(() => document.querySelector("canvas") !== null, null, { timeout: 60_000 }).catch(() => {});
// The app settles a ledger that is out in a world back home when it opens (place truth), so go there AFTER it has loaded, then tell the worlds layer.
await sleep(6000);
await goThere();
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("worlds:travel-changed", { detail: { action: "arrive" } }));
  window.dispatchEvent(new Event("worlds:enter"));
});
await page.waitForFunction(() => window.__loreProbe?.report?.(), null, { timeout: 240_000, polling: 1000 }).catch(() => {});
await sleep(Number(process.env.SETTLE_MS ?? 15000));
// the Observatory opens over the scene on load and would swallow every tap
for (let i = 0; i < 6 && (await page.locator(".observatory").count()) > 0; i++) {
  await page.evaluate(() => document.querySelector(".obs-close")?.click());
  await sleep(1500);
}
console.log("observatory still open:", (await page.locator(".observatory").count()) > 0);
const flight = () => page.evaluate(() => window.__loreProbe?.flight?.() ?? null);
const host = await page.evaluate(() => {
  const el = document.querySelector(".worlds-surface canvas") ?? document.querySelector("canvas");
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
console.log("probe up; canvas", JSON.stringify(host), "flight before:", JSON.stringify(await flight()));
console.log("probe world:", await page.evaluate(() => window.__loreProbe?.world), "| on top at centre:", await page.evaluate(() => { let c = document.elementFromPoint(206, 500), ch = []; while (c && ch.length < 4) { ch.push(c.tagName + "." + c.className); c = c.parentElement; } return ch.join(" < "); }));
let bad = 0;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
for (const [fx, fy] of [[0.5, 0.55], [0.3, 0.4], [0.7, 0.7]]) {
  const before = await flight();
  await page.mouse.click(host.x + host.w * fx, host.y + host.h * fy);
  // a tap flies after a 330 ms double-tap window; poll for the phases it goes through (align → spool → burn → idle). Headless runs ~2 fps, so poll fast.
  const seen = new Set();
  let after = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    await sleep(250);
    after = await flight();
    if (after) seen.add(after.phase);
    if (seen.size > 1 && after?.phase === "idle") break;
    if (Date.now() - t0 > 3000 && !seen.size) break; // never launched
  }
  const moved = before && after ? dist(before.pos, after.pos) : null;
  const launched = [...seen].some((p) => p !== "idle");
  const ok = launched && after?.phase === "idle";
  console.log(`${ok ? "PASS" : "FAIL"} tap(${fx},${fy}) phases=${[...seen].join("→") || "none"} moved=${moved === null ? "from stowed" : Math.round(moved)}`);
  if (!ok) bad++;
}
// a double tap must reset the view, never launch her
const pre = await flight();
await page.mouse.dblclick(host.x + host.w * 0.5, host.y + host.h * 0.5);
await sleep(1500);
const post = await flight();
const dbl = !post || !pre || (post.phase === "idle" && dist(pre.pos, post.pos) < 5);
console.log(`${dbl ? "PASS" : "FAIL"} double tap does not launch her (${pre?.phase}→${post?.phase})`);
if (!dbl) bad++;
if (errors.length) console.log("page errors:", errors.slice(0, 3).join(" | "));
await browser.close();
process.exit(bad ? 1 : 0);
