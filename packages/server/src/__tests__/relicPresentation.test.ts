import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicStirringService } from "../relics/stirrings.js";
import { RELIC_BY_ID, RELIC_ANCHOR_POINTS } from "@brain/shared";

/**
 * Relics I-7 — the presentation read model (implementation design
 * §5.1/§5.8; approved design §3.3 + §8.1 #12): the state view carries
 * the Codex layers, the discovery records, stirring states, and held
 * copies' provenance — and locked layer TEXT IS NEVER SERIALIZED.
 * Concealment is proven on the payload itself: an undiscovered
 * relic's description text appears nowhere in the serialized state,
 * and a discovered relic's still-locked place text is absent while
 * its unlocked description text is present.
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); });

const store = () => new RelicHoldingsStore(handle);
const NAIL = "harbor-nail";
const RING = "mooring-ring";

describe("Relics I-7 read model — layered Codex with server-side concealment (§8.1 #12)", () => {
  it("serializes only unlocked layer text: a discovered relic's description is present, its locked place text and every undiscovered text are absent", () => {
    expect(store().claimFind("s1", NAIL, "great-station").ok).toBe(true);
    const state = store().state("s1");
    const payload = JSON.stringify(state);

    const nail = state.codex?.find((c) => c.relicId === NAIL);
    expect(nail).toBeTruthy();
    // L2 (description) unlocked by the personal discovery — text ships.
    expect(nail!.layers.description.state).toBe("unlocked");
    expect(nail!.layers.description.text).toBe(RELIC_BY_ID.get(NAIL)!.lore);
    // L1 (place) still locked — its text is not serialized anywhere:
    // an anchor's placeName IS the registry place text, so every field
    // that could carry it (the layer, the first-discovery line, the
    // held copy's provenance) answers to the same L1 unlock — proven
    // whole-payload in the review round 1 regression below, in the
    // two-space configuration where a record exists to leak through.
    expect(nail!.layers.place.state).toBe("locked");
    expect(nail!.layers.place.text).toBeUndefined();
    // L0 (stirring fragment): no canon text exists — honestly unwritten.
    expect(nail!.layers.stirring.state).toBe("unwritten");
    expect(nail!.layers.stirring.text).toBeUndefined();
    // Undiscovered relics: every layer locked or unwritten, no text anywhere.
    const ring = state.codex?.find((c) => c.relicId === RING);
    expect(ring).toBeTruthy();
    expect(ring!.discovered).toBe(false);
    expect(ring!.layers.description.state).toBe("locked");
    expect(payload).not.toContain(RELIC_BY_ID.get(RING)!.lore);
    expect(payload).not.toContain(RELIC_BY_ID.get(RING)!.place);
    // L3: no threads are authored — the layer reads unwritten, with no silhouettes.
    expect(nail!.layers.threads.state).toBe("unwritten");
    expect(nail!.layers.threads.entries).toEqual([]);
  });

  it("an arrival (L1) unlock ships the place text; a stirring (L0) unlock with no authored fragment still ships no text", () => {
    expect(store().claimFind("s1", NAIL, "great-station").ok).toBe(true);
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES ('s1', ?, 'L1', '', 'arrival')`,
    ).run(NAIL);
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES ('s1', ?, 'L0', '', 'stirring')`,
    ).run(NAIL);
    const nail = store().state("s1").codex?.find((c) => c.relicId === NAIL);
    expect(nail!.layers.place.state).toBe("unlocked");
    expect(nail!.layers.place.text).toBe(RELIC_BY_ID.get(NAIL)!.place);
    expect(nail!.layers.stirring.state).toBe("unwritten");
    expect(nail!.layers.stirring.text).toBeUndefined();
  });

  it("the three discovery records are distinct: first-in-world names the discoverer, personal discovery is the viewer's own, provenance is the held copy's chain", () => {
    expect(store().claimFind("s1", NAIL, "great-station").ok).toBe(true);
    const holding = handle.sqlite.prepare(
      `SELECT copy_id FROM relic_holdings WHERE space_id = 's1' AND relic_id = ?`,
    ).get(NAIL) as { copy_id: string };
    const anchor = RELIC_ANCHOR_POINTS[NAIL]![0]!.anchorKey;
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_first_discoveries (scope, relic_id, copy_id, space_id, world, anchor_key) VALUES ('public', ?, ?, 's1', 'great-station', ?)`,
    ).run(NAIL, holding.copy_id, anchor);

    const state = store().state("s1");
    const nail = state.codex?.find((c) => c.relicId === NAIL);
    expect(nail!.discovered).toBe(true);
    expect(nail!.firstDiscovery).toBeTruthy();
    expect(nail!.firstDiscovery!.byViewer).toBe(true);
    expect(nail!.firstDiscovery!.discovererName).toBe("You");
    // Another viewer reads the same world record, honestly not theirs.
    const other = store().state("s2").codex?.find((c) => c.relicId === NAIL);
    expect(other!.discovered).toBe(false);
    expect(other!.firstDiscovery!.byViewer).toBe(false);

    const hv = state.holdings.find((h) => h.relicId === NAIL)!;
    expect(hv.copyId).toBe(holding.copy_id);
    expect(hv.copyContext).toMatch(/at most 7 copies/);
    const kinds = (hv.provenance ?? []).map((e) => e.kind);
    expect(kinds[0]).toBe("genesis");
    expect(kinds).toContain("placed");
    expect(kinds).toContain("claimed");
  });

  it("stirring states ride the view in the honest vocabulary, and an exchange departure is labeled an exchange", () => {
    const stirring = new RelicStirringService(handle).issue("s1", RING, "ambient");
    expect(stirring).toBeTruthy();
    let state = store().state("s1");
    const open = state.stirrings?.find((s) => s.relicId === RING);
    expect(open?.state).toBe("open");
    expect(open?.source).toBe("ambient");

    handle.sqlite.prepare(`UPDATE relic_stirrings SET state = 'quiet', resolved_reason = 'copy-claimed' WHERE id = ?`).run(stirring!.id);
    state = store().state("s1");
    expect(state.stirrings?.find((s) => s.relicId === RING)?.state).toBe("quiet");

    // An exchange return carries reason='exchange' in its stored detail
    // (I-6) — the departure view must label it an exchange, not a release.
    expect(store().claimFind("s1", NAIL, "great-station").ok).toBe(true);
    const holding = handle.sqlite.prepare(
      `SELECT copy_id FROM relic_holdings WHERE space_id = 's1' AND relic_id = ?`,
    ).get(NAIL) as { copy_id: string };
    handle.sqlite.prepare(
      `INSERT INTO relic_copy_events (copy_id, kind, space_id, world, anchor_key, detail) VALUES (?, 'returned', 's1', 'great-station', ?, ?)`,
    ).run(holding.copy_id, RELIC_ANCHOR_POINTS[NAIL]![0]!.anchorKey, JSON.stringify({ reason: "exchange", toAnchor: RELIC_ANCHOR_POINTS[NAIL]![1]!.anchorKey }));
    const deps = store().state("s1").recentDepartures;
    expect(deps[0]?.relicId).toBe(NAIL);
    expect(deps[0]?.reason).toBe("exchange");
  });
});

describe("Relics I-7 read model — independent review round 1 regressions", () => {
  it("P1-1: a publicly first-discovered relic's place text is concealed from every viewer who has not unlocked the place layer — first-discovery line and provenance included", () => {
    expect(store().claimFind("s1", NAIL, "great-station").ok).toBe(true);
    const holding = handle.sqlite.prepare(
      `SELECT copy_id FROM relic_holdings WHERE space_id = 's1' AND relic_id = ?`,
    ).get(NAIL) as { copy_id: string };
    const anchor = RELIC_ANCHOR_POINTS[NAIL]![0]!.anchorKey;
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_first_discoveries (scope, relic_id, copy_id, space_id, world, anchor_key) VALUES ('public', ?, ?, 's1', 'great-station', ?)`,
    ).run(NAIL, holding.copy_id, anchor);
    const place = RELIC_BY_ID.get(NAIL)!.place;

    // A stranger: the first-discovery record is visible, its place is not,
    // and the place string appears nowhere in the whole payload.
    const s2 = store().state("s2");
    expect(JSON.stringify(s2)).not.toContain(place);
    expect(JSON.stringify(s2)).not.toContain(RELIC_BY_ID.get(NAIL)!.lore);
    const nail2 = s2.codex?.find((c) => c.relicId === NAIL);
    expect(nail2!.firstDiscovery).toBeTruthy();
    expect(nail2!.firstDiscovery!.byViewer).toBe(false);
    expect(nail2!.firstDiscovery!.placeName).toBeUndefined();

    // The discoverer via claimFind holds no L1 row either: their own
    // provenance must not smuggle the still-locked place string.
    const s1 = store().state("s1");
    expect(JSON.stringify(s1)).not.toContain(place);
    expect(s1.codex?.find((c) => c.relicId === NAIL)!.firstDiscovery!.placeName).toBeUndefined();

    // Once the viewer earns the arrival (L1) unlock, the place ships.
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES ('s2', ?, 'L1', '', 'arrival')`,
    ).run(NAIL);
    const nail2b = store().state("s2").codex?.find((c) => c.relicId === NAIL);
    expect(nail2b!.firstDiscovery!.placeName).toBe(place);
  });

  it("P1-2: discovery is permanent — releasing a relic keeps it discovered, its description unlocked, its words shipped", () => {
    // Subject relic: the Basin Stone since the tier rulings — the
    // Harbor Nail played this role before, but a Keystone's release
    // is refused now, so it can no longer demonstrate a release.
    const RELIC = "basin-stone";
    expect(store().claimFind("s1", RELIC, "deep-past").ok).toBe(true);
    // Production ordering: a state read settles the one-time ship
    // migration (codex_claims → holdings) before any release happens.
    store().state("s1");
    expect(store().release("s1", RELIC)).toBeTruthy();
    const state = store().state("s1");
    expect(state.holdings.find((h) => h.relicId === RELIC)).toBeUndefined();
    const entry = state.codex?.find((c) => c.relicId === RELIC);
    expect(entry!.discovered).toBe(true);
    expect(entry!.layers.description.state).toBe("unlocked");
    expect(entry!.layers.description.text).toBe(RELIC_BY_ID.get(RELIC)!.lore);
  });
});
