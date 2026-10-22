import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { runToolRouter } from "../agent/tools/router.js";
import { createPolicyNotify } from "../agent/notify/boundary.js";

/**
 * ADR-019 §3.2 (T8, tick path): the bill-risk due date must survive the
 * PRODUCTION proactive path — runToolRouter → RouterOptions.notify →
 * createPolicyNotify (the exact composition index.ts wires on the 60s
 * tick) — and persist as the outbox row's `bill_due_at`. The direct
 * tool-level path is covered by adr019Lifecycle.test.ts's T8; this proves
 * the router hop forwards the notify meta instead of dropping it (a
 * meta-less call would land as a generic row with bill_due_at NULL).
 *
 * Fixture mirrors adr019Lifecycle.test.ts's T8: balance $100 against a
 * $250 non-autopay Rent bill due 2026-01-18, with an income cadence
 * (2026-01-01 + 2026-01-10) whose horizon reaches the due date — detect()
 * fires in "short" mode carrying dueDate 2026-01-18.
 *
 * Enqueue mechanics mirror T8 too: createPolicyNotify enqueues the row
 * on BOTH the queue path and the send path (deliverNow enqueues before
 * claiming/sending), and billRisk meta carries no remindAt, so the
 * policy's staleness drop can never trigger — the row lands in the
 * outbox deterministically regardless of the boundary's wall-clock
 * decision at run time.
 */

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

// Midday UTC: the same calendar day (Sat 2026-01-10) in the space's own
// timezone (America/New_York), as in the T8 / billRisk fixtures.
const JAN10_MS = Date.parse("2026-01-10T12:00:00Z");

describe("T8: bill-risk due date survives the tool-router tick path (ADR-019 §3.2)", () => {
  it("T8 (router): runToolRouter wired with createPolicyNotify enqueues a billRisk outbox row whose bill_due_at EQUALS the occurrence due date (non-NULL)", async () => {
    const S = "s1";
    const appCtx = { handle, embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
    new FinAccountRepo(handle, S).setBalance(10000);
    const inc = new FinIncomeRepo(handle, S);
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    new FinBillRepo(handle, S).create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });

    // The exact index.ts composition: policyNotify is passed straight
    // through as the router's notify.
    const policyNotify = createPolicyNotify({ sqlite: handle.sqlite, handle, send: async () => {}, audit: () => {}, workerId: "t8-router-test" });
    const results = await runToolRouter(appCtx, S, { now: JAN10_MS, notify: policyNotify });

    expect(results.some((r) => r.summary.includes("bill-risk"))).toBe(true);
    const row = handle.sqlite
      .prepare(`SELECT bill_due_at FROM notification_outbox WHERE space_id = ? AND tool = 'billRisk'`)
      .get(S) as { bill_due_at: string | null } | undefined;
    expect(row).toBeTruthy();
    expect(row!.bill_due_at).not.toBeNull();
    expect(row!.bill_due_at).toBe("2026-01-18"); // EQUALS the occurrence's due date
  });
});
