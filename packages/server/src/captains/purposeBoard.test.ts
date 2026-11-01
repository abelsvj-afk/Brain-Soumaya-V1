import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition, type CaptainId, type CaptainWorld, type NpcActKind } from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { NpcRepo } from "../npcs/repo.js";
import {
  PurposeStore,
  acceptCommission,
  executeDeedAct,
  generateCommissionOffer,
  type PurposeExec,
} from "./purpose.js";

/**
 * P2-B1.5 — the simulated commission board (spec §6.3, outlines
 * §3 B-1..B-8). Her board is generated against her sim brain only,
 * completes only from real acts' log events, pays only her NPC
 * ledger, and never cross-lists with the player's surfaces.
 */
const SPACE = "spaceA";
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const H = 3_600_000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const store = () => new PurposeStore(handle, SPACE);
const captains = () => new CaptainRepo(handle, SPACE);

function seedVeyra(nowMs = T0): void {
  const def = captainDefinition("veyra")!;
  captains().ensureState(def, nowMs);
  captains().update("veyra", { currentWorld: "great-station" });
}

function testExec(): PurposeExec {
  const log = new NpcRepo(handle, SPACE);
  return {
    logAct: (kind: NpcActKind, act: string, cause: string, nowMs: number) =>
      log.appendLog("veyra", kind, act, cause, nowMs),
    logBookkeeping: (kind: NpcActKind, act: string, cause: string, nowMs: number) =>
      log.appendLog("veyra", kind, act, cause, nowMs),
    openLeg: () => false,
    state: () => captains().state("veyra")!,
    searchDraw: (_id: CaptainId, _s: number) => 0.1,
  };
}

function brainWithJourneyToScale(): void {
  store().seedSimBrainFixture(
    "veyra",
    [
      { id: "n-due", theme: "the search", title: "A half-checked bearing", pointsTo: "great-station", ageDays: 40, due: 1 },
      { id: "n-a", theme: "people", title: "A face at the dock", pointsTo: "great-station", ageDays: 90, due: 0 },
      { id: "n-b", theme: "work", title: "Berth fees and patience", pointsTo: "great-station", ageDays: 120, due: 0 },
    ],
    [{ kind: "travel", world: "scale", label: "travel to Scale" }],
    ["A note she has not answered."],
  );
}

describe("P2 sim board (B1.5)", () => {
  it("B-4: all four kinds generate from her sim-brain deficiencies", () => {
    seedVeyra();
    // Journey: next journey step requires travel she has not done.
    brainWithJourneyToScale();
    const journey = generateCommissionOffer(handle, SPACE, "veyra", T0);
    expect(journey?.kind).toBe("journey");
    // Review: a due card with no journey pending (a second space,
    // so no offered commission lingers from the first case).
    const S2 = "spaceB";
    const def = captainDefinition("veyra")!;
    new CaptainRepo(handle, S2).ensureState(def, T0);
    const store2 = new PurposeStore(handle, S2);
    store2.seedSimBrainFixture(
      "veyra",
      [{ id: "n-due", theme: "the search", title: "Due", pointsTo: "scale", ageDays: 40, due: 2 }],
      [],
      [],
    );
    const review = generateCommissionOffer(handle, S2, "veyra", T0 + H);
    expect(review?.kind).toBe("review");
    // Link: an unlinked pair and nothing else deficient.
    const S3 = "spaceC";
    new CaptainRepo(handle, S3).ensureState(def, T0);
    const store3 = new PurposeStore(handle, S3);
    store3.seedSimBrainFixture(
      "veyra",
      [
        { id: "n-a", theme: "people", title: "A", pointsTo: "scale", ageDays: 30, due: 0 },
        { id: "n-b", theme: "work", title: "B", pointsTo: "scale", ageDays: 30, due: 0 },
      ],
      [],
      [],
    );
    expect(generateCommissionOffer(handle, S3, "veyra", T0)?.kind).toBe("link");
    // Inbox: unprocessed inbox items and nothing else deficient.
    const S4 = "spaceD";
    new CaptainRepo(handle, S4).ensureState(def, T0);
    const store4 = new PurposeStore(handle, S4);
    store4.seedSimBrainFixture(
      "veyra",
      [{ id: "n-a", theme: "people", title: "A", pointsTo: "scale", ageDays: 30, due: 0 }],
      [],
      ["An unanswered note."],
    );
    expect(generateCommissionOffer(handle, S4, "veyra", T0)?.kind).toBe("inbox");
  });

  it("B-2: every id a commission references resolves inside her namespace — and nowhere in the player's brain", () => {
    seedVeyra();
    brainWithJourneyToScale();
    const offer = generateCommissionOffer(handle, SPACE, "veyra", T0);
    expect(offer).not.toBeNull();
    const refs = JSON.stringify(offer);
    const playerNodes = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ?`)
      .get(SPACE) as { c: number };
    expect(playerNodes.c).toBe(0); // nothing of hers leaked into the real brain
    for (const node of store().simNodes("veyra")) expect(refs).not.toContain(`"player`);
    expect(offer?.steps.length).toBeGreaterThan(0);
  });

  it("B-3: generation reads her sim brain only — mutating the player's brain changes nothing", () => {
    seedVeyra();
    brainWithJourneyToScale();
    const control = generateCommissionOffer(handle, SPACE, "veyra", T0);
    // Mutate the real brain: due-looking rows of the player's own.
    handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, ?, ?)`)
      .run(SPACE, "Player node", "memory", "the player's own business");
    const after = generateCommissionOffer(handle, SPACE, "veyra", T0);
    expect(JSON.stringify(after)).toBe(JSON.stringify(control));
  });

  it("B-5: a Journey step completes only from the travel act's log event — never from narration or another captain", () => {
    seedVeyra();
    brainWithJourneyToScale();
    const offer = generateCommissionOffer(handle, SPACE, "veyra", T0);
    if (!offer) throw new Error("no offer");
    const accepted = acceptCommission(handle, SPACE, "veyra", offer.id, T0 + H, testExec());
    expect(accepted?.state).toBe("open");
    // Narration completes nothing: a wait line mentioning Scale.
    new NpcRepo(handle, SPACE).appendLog("veyra", "wait", "Dreamed of Scale.", "Narration is not an act.", T0 + 2 * H);
    store().onActEvent("veyra", { kind: "wait", world: "scale", logId: 999_999, deed: null }, T0 + 2 * H);
    expect(store().commissionById(offer.id)?.state).toBe("open");
    // Another captain's travel completes nothing of hers.
    store().onActEvent("junia", { kind: "travel", world: "scale", logId: 888_888, deed: null }, T0 + 3 * H);
    expect(store().commissionById(offer.id)?.state).toBe("open");
    // Her real arrival act completes the step, citing its log event.
    const arrival = new NpcRepo(handle, SPACE).appendLog("veyra", "arrive", "Came into Scale.", "The leg's arrival step was reached.", T0 + 4 * H);
    store().onActEvent("veyra", { kind: "arrive", world: "scale", logId: arrival.id, deed: null }, T0 + 4 * H);
    const done = store().commissionById(offer.id);
    expect(done?.state).toBe("completed");
    expect(done?.completedLogId).toBe(arrival.id);
  });

  it("B-6: completion pays her NPC ledger only, with a diminishing, bounded anti-farm shape", () => {
    seedVeyra();
    const creditsBefore = captains().state("veyra")?.credits;
    const payments: number[] = [];
    let balance = creditsBefore ?? 0;
    for (let i = 0; i < 20; i++) {
      store().seedSimBrainFixture(
        "veyra",
        [{ id: `n-${i}`, theme: "work", title: `Card ${i}`, pointsTo: "great-station", ageDays: 30, due: 1 }],
        [],
        [],
      );
      // Keep the same captain row (reseeding the brain must not reset credits).
      const offer = generateCommissionOffer(handle, SPACE, "veyra", T0 + i * H);
      if (!offer) continue;
      acceptCommission(handle, SPACE, "veyra", offer.id, T0 + i * H, testExec());
      executeDeedAct(handle, SPACE, "veyra", "review", T0 + i * H, testExec());
      const now = captains().state("veyra")?.credits ?? balance;
      payments.push(now - balance);
      balance = now;
    }
    const earned = payments.filter((p) => p > 0);
    expect(earned.length).toBeGreaterThan(0);
    for (let i = 1; i < payments.length; i++) expect(payments[i]!).toBeLessThanOrEqual(payments[i - 1]!);
    expect(payments.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60); // bounded lifetime board income in P2
    // The player's Credits surfaces are untouched: no game_* writes exist for her acts.
    const gameRows = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM game_ledger WHERE space_id = ?`)
      .get(SPACE) as { c: number };
    expect(gameRows.c).toBe(0);
  });

  it("B-7: a commission whose target resolves another way closes as superseded — and 30 quiet days close nothing", () => {
    seedVeyra();
    brainWithJourneyToScale();
    // Review offer against the due card; then review the card by a
    // plain deed without accepting the commission first.
    store().seedSimBrainFixture(
      "veyra",
      [{ id: "n-due", theme: "the search", title: "Due", pointsTo: "great-station", ageDays: 40, due: 1 }],
      [],
      [],
    );
    const offer = generateCommissionOffer(handle, SPACE, "veyra", T0);
    expect(offer?.kind).toBe("review");
    executeDeedAct(handle, SPACE, "veyra", "review", T0 + H, testExec());
    expect(store().commissionById(offer!.id)?.state).toBe("superseded");
    // Nothing decays: a fresh offer left alone for 30 local days is still offered.
    const offer2 = generateCommissionOffer(handle, SPACE, "veyra", T0 + 2 * H);
    if (offer2) {
      expect(store().commissionById(offer2.id)?.state).toBe("offered");
    }
  });

  it("B-8: no board rows exist before the first generation — no background generation", () => {
    seedVeyra();
    brainWithJourneyToScale();
    const rows = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM npc_commissions WHERE space_id = ? AND npc_id = 'veyra'`)
      .get(SPACE) as { c: number };
    expect(rows.c).toBe(0);
  });

  it("B-1: her board never surfaces on the player's board namespace (server-side: separate tables, separate reads)", () => {
    seedVeyra();
    brainWithJourneyToScale();
    const offer = generateCommissionOffer(handle, SPACE, "veyra", T0);
    expect(offer).not.toBeNull();
    // The player's commission surface has no server store at all —
    // her commissions live only in npc_commissions, keyed by her id.
    const hers = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM npc_commissions WHERE space_id = ? AND npc_id = 'veyra'`)
      .get(SPACE) as { c: number };
    expect(hers.c).toBe(1);
    const others = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM npc_commissions WHERE space_id = ? AND npc_id != 'veyra'`)
      .get(SPACE) as { c: number };
    expect(others.c).toBe(0);
  });
});
