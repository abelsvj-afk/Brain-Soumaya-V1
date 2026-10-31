import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { buildContext } from "../context.js";
import { createApp } from "../api/server.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Relics P2-7 (I-7 independent review, round 2) — the /release route was
 * the one relic handler that did not call ensureMigrated() first.
 *
 * The one-time legacy conversion (codex_claims → relic_holdings, the §8
 * ship migration) settles lazily, once per handle, and state() itself
 * runs it. So when /release was the FIRST relic operation on a fresh
 * handle, the release was evaluated against the pre-migration snapshot
 * and the response's own trailing state() ran the conversion afterwards
 * — the just-released (or never-evaluated) holding materialized in the
 * returned state. Every sibling handler settles the migration at its
 * top; /release now does too, as do the Station-gated change handlers
 * (/hold, /store, /carry), whose store calls read the same snapshot and
 * produced the same wrong refusal ("You have not found that relic
 * yet.") against a legacy-only discovery.
 *
 * Each test boots a FRESH app + handle (the migration flag is
 * per-handle, so a shared handle would settle it for every test) and
 * seeds the legacy state by direct SQL only — a codex_claims row and
 * nothing else — so no relic read can settle the migration early.
 *
 * Written to run against the pre-fix tree as honest fail-before
 * evidence: the first-operation assertions fail there (404 for the
 * release, 400 "not found" for the gated changes); the settled-path
 * guard passes on both trees.
 */
const NAIL = "harbor-nail";
const WITNESS = "witness-without-a-name";

interface StateShape {
  found: string[];
  holdings: { relicId: string; held: boolean; location: string }[];
}
interface RespBody {
  ok?: boolean;
  error?: string;
  comet?: { relicId: string };
  state?: StateShape;
  found?: string[];
  holdings?: StateShape["holdings"];
}

let ctx: AppContext;
let server: Server;
let base: string;

beforeEach(async () => {
  ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => { server?.close(); ctx.handle.sqlite.close(); });

async function auth(tag: string): Promise<string> {
  const res = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }) });
  return ((await res.json()) as { id: string }).id;
}
async function call(method: string, path: string, space: string, body?: unknown): Promise<{ status: number; body: RespBody }> {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": space }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as RespBody };
}

/** The legacy trace of a find, and nothing else: a codex_claims row. */
function seedLegacyDiscovery(space: string, relicId: string): void {
  ctx.handle.sqlite.prepare(`INSERT INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(space, `relic-${relicId}`);
}
function holdingRows(space: string, relicId: string): unknown[] {
  return ctx.handle.sqlite.prepare(`SELECT * FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).all(space, relicId);
}
function discoveryRow(space: string, relicId: string): unknown {
  return ctx.handle.sqlite.prepare(`SELECT * FROM codex_claims WHERE space_id = ? AND reward_key = ?`).get(space, `relic-${relicId}`);
}
/** The travel ledger's word that the space stands at the Great Station. */
function seedArrivedAtStation(space: string): void {
  ctx.handle.sqlite.prepare(
    `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, cancel_deadline, created_at, arrived_at)
     VALUES (?, ?, ?, 'warp', 'home', 'great-station', 'arrived', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:01:00.000Z')`,
  ).run(`j-${space}`, space, `seed-${space}`);
}

describe("P2-7 — /release settles the legacy migration before it operates", () => {
  it("release as the FIRST relic operation on a fresh handle succeeds against the settled snapshot, and the holding does not resurrect in the returned state", async () => {
    const space = await auth("p2-7-release-first");
    seedLegacyDiscovery(space, NAIL);
    // Precondition: nothing has been converted yet on this handle.
    expect(holdingRows(space, NAIL)).toEqual([]);

    const res = await call("POST", "/api/relics/release", space, { relicId: NAIL });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.comet?.relicId).toBe(NAIL);
    // The returned state is the settled truth: no holding, not found-held.
    expect(res.body.state?.found).not.toContain(NAIL);
    expect(res.body.state?.holdings.find((h) => h.relicId === NAIL)).toBeUndefined();
    // The database agrees after the response — no later resurrection.
    expect(holdingRows(space, NAIL)).toEqual([]);
    // Discovery itself is permanent: the codex_claims row is untouched.
    expect(discoveryRow(space, NAIL)).toBeTruthy();
    // And a later read still shows no holding.
    const after = await call("GET", "/api/relics", space);
    expect(after.body.found).not.toContain(NAIL);
    expect(after.body.holdings?.find((h) => h.relicId === NAIL)).toBeUndefined();
  });

  it("a Keystone release attempted as the first operation is refused 400 with the plain reason, and the migrated holding is untouched", async () => {
    const space = await auth("p2-7-keystone-first");
    seedLegacyDiscovery(space, WITNESS);
    expect(holdingRows(space, WITNESS)).toEqual([]);

    const res = await call("POST", "/api/relics/release", space, { relicId: WITNESS });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/keystone/i);
    // The refusal leaves the (now migrated) holding exactly as it was.
    expect(res.body.state?.holdings.find((h) => h.relicId === WITNESS)).toBeTruthy();
    expect(holdingRows(space, WITNESS)).toHaveLength(1);
  });

  it("the settled path is unchanged: once a state read has settled the migration, release behaves exactly as before", async () => {
    const space = await auth("p2-7-settled");
    seedLegacyDiscovery(space, NAIL);
    const settled = await call("GET", "/api/relics", space);
    expect(settled.body.found).toContain(NAIL);

    const res = await call("POST", "/api/relics/release", space, { relicId: NAIL });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.comet?.relicId).toBe(NAIL);
    expect(res.body.state?.holdings.find((h) => h.relicId === NAIL)).toBeUndefined();
    expect(holdingRows(space, NAIL)).toEqual([]);
  });
});

describe("P2-7 audit — the Station-gated change handlers share the discipline", () => {
  it("hold as the FIRST relic operation (at the Station) evaluates the settled snapshot, not the pre-migration one", async () => {
    const space = await auth("p2-7-hold-first");
    seedLegacyDiscovery(space, NAIL);
    seedArrivedAtStation(space);
    expect(holdingRows(space, NAIL)).toEqual([]);

    const res = await call("POST", "/api/relics/hold", space, { relicId: NAIL });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state?.holdings.find((h) => h.relicId === NAIL)?.held).toBe(true);
  });

  it("store as the FIRST relic operation (at the Station) evaluates the settled snapshot", async () => {
    const space = await auth("p2-7-store-first");
    seedLegacyDiscovery(space, NAIL);
    seedArrivedAtStation(space);
    expect(holdingRows(space, NAIL)).toEqual([]);

    const res = await call("POST", "/api/relics/store", space, { relicId: NAIL });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state?.holdings.find((h) => h.relicId === NAIL)?.location).toBe("station");
  });

  it("carry as the FIRST relic operation (at the Station) evaluates the settled snapshot", async () => {
    const space = await auth("p2-7-carry-first");
    seedLegacyDiscovery(space, NAIL);
    seedArrivedAtStation(space);
    expect(holdingRows(space, NAIL)).toEqual([]);

    const res = await call("POST", "/api/relics/carry", space, { relicId: NAIL });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state?.holdings.find((h) => h.relicId === NAIL)?.location).toBe("carried");
  });
});
