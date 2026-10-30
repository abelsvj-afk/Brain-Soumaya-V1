import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { NpcRepo } from "../npcs/repo.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { buildContext } from "../context.js";
import { createApp } from "../api/server.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Relics I-3 — gate permanence at set completion (fix (a)) and
 * class-aware release (fix (b)). Implementation design §4.8 / §6 / §7 I-3;
 * reconciliation Q4 + Q6-2/Q6-3.
 *
 * This file is written to also RUN against the pre-I-3 tree: there, the
 * permanence and refusal assertions fail (the fail-before evidence),
 * while the behavior-preservation guards (non-Keystone release shape,
 * brain-deletion contract, NPC gate semantics) pass on both trees.
 * release() returns a bare view before I-3 and a discriminated result
 * after; the two readers below read both shapes so the same file is
 * honest evidence on either tree.
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); });

const store = () => new RelicHoldingsStore(handle);
function give(space: string, relicId: string): void {
  handle.sqlite.prepare(
    `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, '2026-10-01T00:00:00.000Z', 0, 0, NULL, ?)`,
  ).run(space, relicId, `${relicId}:resting-place-one`);
}
const travelWith = (space: string) => new TravelRepo(handle, space, () => store().gateHoldings(space));
function gateRow(space: string): { space_id: string; opened_at: string } | undefined {
  try {
    return handle.sqlite.prepare(`SELECT space_id, opened_at FROM relic_gate_opened WHERE space_id = ?`).get(space) as { space_id: string; opened_at: string } | undefined;
  } catch { return undefined; }
}
function eventOf(out: unknown): { fromAnchor?: string | null; toAnchor?: string | null } {
  const o = (out ?? {}) as { event?: { fromAnchor?: string | null; toAnchor?: string | null }; fromAnchor?: string | null; toAnchor?: string | null };
  return o.event ?? o;
}
function refusedOf(out: unknown): string | null {
  const o = (out ?? {}) as { ok?: boolean; reason?: string };
  return o.ok === false ? (o.reason ?? "") : null;
}
function findSet(space: string): void {
  expect(store().claimFind(space, "witness-without-a-name", "deep-past").ok).toBe(true);
  expect(store().claimFind(space, "harbor-nail", "great-station").ok).toBe(true);
  expect(store().claimFind(space, "dawn-leaf", "growing-place").ok).toBe(true);
}

describe("fix (a) — gate permanence anchors at set completion", () => {
  it("completing the set via finds records permanence inside the claim transaction; releasing the other members afterwards cannot re-close the gate", () => {
    findSet("s1");
    // The record exists the moment the third find lands — before any travel.
    expect(gateRow("s1")).toBeTruthy();
    expect(store().release("s1", "harbor-nail")).not.toBeNull();
    expect(store().release("s1", "dawn-leaf")).not.toBeNull();
    expect(store().foundIds("s1")).toEqual(["witness-without-a-name"]);
    const view = store().gateView("s1");
    expect(view.open).toBe(true);
    expect(view.openedBefore).toBe(true);
    // The exact predicate depart() enforces server-side (travel.repo.ts).
    expect(travelWith("s1").eternityGateReachable()).toBe(true);
  });

  it("a set completed before this build (direct holdings, no record) records permanence inside the RELEASE transaction, before the release can endanger it", () => {
    give("s2", "witness-without-a-name"); give("s2", "harbor-nail"); give("s2", "dawn-leaf");
    expect(gateRow("s2")).toBeUndefined();
    expect(refusedOf(store().release("s2", "harbor-nail"))).toBeNull();
    // The recorder ran in that release's own transaction — the row exists
    // BEFORE the second release drops the found set below completion.
    expect(gateRow("s2")).toBeTruthy();
    expect(refusedOf(store().release("s2", "dawn-leaf"))).toBeNull();
    expect(store().foundIds("s2")).toEqual(["witness-without-a-name"]);
    expect(store().gateView("s2").open).toBe(true);
    expect(travelWith("s2").eternityGateReachable()).toBe(true);
  });

  it("backfill: a space that already crossed gets its record with the crossing's own arrival time", () => {
    handle.sqlite.prepare(
      `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline, arrived_at) VALUES ('j-s3', 's3', 'ck-s3', 'drift', 'deep-past', 'eternity', 'arrived', 0, '2026-10-05T09:58:00.000Z', '2026-10-05T09:59:00.000Z', '2026-10-05T10:00:00.000Z')`,
    ).run();
    store().ensureMigrated();
    const row = gateRow("s3");
    expect(row).toBeTruthy();
    expect(row!.opened_at).toBe("2026-10-05T10:00:00.000Z");
    expect(travelWith("s3").eternityGateOpened()).toBe(true);
  });

  it("two-space isolation: one space's record never opens another space's gate; the table is in the deletion census", () => {
    give("sA", "witness-without-a-name"); give("sA", "harbor-nail"); give("sA", "dawn-leaf");
    expect(refusedOf(store().release("sA", "harbor-nail"))).toBeNull();
    expect(gateRow("sA")).toBeTruthy();
    give("sB", "harbor-nail");
    expect(gateRow("sB")).toBeUndefined();
    expect(store().gateView("sB").open).toBe(false);
    expect(travelWith("sB").eternityGateReachable()).toBe(false);
    expect(SPACE_SCOPED_TABLES).toContain("relic_gate_opened");
  });
});

describe("fix (b) — release is class-aware", () => {
  it("releasing the Witness (a Keystone) is refused cleanly; the holding and its copy are untouched", () => {
    expect(store().claimFind("s5", "witness-without-a-name", "deep-past").ok).toBe(true);
    const out = store().release("s5", "witness-without-a-name");
    const refused = refusedOf(out);
    expect(refused).toBeTruthy();
    expect(refused).toMatch(/keystone/i);
    expect(store().foundIds("s5")).toEqual(["witness-without-a-name"]);
    const copy = handle.sqlite.prepare(`SELECT state, holder_space_id FROM relic_copies WHERE relic_id = 'witness-without-a-name'`).get() as { state: string; holder_space_id: string };
    expect(copy.state).toBe("held");
    expect(copy.holder_space_id).toBe("s5");
  });

  it("non-Keystone releases behave exactly as before: a null-class relic and a Legacy both release with the return view", () => {
    expect(store().claimFind("s6", "harbor-nail", "great-station").ok).toBe(true);
    const nail = store().release("s6", "harbor-nail");
    expect(refusedOf(nail)).toBeNull();
    expect(eventOf(nail).fromAnchor).toBeTruthy();
    expect(eventOf(nail).toAnchor).toBeTruthy();
    expect(store().foundIds("s6")).toEqual([]);
    const nailCopy = handle.sqlite.prepare(`SELECT state FROM relic_copies WHERE relic_id = 'harbor-nail'`).get() as { state: string };
    expect(nailCopy.state).toBe("placed");
    // Legacies remain releasable in this increment — their exchange is I-6.
    give("s6", "unnumbered-fragment");
    const frag = store().release("s6", "unnumbered-fragment");
    expect(refusedOf(frag)).toBeNull();
    expect(store().foundIds("s6")).toEqual([]);
  });

  it("brain deletion still returns a counted Keystone copy — deletion is not a player release", () => {
    findSet("s7");
    const witnessCopy = handle.sqlite.prepare(`SELECT copy_id FROM relic_copies WHERE relic_id = 'witness-without-a-name'`).get() as { copy_id: string };
    const out = store().releaseAllForSpace("s7");
    expect(out.removedTotal).toBe(3);
    expect(store().foundIds("s7")).toEqual([]);
    const copy = handle.sqlite.prepare(`SELECT state FROM relic_copies WHERE copy_id = ?`).get(witnessCopy.copy_id) as { state: string };
    expect(copy.state).toBe("placed");
    const kinds = (handle.sqlite.prepare(`SELECT kind FROM relic_copy_events WHERE copy_id = ?`).all(witnessCopy.copy_id) as { kind: string }[]).map((e) => e.kind);
    expect(kinds).toContain("brain-deleted");
  });
});

describe("NPC gate — the mirrored pattern is untouched", () => {
  it("NpcRepo gate semantics are unchanged, and player/NPC gate records never leak into each other", () => {
    const npc = new NpcRepo(handle, "s8");
    expect(npc.gateOpen("harbor-controller")).toBe(false);
    npc.markGateOpen("harbor-controller");
    expect(npc.gateOpen("harbor-controller")).toBe(true);
    // A player's set completion in the same space writes the PLAYER record
    // only; another space's NPC gate stays closed.
    give("s8", "witness-without-a-name"); give("s8", "harbor-nail"); give("s8", "dawn-leaf");
    expect(refusedOf(store().release("s8", "harbor-nail"))).toBeNull();
    expect(gateRow("s8")).toBeTruthy();
    const other = new NpcRepo(handle, "s9");
    expect(other.gateOpen("harbor-controller")).toBe(false);
    expect(gateRow("s9")).toBeUndefined();
  });
});

describe("HTTP surface — POST /api/relics/release", () => {
  let ctx: AppContext; let server: Server; let base: string;
  async function auth(tag: string): Promise<string> {
    const res = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }) });
    return ((await res.json()) as { id: string }).id;
  }
  async function call(method: string, path: string, space: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": space }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { error?: string; comet?: { relicId: string }; found?: string[] } };
  }
  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

  it("a Keystone release is refused with 400 and the plain reason; a non-Keystone release still returns 200 with the comet", async () => {
    const space = await auth("relic-i3-http");
    const s = new RelicHoldingsStore(ctx.handle);
    expect(s.claimFind(space, "witness-without-a-name", "deep-past").ok).toBe(true);
    expect(s.claimFind(space, "harbor-nail", "great-station").ok).toBe(true);
    const refused = await call("POST", "/api/relics/release", space, { relicId: "witness-without-a-name" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/keystone/i);
    const stateAfter = await call("GET", "/api/relics", space);
    expect(stateAfter.body.found).toContain("witness-without-a-name");
    const ok = await call("POST", "/api/relics/release", space, { relicId: "harbor-nail" });
    expect(ok.status).toBe(200);
    expect(ok.body.comet?.relicId).toBe("harbor-nail");
  });
});
