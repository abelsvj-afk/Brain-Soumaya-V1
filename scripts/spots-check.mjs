#!/usr/bin/env node
/**
 * Lore spots — MEASURED in a real browser (docs/specs/lore-physical-spots-2026-10-31.md). For each flight world it drifts there through the server, opens the app at phone size with the
 * read-only probe on (localStorage "soumaya.probe"), waits for the scene, and prints where each lore spot resolves: the landmark found (or MISSING), its centre and radius, and the reach.
 *
 *   BASE_URL=http://localhost:3001 SPACE_ID=<brain key> node scripts/spots-check.mjs [world ...]
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
const WORLDS = process.argv.slice(2).length ? process.argv.slice(2) : ["great-station", "deep-past", "scale", "quiet-archive"];
const H = { "content-type": "application/json", "x-space-id": SPACE };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => {
  const r = await fetch(`${BASE}/api/travel${path}`, { method: body ? "POST" : "GET", headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
async function travelTo(world) {
  const st = await api("/state");
  if (st.json.activeJourney) await api("/arrive", { journeyId: st.json.activeJourney.id });
  if ((await api("/state")).json.currentWorld === world) return null;
  const d = await api("/depart", { clientKey: `spots-${world}-${Date.now()}`, kind: "drift", destination: world });
  if (!d.json.journey) return d.json;
  await sleep(11_000); // the free-cancel window; the server settles on the next read
  await api("/state");
  await api("/arrive", { journeyId: d.json.journey.id });
  return null;
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
let bad = 0;
for (const world of WORLDS) {
  const refused = await travelTo(world);
  if (refused) {
    console.log(`${world}: GATED/REFUSED (${refused.code ?? refused.error ?? "refused"})`);
    continue;
  }
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  await page.addInitScript(([id]) => {
    localStorage.setItem("brain.spaceId", id);
    localStorage.setItem("soumaya.probe", "1");
  }, [SPACE]);
  await page.goto(BASE + "/");
  await page.waitForFunction(() => document.querySelector("canvas") !== null, null, { timeout: 60_000 }).catch(() => {});
  await page.evaluate(() => window.dispatchEvent(new Event("worlds:enter")));
  const probe = await page
    .waitForFunction(() => window.__loreProbe?.report?.(), null, { timeout: 300_000, polling: 1000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  if (!probe) {
    console.log(`${world}: probe never appeared (scene did not mount)`);
    bad++;
  } else {
    // models load late (the big worlds most of all): give them time, then read again
    await sleep(Number(process.env.SETTLE_MS ?? 25000));
    const final = await page.evaluate(() => window.__loreProbe.report());
    console.log(`\n${world}`);
    for (const r of final) {
      const m = r.marks;
      const mark = m.length ? m.map((x) => `${x.name} @(${x.center.map((n) => Math.round(n)).join(",")}) r=${Math.round(x.radius)}`).join(" | ") : "MISSING";
      const reach = r.spot.origin ? r.spot.near : Math.round(Math.max(r.spot.near * (m[0]?.radius ?? 0), r.spot.min ?? 60));
      console.log(`  ${m.length ? "ok     " : "MISSING"} ${r.entryId.padEnd(28)} ${mark}   reach ≈ ${reach}`);
      if (!m.length) bad++;
    }
    if (final.some((r) => !r.marks.length)) console.log("  scene holders: " + (await page.evaluate(() => window.__loreProbe.names())).join(", "));
  }
  await page.close();
  await sleep(8000);
}
await browser.close();
process.exit(bad ? 1 : 0);
