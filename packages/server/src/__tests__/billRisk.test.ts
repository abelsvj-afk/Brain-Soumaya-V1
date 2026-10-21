import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { ToolContext } from "../agent/tools/types.js";
import { billRiskTool } from "../agent/tools/billRisk.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";

/** Stage 1c — the proactive bill-risk nudge (deterministic, offline). */

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);
// Midday UTC: the same calendar day (Sat 2026-01-10) in the space's own
// timezone (America/New_York) — midnight UTC is still Jan 9 in Florida, and
// day-boundary logic follows the space's local day (owner rule 2026-10-21).
const NOW = Date.parse("2026-01-10T12:00:00Z");

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

const tc = (now = NOW): ToolContext => ({ ctx, spaceId: "s1", now, notify: async () => {} });

describe("bill_risk detect()", () => {
  it("stays quiet when the module is empty", () => {
    expect(billRiskTool.detect(tc())).toHaveLength(0);
  });

  it("stays quiet when there's a comfortable cushion", () => {
    new FinAccountRepo(handle, "s1").setBalance(500000); // plenty
    // income cadence so the horizon reaches the bill
    const inc = new FinIncomeRepo(handle, "s1");
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    new FinBillRepo(handle, "s1").create({ name: "Insurance", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    expect(billRiskTool.detect(tc())).toHaveLength(0);
  });

  it("nudges (pace mode) when the cushion is thinner than the bill", () => {
    new FinAccountRepo(handle, "s1").setBalance(35000);
    const inc = new FinIncomeRepo(handle, "s1");
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 }); // cadence ~9d → horizon ~2026-01-19
    new FinBillRepo(handle, "s1").create({ name: "Insurance", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    // reserved 25000, balance 35000 → safe 10000 ≤ bill 25000 → tight.
    const inv = billRiskTool.detect(tc());
    expect(inv).toHaveLength(1);
    expect(inv[0]!.args.mode).toBe("pace");
    expect(inv[0]!.reason).toMatch(/Insurance/);
  });

  it("nudges (short mode) when already short", () => {
    new FinAccountRepo(handle, "s1").setBalance(10000);
    const inc = new FinIncomeRepo(handle, "s1");
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    new FinBillRepo(handle, "s1").create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    const inv = billRiskTool.detect(tc());
    expect(inv[0]!.args.mode).toBe("short");
    expect(Number(inv[0]!.args.threshold)).toBe(15000); // 25000 reserved − 10000 balance
  });

  it("ignores autopay bills (assumed to clear)", () => {
    new FinAccountRepo(handle, "s1").setBalance(10000);
    const inc = new FinIncomeRepo(handle, "s1");
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    new FinBillRepo(handle, "s1").create({ name: "Netflix", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18", autopay: true });
    expect(billRiskTool.detect(tc())).toHaveLength(0);
  });

  it("fires at most once per day (respects the agent_logs guard)", async () => {
    new FinAccountRepo(handle, "s1").setBalance(10000);
    const inc = new FinIncomeRepo(handle, "s1");
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    new FinBillRepo(handle, "s1").create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    expect(billRiskTool.detect(tc())).toHaveLength(1);
    // Simulate the router having logged today's run (created_at on tc.now's day).
    handle.sqlite.prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES ('s1', 'tool:bill_risk', 'x', '[]', '2026-01-10 12:00:00')`).run();
    expect(billRiskTool.detect(tc())).toHaveLength(0);
  });

  it("run() delivers a message in Soumaya's voice", async () => {
    const bill = new FinBillRepo(handle, "s1").create({ name: "Car", amountCents: 21000, frequency: "monthly", anchorDate: "2026-01-20" });
    let sent = "";
    const res = await billRiskTool.run({ ctx, spaceId: "s1", now: NOW, notify: async (t) => void (sent = t) }, { billId: bill.id, mode: "pace", threshold: 4200 });
    expect(res.ok).toBe(true);
    expect(sent).toMatch(/Car/);
    expect(sent).toMatch(/\$42/);
    // `message` carries the SAME text `notify` received — so the in-app event bridge
    // (App.tsx) can toast it verbatim for a user with no Telegram channel linked.
    expect(res.message).toBe(sent);
  });
});
