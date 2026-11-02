import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition, type CaptainId, type NpcActKind } from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { NpcRepo } from "../npcs/repo.js";
import { advanceCaptain } from "./engine.js";
import { NpcEconomy } from "./npcEconomy.js";
import {
  PurposeStore,
  acceptCommission,
  executeDeedAct,
  generateCommissionOffer,
  type PurposeExec,
} from "./purpose.js";

/**
 * P3-R1 regression — a commission payment is a Credits movement,
 * so it must land in her npc_game_ledger like every other P3
 * movement. Before the fix, purpose.ts credited the payment by a
 * direct CaptainRepo.update with no ledger row: once Veyra's
 * genesis row existed (her first P3 advance), any commission she
 * completed left NpcEconomy.reconcile() reporting ok:false
 * permanently — opening.balanceAfter + Σ credits_delta no longer
 * equalled her stored balance (brief invariant 3 / E-6).
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

describe("P3-R1 — commission payments reconcile through the NPC ledger", () => {
  it("Veyra completes a commission AFTER her genesis row: reconcile stays ok and the payment is a ledger row", () => {
    const def = captainDefinition("veyra")!;
    captains().ensureState(def, T0);
    captains().update("veyra", { currentWorld: "great-station" });

    // Her first P3 advance writes the genesis `opening` row inside
    // the advance transaction (engine.ts ensureGenesis, R4).
    advanceCaptain(handle, SPACE, "veyra", T0 + H);
    const econ = new NpcEconomy(handle, SPACE, "veyra");
    const opening = econ.ledger(100).find((r) => r.kind === "opening");
    expect(opening, "genesis row written by the first advance").toBeDefined();
    expect(econ.reconcile().ok).toBe(true);

    // One commission, completed through the real completion path:
    // board offer -> accept -> the review deed act itself fires
    // onActEvent, which pays on the final step.
    store().seedSimBrainFixture(
      "veyra",
      [{ id: "n-due", theme: "the search", title: "A half-checked bearing", pointsTo: "great-station", ageDays: 40, due: 1 }],
      [],
      [],
    );
    const offer = generateCommissionOffer(handle, SPACE, "veyra", T0 + 2 * H);
    if (!offer) throw new Error("no commission offer generated");
    expect(offer.kind).toBe("review");
    const accepted = acceptCommission(handle, SPACE, "veyra", offer.id, T0 + 2 * H, testExec());
    expect(accepted?.state).toBe("open");
    executeDeedAct(handle, SPACE, "veyra", "review", T0 + 2 * H, testExec());
    const done = store().commissionById(offer.id);
    expect(done?.state).toBe("completed");
    const payment = done?.payment ?? 0;
    expect(payment).toBeGreaterThan(0);

    // The invariant, exactly as E-6 states it: her stored balance
    // equals the genesis anchor plus every ledger delta — the
    // commission payment included.
    const rows = econ.ledger(100);
    const stored = captains().state("veyra")!.credits;
    const expected = opening!.balanceAfter + rows.reduce((sum, r) => sum + r.creditsDelta, 0);
    expect(econ.reconcile().ok).toBe(true);
    expect(stored).toBe(expected);
    const commissionRows = rows.filter((r) => r.kind === "commission");
    expect(commissionRows).toHaveLength(1);
    expect(commissionRows[0]!.creditsDelta).toBe(payment);
    expect(commissionRows[0]!.stepKey).toContain(`commission:${offer.id}`);
    expect(commissionRows[0]!.balanceAfter).toBe(stored);
  });
});
