import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicExchangeService } from "../relics/exchange.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { postedExchangeValue } from "../economy.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import {
  RELIC_BY_ID, RELIC_ANCHOR_POINTS, RELIC_THREADS,
  type RelicThreadDef, type RelicTierClass,
} from "@brain/shared";

/**
 * Relics I-6 acceptance evidence, the Legacy exchange + Station-gated
 * changes (implementation design §4.9, §5.6, §5.7, §7 I-6; approved
 * design R2-2/R2-3/R3-1 + §8.1 #9/#12/#13/#14; owner rulings 1 + 5):
 * an exchange is ONE atomic outcome per ownership instance — holding
 * consumed, reward granted, copy returned against its own placement
 * history, receipt recorded — or it is nothing at all. Credits exist
 * only as a posted-value seam reporting "not offered" (no value is
 * invented). Hold changes (hold/unhold/store/carry/exchange) happen
 * only at the Great Station (O-R7); reads and release are not gated.
 *
 * Fixture: hearth-ember is reclassed `legacy` for this file only (the
 * shipped registry is untouched; the original value is restored). The
 * one genuinely-legacy relic, the Unnumbered Fragment, is exercised
 * via a directly-seeded holding — it is undiscoverable and unplaced
 * by design, so its exchanged copy waits in the return pool.
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const hearthDef = RELIC_BY_ID.get("hearth-ember")!;
let hearthClass: RelicTierClass | null = null;
beforeAll(() => { hearthClass = hearthDef.tierClass; hearthDef.tierClass = "legacy"; });
afterAll(() => { hearthDef.tierClass = hearthClass; });

const store = () => new RelicHoldingsStore(handle);
const xchg = () => new RelicExchangeService(handle);
const STATION = "great-station";
const EMBER = "hearth-ember";
const EMBER_ANCHORS = (RELIC_ANCHOR_POINTS[EMBER] ?? []).map((a) => a.anchorKey);

interface CopyRowT { copy_id: string; relic_id: string; state: string; anchor_key: string | null; holder_kind: string | null }
const copyRow = (copyId: string): CopyRowT =>
  handle.sqlite.prepare(`SELECT * FROM relic_copies WHERE copy_id = ?`).get(copyId) as CopyRowT;
const holdingOf = (space: string, relicId: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).get(space, relicId) as
    { copy_id: string; location: string; held: number } | undefined;
const eventsOf = (copyId: string): { kind: string; detail: string | null }[] =>
  handle.sqlite.prepare(`SELECT kind, detail FROM relic_copy_events WHERE copy_id = ? ORDER BY id ASC`).all(copyId) as { kind: string; detail: string | null }[];
const attemptRow = (space: string, key: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_exchange_attempts WHERE space_id = ? AND attempt_key = ?`).get(space, key) as
    { id: number; copy_id: string; relic_id: string; option: string; chart_target_relic_id: string | null; outcome: string } | undefined;
const stirringsOf = (space: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_stirrings WHERE space_id = ?`).all(space) as
    { id: number; relic_id: string; copy_id: string; source: string; chart_exchange_id: number | null; state: string }[];

/** Give a space a held hearth-ember through the ordinary find. Returns its copy id. */
function giveEmber(space: string): string {
  expect(store().claimFind(space, EMBER, "people").ok).toBe(true);
  return holdingOf(space, EMBER)!.copy_id;
}
function withThread<T>(t: RelicThreadDef, fn: () => T): T {
  const arr = RELIC_THREADS as unknown as RelicThreadDef[];
  arr.push(t);
  try { return fn(); } finally { arr.splice(arr.indexOf(t), 1); }
}

describe("Legacy exchange — the chart (§8.1 #14 eligibility, #9 replay)", () => {
  it("a chart exchange is one atomic outcome: holding consumed, chart stirring issued against a real copy, copy returned to a NEW anchor", () => {
    const copyId = giveEmber("s1");
    const genesisAnchor = eventsOf(copyId).find((e) => e.kind === "genesis");
    expect(genesisAnchor).toBeTruthy();
    // The read model offers the chart honestly before the exchange.
    expect(store().state("s1").chartTargets).toContain("thread-of-many");

    const out = xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-1" }, STATION);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.replayed).toBe(false);
    expect(out.returnState).toBe("placed");
    expect(out.returnAnchor).not.toBe(EMBER_ANCHORS[0]);
    expect(out.returnAnchor).toBe(EMBER_ANCHORS[1]);

    // The holding is gone; the same physical copy rests at the new anchor.
    expect(holdingOf("s1", EMBER)).toBeUndefined();
    const copy = copyRow(copyId);
    expect(copy.state).toBe("placed");
    expect(copy.anchor_key).toBe(EMBER_ANCHORS[1]);
    const kinds = eventsOf(copyId).map((e) => e.kind);
    expect(kinds).toContain("exchanged");
    expect(kinds).toContain("returned");
    expect(kinds.at(-1)).toBe("placed");
    const returned = eventsOf(copyId).find((e) => e.kind === "returned")!;
    expect(JSON.parse(returned.detail ?? "{}")).toMatchObject({ reason: "exchange", toAnchor: EMBER_ANCHORS[1] });

    // The chart stirring exists, bound to a real placed copy of the
    // target, exempt from the ambient cap but recorded against this
    // very exchange.
    const attempt = attemptRow("s1", "ex-1")!;
    expect(attempt.option).toBe("chart");
    expect(attempt.chart_target_relic_id).toBe("thread-of-many");
    const stirrings = stirringsOf("s1");
    expect(stirrings).toHaveLength(1);
    expect(stirrings[0]).toMatchObject({ relic_id: "thread-of-many", source: "chart", state: "open", chart_exchange_id: attempt.id });
    expect(out.chartStirringId).toBe(stirrings[0]!.id);
    const promised = copyRow(stirrings[0]!.copy_id);
    expect(promised).toMatchObject({ relic_id: "thread-of-many", state: "placed" });
    const inbox = handle.sqlite.prepare(
      `SELECT COUNT(*) AS n FROM inbox_notifications WHERE space_id = 's1' AND source = 'relic-stirring' AND dedupe_key = ?`,
    ).get(`stirring:${stirrings[0]!.id}`) as { n: number };
    expect(inbox.n).toBe(1);
  });

  it("a replayed exchange returns the recorded outcome and grants nothing twice — even away from the Station (#9)", () => {
    const copyId = giveEmber("s1");
    const first = xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-r" }, STATION);
    expect(first.ok).toBe(true);
    const eventCount = eventsOf(copyId).length;
    // The replay is a re-read of a committed outcome, not a new change:
    // it answers even with the traveller standing elsewhere.
    const replay = xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-r" }, "people");
    expect(replay.ok).toBe(true);
    if (replay.ok && first.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.chartStirringId).toBe(first.chartStirringId);
      expect(replay.returnAnchor).toBe(first.returnAnchor);
    }
    expect(stirringsOf("s1")).toHaveLength(1);
    expect(eventsOf(copyId)).toHaveLength(eventCount);
    expect(holdingOf("s1", EMBER)).toBeUndefined();
  });

  it("an attempt key spent on one relic never replays for another", () => {
    giveEmber("s1");
    expect(xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-k" }, STATION).ok).toBe(true);
    const conflict = xchg().exchange("s1", { relicId: "mooring-ring", option: "lore", attemptKey: "ex-k" }, STATION);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.kind).toBe("malformed");
  });

  it("chart eligibility is re-validated at exchange time: a target discovered after the menu aborts the whole exchange (#14)", () => {
    giveEmber("s2");
    expect(store().state("s2").chartTargets).toContain("thread-of-many");
    // The world moves on: the space discovers the target itself.
    expect(store().claimFind("s2", "thread-of-many", "people").ok).toBe(true);
    expect(store().state("s2").chartTargets).not.toContain("thread-of-many");
    const out = xchg().exchange("s2", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-2" }, STATION);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("chart-ineligible");
    // The abort is total: the Legacy stays held, no receipt, no stirring.
    expect(holdingOf("s2", EMBER)).toBeTruthy();
    expect(copyRow(holdingOf("s2", EMBER)!.copy_id).state).toBe("held");
    expect(attemptRow("s2", "ex-2")).toBeUndefined();
    expect(stirringsOf("s2")).toHaveLength(0);
  });

  it("chart targets that are unplaced or exhausted abort the same way (#14)", () => {
    giveEmber("s3");
    const unplaced = xchg().exchange("s3", { relicId: EMBER, option: "chart", chartTargetRelicId: "star-hanger", attemptKey: "ex-3a" }, STATION);
    expect(unplaced.ok).toBe(false);
    if (!unplaced.ok) expect(unplaced.kind).toBe("chart-ineligible");
    // Exhaust the Harbor Nail's public pool (7 copies, all held away).
    for (let i = 0; i < 7; i++) expect(store().claimFind(`fill-${i}`, "harbor-nail", "great-station").ok).toBe(true);
    const exhausted = xchg().exchange("s3", { relicId: EMBER, option: "chart", chartTargetRelicId: "harbor-nail", attemptKey: "ex-3b" }, STATION);
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) expect(exhausted.kind).toBe("chart-ineligible");
    expect(holdingOf("s3", EMBER)).toBeTruthy();
    expect(attemptRow("s3", "ex-3a")).toBeUndefined();
    expect(attemptRow("s3", "ex-3b")).toBeUndefined();
  });
});

describe("Legacy exchange — lore and credits (R2-3, ruling 1)", () => {
  it("with no eligible thread, the lore option honestly reports itself unavailable — nothing is fabricated", () => {
    giveEmber("s1");
    const view = store().state("s1").holdings.find((h) => h.relicId === EMBER)!;
    expect(view.exchange?.eligible).toBe(true);
    expect(view.exchange?.loreThreadIds).toEqual([]);
    const out = xchg().exchange("s1", { relicId: EMBER, option: "lore", attemptKey: "ex-l0" }, STATION);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("lore-unavailable");
    expect(holdingOf("s1", EMBER)).toBeTruthy();
    expect(attemptRow("s1", "ex-l0")).toBeUndefined();
  });

  it("an eligible thread (other relic placed + text authored and approved) unlocks L3 for both members, atomically", () => {
    const copyId = giveEmber("s1");
    const thread: RelicThreadDef = { threadId: "fixture-ember-thread", relicA: EMBER, relicB: "thread-of-many", condition: "discovery", text: "Fixture words.", approved: true };
    withThread(thread, () => {
      expect(store().state("s1").holdings.find((h) => h.relicId === EMBER)?.exchange?.loreThreadIds).toEqual(["fixture-ember-thread"]);
      const out = xchg().exchange("s1", { relicId: EMBER, option: "lore", attemptKey: "ex-l1" }, STATION);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.unlockedThreadIds).toEqual(["fixture-ember-thread"]);
    });
    const layers = handle.sqlite.prepare(
      `SELECT relic_id, source FROM relic_codex_layers WHERE space_id = 's1' AND layer = 'L3' AND thread_id = 'fixture-ember-thread' ORDER BY relic_id ASC`,
    ).all() as { relic_id: string; source: string }[];
    expect(layers).toEqual([
      { relic_id: "hearth-ember", source: "exchange" },
      { relic_id: "thread-of-many", source: "exchange" },
    ]);
    expect(holdingOf("s1", EMBER)).toBeUndefined();
    expect(copyRow(copyId).state).toBe("placed");
  });

  it("unapproved, unauthored, or unplaced-partner threads are never eligible", () => {
    giveEmber("s1");
    const base = { threadId: "fixture-x", relicA: EMBER, relicB: "thread-of-many", condition: "discovery" as const };
    const variants: RelicThreadDef[] = [
      { ...base, text: "Words.", approved: false },
      { ...base, approved: true },
      { ...base, relicB: "star-hanger", text: "Words.", approved: true },
    ];
    for (const v of variants) {
      withThread(v, () => {
        const out = xchg().exchange("s1", { relicId: EMBER, option: "lore", attemptKey: `ex-lx-${v.relicB}-${String(v.approved)}` }, STATION);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.kind).toBe("lore-unavailable");
      });
    }
    expect(holdingOf("s1", EMBER)).toBeTruthy();
  });

  it("credits exist only as a posted-value seam reporting not offered — no value is invented (ruling 1)", () => {
    giveEmber("s1");
    expect(postedExchangeValue(EMBER)).toEqual({ offered: false });
    const view = store().state("s1").holdings.find((h) => h.relicId === EMBER)!;
    expect(view.exchange?.creditsOffered).toBe(false);
    expect(view.exchange?.creditsValue).toBeNull();
    const out = xchg().exchange("s1", { relicId: EMBER, option: "credits", attemptKey: "ex-c1" }, STATION);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("credits-not-offered");
    expect(holdingOf("s1", EMBER)).toBeTruthy();
    expect(attemptRow("s1", "ex-c1")).toBeUndefined();
  });
});

describe("Exchange class gates and refusals (§8.1 #12)", () => {
  it("a forged Keystone exchange is refused and the Keystone stays held — no path exists", () => {
    expect(store().claimFind("s1", "witness-without-a-name", "deep-past").ok).toBe(true);
    const out = xchg().exchange("s1", { relicId: "witness-without-a-name", option: "lore", attemptKey: "ex-k1" }, STATION);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe("class");
      expect(out.reason).toMatch(/keystone/i);
    }
    expect(holdingOf("s1", "witness-without-a-name")).toBeTruthy();
    expect(attemptRow("s1", "ex-k1")).toBeUndefined();
  });

  it("unclassed relics refuse too; unheld, unknown, and malformed exchanges refuse cleanly", () => {
    expect(store().claimFind("s1", "harbor-nail", "great-station").ok).toBe(true);
    const unclassed = xchg().exchange("s1", { relicId: "harbor-nail", option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-u1" }, STATION);
    expect(unclassed.ok).toBe(false);
    if (!unclassed.ok) expect(unclassed.kind).toBe("class");
    expect(holdingOf("s1", "harbor-nail")).toBeTruthy();

    const unheld = xchg().exchange("s1", { relicId: EMBER, option: "lore", attemptKey: "ex-u2" }, STATION);
    expect(unheld.ok).toBe(false);
    if (!unheld.ok) expect(unheld.kind).toBe("not-held");

    const unknown = xchg().exchange("s1", { relicId: "no-such-relic", option: "lore", attemptKey: "ex-u3" }, STATION);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.kind).toBe("unknown");

    const malformed = xchg().exchange("s1", { relicId: EMBER, option: "lore", attemptKey: "" }, STATION);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.kind).toBe("malformed");
  });

  it("the genuine Legacy: an exchanged Unnumbered Fragment's copy waits honestly in the return pool (no anchors exist for it)", () => {
    handle.sqlite.prepare(
      `INSERT INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES ('s1', 'unnumbered-fragment', '2026-10-30T00:00:00.000Z', 0, 0, NULL, '')`,
    ).run();
    store().backfillCopies();
    const copyId = holdingOf("s1", "unnumbered-fragment")!.copy_id;
    expect(copyId).toBeTruthy();
    const out = xchg().exchange("s1", { relicId: "unnumbered-fragment", option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-f1" }, STATION);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.returnState).toBe("return-pool");
      expect(out.returnAnchor).toBeNull();
    }
    expect(copyRow(copyId).state).toBe("return-pool");
    expect(holdingOf("s1", "unnumbered-fragment")).toBeUndefined();
    const returned = eventsOf(copyId).find((e) => e.kind === "returned")!;
    expect(JSON.parse(returned.detail ?? "{}")).toMatchObject({ reason: "exchange", toAnchor: null });
  });
});

describe("Exchange atomicity — a failure injected mid-exchange leaves the untouched holding (§8.1 #13)", () => {
  it("when the receipt write itself fails, every earlier part rolls back (chart)", () => {
    const copyId = giveEmber("s1");
    handle.sqlite.exec(`CREATE TRIGGER i6_fail_receipt BEFORE INSERT ON relic_exchange_attempts BEGIN SELECT RAISE(ABORT, 'i6 injected'); END`);
    expect(() => xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-a1" }, STATION)).toThrow();
    handle.sqlite.exec(`DROP TRIGGER i6_fail_receipt`);
    expect(holdingOf("s1", EMBER)).toBeTruthy();
    expect(copyRow(copyId).state).toBe("held");
    expect(stirringsOf("s1")).toHaveLength(0);
    expect(attemptRow("s1", "ex-a1")).toBeUndefined();
    const inbox = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM inbox_notifications WHERE space_id = 's1'`).get() as { n: number };
    expect(inbox.n).toBe(0);
    // And the same key, retried clean, lands the whole outcome.
    expect(xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-a1" }, STATION).ok).toBe(true);
  });

  it("when the grant itself fails mid-transaction, the consumption rolls back with it (chart stirring write)", () => {
    const copyId = giveEmber("s1");
    handle.sqlite.exec(`CREATE TRIGGER i6_fail_stirring BEFORE INSERT ON relic_stirrings BEGIN SELECT RAISE(ABORT, 'i6 injected'); END`);
    expect(() => xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-a2" }, STATION)).toThrow();
    handle.sqlite.exec(`DROP TRIGGER i6_fail_stirring`);
    expect(holdingOf("s1", EMBER)).toBeTruthy();
    expect(copyRow(copyId).state).toBe("held");
    expect(eventsOf(copyId).map((e) => e.kind)).not.toContain("exchanged");
    expect(attemptRow("s1", "ex-a2")).toBeUndefined();
  });

  it("a lore grant under a failing receipt write leaves no L3 rows behind", () => {
    giveEmber("s1");
    const thread: RelicThreadDef = { threadId: "fixture-atomic-lore", relicA: EMBER, relicB: "thread-of-many", condition: "discovery", text: "Fixture words.", approved: true };
    withThread(thread, () => {
      handle.sqlite.exec(`CREATE TRIGGER i6_fail_receipt2 BEFORE INSERT ON relic_exchange_attempts BEGIN SELECT RAISE(ABORT, 'i6 injected'); END`);
      expect(() => xchg().exchange("s1", { relicId: EMBER, option: "lore", attemptKey: "ex-a3" }, STATION)).toThrow();
      handle.sqlite.exec(`DROP TRIGGER i6_fail_receipt2`);
    });
    expect(holdingOf("s1", EMBER)).toBeTruthy();
    const layers = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_codex_layers WHERE space_id = 's1' AND thread_id = 'fixture-atomic-lore'`).get() as { n: number };
    expect(layers.n).toBe(0);
    expect(attemptRow("s1", "ex-a3")).toBeUndefined();
  });
});

describe("Station gating — the exchange service and store/carry state (O-R7, ruling 5)", () => {
  it("an exchange away from the Great Station is refused and mutates nothing", () => {
    const copyId = giveEmber("s1");
    const out = xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-s1" }, "people");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe("not-at-station");
      expect(out.reason).toMatch(/Great Station/);
    }
    expect(holdingOf("s1", EMBER)).toBeTruthy();
    expect(copyRow(copyId).state).toBe("held");
    expect(attemptRow("s1", "ex-s1")).toBeUndefined();
    expect(stirringsOf("s1")).toHaveLength(0);
  });

  it("store/carry flips the holding's location state, and location never gates buffs", () => {
    giveEmber("s1");
    expect(store().hold("s1", EMBER).ok).toBe(true);
    const buffsBefore = store().state("s1").buffs;
    const stored = store().setLocation("s1", EMBER, "station");
    expect(stored.ok).toBe(true);
    expect(holdingOf("s1", EMBER)!.location).toBe("station");
    expect(store().state("s1").holdings.find((h) => h.relicId === EMBER)?.location).toBe("station");
    expect(store().state("s1").buffs).toEqual(buffsBefore);
    expect(store().setLocation("s1", EMBER, "station").ok).toBe(true); // already there — a clean no-op
    expect(store().setLocation("s1", EMBER, "carried").ok).toBe(true);
    expect(holdingOf("s1", EMBER)!.location).toBe("carried");
    expect(store().setLocation("s1", "dawn-leaf", "station").ok).toBe(false); // not found
    expect(store().setLocation("s1", "no-such-relic", "station").ok).toBe(false); // unknown
  });

  it("gate permanence survives an exchange: completing the set, then exchanging a member, never re-closes the gate", () => {
    expect(store().claimFind("s1", "witness-without-a-name", "deep-past").ok).toBe(true);
    expect(store().claimFind("s1", "harbor-nail", "great-station").ok).toBe(true);
    giveEmber("s1");
    expect(store().gateView("s1").open).toBe(true);
    expect(xchg().exchange("s1", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "ex-g1" }, STATION).ok).toBe(true);
    // The found set no longer completes B-01 — the permanence record carries it.
    expect(store().foundIds("s1")).not.toContain(EMBER);
    expect(store().gateView("s1").open).toBe(true);
    const travel = new TravelRepo(handle, "s1", () => store().gateHoldings("s1"));
    expect(travel.eternityGateOpened()).toBe(true);
  });

  it("exchange records are space-scoped: the same attempt key in two brains is two exchanges; the census claims both new tables", () => {
    giveEmber("sA");
    giveEmber("sB");
    expect(xchg().exchange("sA", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "shared-key" }, STATION).ok).toBe(true);
    expect(xchg().exchange("sB", { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "shared-key" }, STATION).ok).toBe(true);
    expect(attemptRow("sA", "shared-key")).toBeTruthy();
    expect(attemptRow("sB", "shared-key")).toBeTruthy();
    expect(SPACE_SCOPED_TABLES).toContain("relic_seed_effects");
    expect(SPACE_SCOPED_TABLES).toContain("relic_exchange_attempts");
  });
});

describe("HTTP surface — Hold changes happen only at the Great Station (O-R7)", () => {
  let ctx: AppContext; let server: Server; let base: string;
  async function auth(tag: string): Promise<string> {
    const res = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }) });
    return ((await res.json()) as { id: string }).id;
  }
  async function call(method: string, path: string, space: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": space }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; found?: string[]; holdings?: { relicId: string; held: boolean; location?: string }[]; comet?: { relicId: string } } };
  }
  function arrive(space: string, destination: string, atIso: string): void {
    ctx.handle.sqlite.prepare(
      `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline, arrived_at) VALUES (?, ?, ?, 'drift', 'home', ?, 'arrived', 0, ?, ?, ?)`,
    ).run(`j-${space}-${destination}-${atIso}`, space, `k-${space}-${destination}-${atIso}`, destination, atIso, atIso, atIso);
  }
  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

  it("hold/store/exchange refuse away from the Station and work there; release is never gated; reads work anywhere", async () => {
    const space = await auth("relic-i6-http");
    const s = new RelicHoldingsStore(ctx.handle);
    expect(s.claimFind(space, "harbor-nail", "great-station").ok).toBe(true);
    expect(s.claimFind(space, EMBER, "people").ok).toBe(true);

    // Standing at home (no journey yet): every Hold change refuses.
    const holdRefused = await call("POST", "/api/relics/hold", space, { relicId: "harbor-nail" });
    expect(holdRefused.status).toBe(400);
    expect(holdRefused.body.error).toMatch(/Great Station/);
    const storeRefused = await call("POST", "/api/relics/store", space, { relicId: "harbor-nail" });
    expect(storeRefused.status).toBe(400);
    const exchangeRefused = await call("POST", "/api/relics/exchange", space, { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "http-ex-1" });
    expect(exchangeRefused.status).toBe(400);
    expect(exchangeRefused.body.error).toMatch(/Great Station/);
    // Nothing mutated; reads work from anywhere.
    const readAtHome = await call("GET", "/api/relics", space);
    expect(readAtHome.status).toBe(200);
    expect(readAtHome.body.holdings?.find((h) => h.relicId === "harbor-nail")?.held).toBe(false);
    expect(readAtHome.body.found).toContain(EMBER);

    // Travel to the Great Station: changes land.
    arrive(space, "great-station", "2026-10-30T10:00:00.000Z");
    expect((await call("POST", "/api/relics/hold", space, { relicId: "harbor-nail" })).status).toBe(200);
    expect((await call("POST", "/api/relics/store", space, { relicId: "harbor-nail" })).status).toBe(200);
    const atStation = await call("GET", "/api/relics", space);
    expect(atStation.body.holdings?.find((h) => h.relicId === "harbor-nail")?.location).toBe("station");
    expect((await call("POST", "/api/relics/carry", space, { relicId: "harbor-nail" })).status).toBe(200);
    const exchangeOk = await call("POST", "/api/relics/exchange", space, { relicId: EMBER, option: "chart", chartTargetRelicId: "thread-of-many", attemptKey: "http-ex-1" });
    expect(exchangeOk.status).toBe(200);
    expect(exchangeOk.body.ok).toBe(true);

    // Travel onward: Hold changes refuse again — but release never did.
    arrive(space, "people", "2026-10-30T11:00:00.000Z");
    const unholdRefused = await call("POST", "/api/relics/unhold", space, { relicId: "harbor-nail" });
    expect(unholdRefused.status).toBe(400);
    expect(unholdRefused.body.error).toMatch(/Great Station/);
    const released = await call("POST", "/api/relics/release", space, { relicId: "harbor-nail" });
    expect(released.status).toBe(200);
    expect(released.body.comet?.relicId).toBe("harbor-nail");
  });
});
