#!/usr/bin/env node
/**
 * Worlds health check — visits every world for real and says which work.
 *
 *   BASE_URL=http://localhost:3001 SPACE_ID=<brain key> node scripts/worlds-check.mjs [world ...]
 *
 * For each world it takes a free drift there through the server (so it works
 * with no fuel), then loads the app fresh in a real headless browser at phone
 * size and waits for the world's 3D canvas. A world PASSES only if its scene
 * mounted, drew a canvas, showed no "needs graphics support" fallback, and the
 * page logged no errors and no failed (4xx/5xx) requests. It also reports how
 * long the canvas took and how many MB of 3D/image assets the load pulled —
 * the number that explains "slow" on a phone. A screenshot per world lands in
 * ./worlds-check-out/ so a human can still judge what it looks like.
 *
 * Needs the `playwright` package (not a repo dependency — `npm i -D playwright`
 * or run where it is installed). A world the brain's gates refuse (People and
 * Eternity for a non-owner) is reported GATED, not FAILED. SPACE_ID is a
 * credential: pass it in the environment, never commit it.
 *
 * It MOVES the brain: it ends wherever the last world was. Run it against a
 * test brain, or expect to travel home afterwards.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const SPACE = process.env.SPACE_ID;
if (!SPACE) {
  console.error("Set SPACE_ID to the brain key to test (Settings → Owner access → Copy my brain key).");
  process.exit(2);
}
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  try {
    // Not in the repo's node_modules — fall back to wherever the caller has it.
    ({ chromium } = createRequire(join(process.cwd(), "noop.js"))("playwright"));
  } catch {
    console.error("This check needs the `playwright` package: npm i -D playwright");
    process.exit(2);
  }
}

const ALL = ["great-station", "growing-place", "deep-past", "people", "quiet-archive", "scale", "eternity"];
const worlds = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const H = { "x-space-id": SPACE, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => {
  const r = await fetch(`${BASE}/api/travel${path}`, { method: body ? "POST" : "GET", headers: H, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const ASSET = /\.(glb|gltf|ktx2|png|jpe?g|webp|bin)(\?|$)/;

/** Take a free drift to `world` via the server. Returns null on success, or the refusal. */
async function travelTo(world) {
  const st = await api("/state");
  if (st.json.activeJourney) await api("/arrive", { journeyId: st.json.activeJourney.id });
  if ((await api("/state")).json.currentWorld === world) return null;
  const d = await api("/depart", { clientKey: `check-${world}-${Date.now()}`, kind: "drift", destination: world });
  if (!d.json.journey) return d.json;
  await sleep(11_000); // the free-cancel window; the server settles on the next read
  await api("/state");
  await api("/arrive", { journeyId: d.json.journey.id });
  return null;
}

mkdirSync("worlds-check-out", { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const rows = [];

for (const world of worlds) {
  const refused = await travelTo(world);
  if (refused) {
    rows.push({ world, verdict: "GATED", note: refused.code ?? refused.error ?? "refused" });
    continue;
  }
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  const bad = [];
  let bytes = 0;
  const t0 = Date.now();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/vibrate/.test(m.text())) errors.push(m.text().slice(0, 140));
  });
  page.on("response", (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`);
    if (ASSET.test(r.url())) bytes += Number(r.headers()["content-length"] ?? 0);
  });
  await page.addInitScript((id) => localStorage.setItem("brain.spaceId", id), SPACE);
  await page.goto(BASE + "/");
  let canvasAt = null;
  let fallback = null;
  let title = null;
  for (let i = 0; i < 160 && !fallback; i++) {
    await sleep(500);
    const s = await page.evaluate(() => {
      const ws = document.querySelector(".worlds-surface");
      if (!ws) return null;
      return {
        title: ws.querySelector("h3")?.innerText ?? null,
        canvas: !!ws.querySelector("canvas"),
        needsGraphics: /needs graphics support/.test(ws.innerText),
      };
    });
    if (!s) continue;
    title = s.title;
    if (s.needsGraphics) fallback = "scene shows its 'needs graphics support' fallback";
    if (s.canvas && canvasAt === null) canvasAt = Date.now() - t0;
    if (canvasAt !== null && Date.now() - t0 > canvasAt + 6000) break; // let late assets surface errors
  }
  await page.screenshot({ path: `worlds-check-out/${world}.png` });
  await page.close();
  const problems = [];
  if (canvasAt === null) problems.push("no world canvas appeared");
  if (fallback) problems.push(fallback);
  if (errors.length) problems.push(`${errors.length} console error(s): ${errors[0]}`);
  if (bad.length) problems.push(`${bad.length} failed request(s): ${bad.slice(0, 2).join(", ")}`);
  rows.push({
    world,
    verdict: problems.length ? "FAIL" : "PASS",
    note: problems.join("; "),
    title,
    canvasMs: canvasAt,
    mb: (bytes / 1048576).toFixed(1),
  });
  await sleep(8_000); // stay under the server's request rate limit between fresh page loads
}
await browser.close();

console.log("\nWORLD            VERDICT  CANVAS    DOWNLOAD  NOTE");
for (const r of rows) {
  console.log(
    `${r.world.padEnd(16)} ${r.verdict.padEnd(8)} ${(r.canvasMs != null ? r.canvasMs + "ms" : "-").padEnd(9)} ${(r.mb != null ? r.mb + " MB" : "-").padEnd(9)} ${r.note ?? ""}`,
  );
}
console.log("\nScreenshots: ./worlds-check-out/  (the CANVAS time is a headless software renderer — compare worlds, not phones)");
process.exit(rows.some((r) => r.verdict === "FAIL") ? 1 : 0);
