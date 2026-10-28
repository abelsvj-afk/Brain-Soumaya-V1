import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { ingestPaste, confirmPaystub } from "../finance/ingest.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinPaystubRepo } from "../repositories/finPaystub.repo.js";
import { FinSourceRepo } from "../repositories/finSource.repo.js";

/**
 * Batch P (Details / Help / Settings) — server-side regressions:
 *  REG-009: the paystub duplicate set-scan must query by (date, net)
 *           directly — no history size may hide a matching income/stub.
 *  REG-010: a retained paste source truncated at 20,000 chars is marked
 *           as truncated (record + ingest response).
 */

describe("REG-009 — paystub duplicate check survives >200 incomes", () => {
  let handle: DbHandle;
  beforeEach(() => { handle = createDb(":memory:"); });
  afterEach(() => { handle.sqlite.close(); });

  const stubInput = (over: Partial<Parameters<typeof confirmPaystub>[2]> = {}) => ({
    employer: "Acme",
    payDate: "2026-01-15",
    netCents: 100_000,
    earnings: [],
    deductions: [],
    ...over,
  });

  it("a re-upload finds its match even with 250 newer incomes in the way", () => {
    const incomes = new FinIncomeRepo(handle, "s1");
    // 250 incomes dated AFTER the stub's pay date — on the old list()
    // (LIMIT 200, newest first) the matching income fell off the page and
    // the re-upload double-counted.
    for (let i = 0; i < 250; i++) {
      const d = new Date(Date.UTC(2026, 1, 1 + i));
      incomes.create({ date: d.toISOString().slice(0, 10), netCents: 1000 + i });
    }
    expect(incomes.list()).toHaveLength(200); // the old page really is capped

    const first = confirmPaystub(handle, "s1", stubInput());
    expect(first.duplicate).toBe(false);
    expect(new FinIncomeRepo(handle, "s1").listBetween("2026-01-01", "2026-12-31")).toHaveLength(251);

    const again = confirmPaystub(handle, "s1", stubInput());
    expect(again.duplicate).toBe(true);
    expect(again.paystub.id).toBe(first.paystub.id);
    // Still exactly one income for this stub — no double-count.
    expect(new FinIncomeRepo(handle, "s1").listBetween("2026-01-01", "2026-12-31")).toHaveLength(251);
    expect(new FinPaystubRepo(handle, "s1").list()).toHaveLength(1);
  });

  it("a re-upload finds its stub even with 201 newer stubs in the way", () => {
    const stubs = new FinPaystubRepo(handle, "s1");
    for (let i = 0; i < 201; i++) {
      const d = new Date(Date.UTC(2026, 2, 1 + i));
      stubs.create({ payDate: d.toISOString().slice(0, 10), netCents: 5000 + i, earnings: [], deductions: [] });
    }
    expect(stubs.list()).toHaveLength(200); // the old page really is capped

    const first = confirmPaystub(handle, "s1", stubInput());
    expect(first.duplicate).toBe(false);

    const again = confirmPaystub(handle, "s1", stubInput());
    expect(again.duplicate).toBe(true);
    expect(again.paystub.id).toBe(first.paystub.id);
    // Only the 201 seeded stubs + this one exist — no unlinked copy was made.
    const all = new FinPaystubRepo(handle, "s1");
    expect(all.list(1000)).toHaveLength(202);
  });
});

describe("REG-010 — a truncated retained source is marked as truncated", () => {
  let handle: DbHandle;
  beforeEach(() => { handle = createDb(":memory:"); });
  afterEach(() => { handle.sqlite.close(); });

  it("a paste over 20,000 chars keeps a truncated marker + true length on the record", async () => {
    const text = "x".repeat(20_001);
    const { sourceId, sourceTruncated } = await ingestPaste(handle, "s1", text);
    expect(sourceTruncated).toBe(true);
    const stored = JSON.parse(new FinSourceRepo(handle, "s1").get(sourceId)!.extractionJson!) as {
      raw?: string; rawTruncated?: boolean; rawLength?: number;
    };
    expect(stored.raw).toHaveLength(20_000);
    expect(stored.rawTruncated).toBe(true);
    expect(stored.rawLength).toBe(20_001);
  });

  it("a short paste is marked not-truncated", async () => {
    const { sourceId, sourceTruncated } = await ingestPaste(handle, "s1", "Received $44.30 from GoPuff");
    expect(sourceTruncated).toBe(false);
    const stored = JSON.parse(new FinSourceRepo(handle, "s1").get(sourceId)!.extractionJson!) as {
      raw?: string; rawTruncated?: boolean; rawLength?: number;
    };
    expect(stored.rawTruncated).toBe(false);
    expect(stored.rawLength).toBe("Received $44.30 from GoPuff".length);
  });
});
