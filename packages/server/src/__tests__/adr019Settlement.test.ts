import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbHandle } from "../db/client.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinPaystubRepo } from "../repositories/finPaystub.repo.js";
import {
  createIncomeEntry,
  createExpenseEntry,
  settleDueEntries,
} from "../finance/settlement.js";
import { getBudgetSummary } from "../finance/summary.js";
import { netWorthSeries } from "../finance/netWorthTrend.js";
import { editIncome, deleteIncome, editExpense, deleteExpense } from "../finance/mutations.js";
import { confirmPaystub, deletePaystub } from "../finance/ingest.js";

/**
 * ADR-019 §5 acceptance tests owned by the settlement core: T12 (pay-stub
 * unit), T13 (scheduled vs settled), T18 (settlement idempotency + boundary
 * edits), plus the §8 migration contract. Marker state is inspected via
 * SQL where the ADR names the marker.
 */

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const markerOf = (table: "fin_income" | "fin_expense", id: number): string | null =>
  (handle.sqlite.prepare(`SELECT balance_applied_at FROM ${table} WHERE id = ?`).get(id) as { balance_applied_at: string | null }).balance_applied_at;

const balanceOf = (spaceId: string): number => new FinAccountRepo(handle, spaceId).getOrCreate().balanceCents;

/** ISO dates safely past/future relative to the REAL today (mutations and
 *  confirmPaystub use the wall clock, so fixed 2026-01 dates would age). */
const daysFromNow = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("T13: scheduled vs settled entries (D10, I9)", () => {
  it("T13: future-dated income is scheduled (marker NULL, no balance effect) and settles exactly once when its date arrives", () => {
    const jan10 = new Date("2026-01-10T12:00:00Z"); // midday UTC = Jan 10 in America/New_York too
    const inc = createIncomeEntry(handle, "s1", { date: "2026-01-17", netCents: 5000 }, jan10);
    const exp = createExpenseEntry(handle, "s1", { date: "2026-01-17", amountCents: 2000, category: "food" }, jan10);

    expect(inc.balanceAppliedAt).toBeNull();
    expect(markerOf("fin_income", inc.id)).toBeNull();
    expect(markerOf("fin_expense", exp.id)).toBeNull();
    expect(balanceOf("s1")).toBe(0);

    const before = getBudgetSummary(handle, "s1", jan10);
    expect(before.balanceCents).toBe(0);
    expect(before.safeToSpendCents).toBe(0);

    // The date arrives: the first evaluation settles both, exactly once.
    const onDay = getBudgetSummary(handle, "s1", new Date("2026-01-17T12:00:00Z"));
    expect(onDay.balanceCents).toBe(3000); // +5000 income − 2000 expense
    expect(markerOf("fin_income", inc.id)).not.toBeNull();
    expect(markerOf("fin_expense", exp.id)).not.toBeNull();
    // The marker records the evaluation moment, never the entry's date.
    expect(markerOf("fin_income", inc.id)).not.toBe("2026-01-17");

    // Re-running the summary (and the sweep directly) does not re-apply.
    const after = getBudgetSummary(handle, "s1", new Date("2026-01-18T12:00:00Z"));
    expect(after.balanceCents).toBe(3000);
    expect(settleDueEntries(handle, "s1", new Date("2026-01-18T12:00:00Z"))).toBe(0);
    expect(balanceOf("s1")).toBe(3000);
  });

  it("T13: an entry dated today or earlier settles at write (marker set, balance adjusted in the same operation)", () => {
    const jan10 = new Date("2026-01-10T12:00:00Z");
    const inc = createIncomeEntry(handle, "s1", { date: "2026-01-10", netCents: 4200 }, jan10);
    const past = createExpenseEntry(handle, "s1", { date: "2026-01-09", amountCents: 1200, category: "food" }, jan10);
    expect(inc.balanceAppliedAt).not.toBeNull();
    expect(past.balanceAppliedAt).not.toBeNull();
    expect(balanceOf("s1")).toBe(3000);
  });

  it("T13: the net-worth trend (a balance reader without the summary) sweeps before reading the balance", () => {
    const jan10 = new Date("2026-01-10T12:00:00Z");
    createIncomeEntry(handle, "s1", { date: "2026-01-12", netCents: 7000 }, jan10);
    const series = netWorthSeries(handle, "s1", 1, new Date("2026-01-12T12:00:00Z"));
    expect(series).toHaveLength(1);
    expect(series[0]!.totalCents).toBe(7000); // settled by the sweep at the head of netWorthSeries
    expect(balanceOf("s1")).toBe(7000);
  });
});

describe("T18: settlement idempotency across retries and boundary edits (D10, I9)", () => {
  it("T18: running the settlement sweep twice and concurrently settles exactly once", async () => {
    const jan10 = new Date("2026-01-10T12:00:00Z");
    const inc = createIncomeEntry(handle, "s1", { date: "2026-01-12", netCents: 7000 }, jan10);
    createExpenseEntry(handle, "s1", { date: "2026-01-12", amountCents: 1000, category: "food" }, jan10);

    expect(settleDueEntries(handle, "s1", new Date("2026-01-11T12:00:00Z"))).toBe(0); // not yet due
    expect(balanceOf("s1")).toBe(0);

    const jan12 = new Date("2026-01-12T12:00:00Z");
    // "Concurrent" callers: both sweeps race the same due entries.
    const counts = await Promise.all([
      Promise.resolve(settleDueEntries(handle, "s1", jan12)),
      Promise.resolve(settleDueEntries(handle, "s1", jan12)),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2); // one income + one expense, settled once each
    expect(balanceOf("s1")).toBe(6000);
    expect(markerOf("fin_income", inc.id)).not.toBeNull();

    expect(settleDueEntries(handle, "s1", jan12)).toBe(0); // retry is a no-op
    expect(balanceOf("s1")).toBe(6000);
  });

  it("T18: fault injected between the marker claim and the balance adjustment rolls back (marker NULL, balance unchanged); retry settles exactly once", () => {
    const jan10 = new Date("2026-01-10T12:00:00Z");
    const inc = createIncomeEntry(handle, "s1", { date: "2026-01-12", netCents: 7000 }, jan10);

    const spy = vi.spyOn(FinAccountRepo.prototype, "adjustBalance").mockImplementation(() => {
      throw new Error("injected fault after claim");
    });
    expect(() => settleDueEntries(handle, "s1", new Date("2026-01-12T12:00:00Z"))).toThrow("injected fault");
    spy.mockRestore();

    expect(markerOf("fin_income", inc.id)).toBeNull(); // claim rolled back with the adjustment
    expect(balanceOf("s1")).toBe(0);

    expect(settleDueEntries(handle, "s1", new Date("2026-01-12T12:00:00Z"))).toBe(1);
    expect(balanceOf("s1")).toBe(7000);
    expect(markerOf("fin_income", inc.id)).not.toBeNull();
  });

  it("T18: editing a scheduled entry's amount moves no money; editing its date into the past settles it inside the edit (exactly one adjustment)", () => {
    const future = daysFromNow(30);
    const past = daysFromNow(-30);
    const inc = createIncomeEntry(handle, "s1", { date: future, netCents: 4000 });
    expect(balanceOf("s1")).toBe(0);

    const afterAmountEdit = editIncome(handle, "s1", inc.id, { netCents: 6000 })!;
    expect(afterAmountEdit.balanceCents).toBe(0); // still scheduled — no balance change
    expect(new FinIncomeRepo(handle, "s1").get(inc.id)!.netCents).toBe(6000);
    expect(markerOf("fin_income", inc.id)).toBeNull();

    const afterDateEdit = editIncome(handle, "s1", inc.id, { date: past })!;
    expect(afterDateEdit.balanceCents).toBe(6000); // FULL new amount, exactly once (not 4000 + 6000)
    expect(markerOf("fin_income", inc.id)).not.toBeNull();
    expect(balanceOf("s1")).toBe(6000);
  });

  it("T18: editing a settled entry's date into the future reverses the adjustment and clears the marker; it settles exactly once more when the new date arrives", () => {
    const future = daysFromNow(30);
    const inc = createIncomeEntry(handle, "s1", { date: daysFromNow(-1), netCents: 6000 });
    expect(balanceOf("s1")).toBe(6000);

    const after = editIncome(handle, "s1", inc.id, { date: future })!;
    expect(after.balanceCents).toBe(0); // un-settled
    expect(markerOf("fin_income", inc.id)).toBeNull();

    const dayAfter = new Date(Date.now() + 31 * 86_400_000);
    expect(settleDueEntries(handle, "s1", dayAfter)).toBe(1);
    expect(balanceOf("s1")).toBe(6000);
    expect(settleDueEntries(handle, "s1", dayAfter)).toBe(0);
    expect(balanceOf("s1")).toBe(6000);
  });

  it("T18: deleting a scheduled entry changes no balance; deleting a settled entry reverses exactly once", () => {
    const settledInc = createIncomeEntry(handle, "s1", { date: daysFromNow(-1), netCents: 2500 });
    expect(balanceOf("s1")).toBe(2500);
    const scheduledExp = createExpenseEntry(handle, "s1", { date: daysFromNow(30), amountCents: 1500, category: "food" });
    expect(balanceOf("s1")).toBe(2500);

    const afterScheduledDelete = deleteExpense(handle, "s1", scheduledExp.id)!;
    expect(afterScheduledDelete.balanceCents).toBe(2500); // nothing to reverse
    expect(new FinExpenseRepo(handle, "s1").get(scheduledExp.id)).toBeNull();

    const afterSettledDelete = deleteIncome(handle, "s1", settledInc.id)!;
    expect(afterSettledDelete.balanceCents).toBe(0); // exactly one reversal
    expect(balanceOf("s1")).toBe(0);
  });

  it("T18: editing a settled expense's amount applies only the signed delta", () => {
    const exp = createExpenseEntry(handle, "s1", { date: daysFromNow(-1), amountCents: 2000, category: "food" });
    expect(balanceOf("s1")).toBe(-2000);
    const after = editExpense(handle, "s1", exp.id, { amountCents: 3000 })!;
    expect(after.balanceCents).toBe(-3000); // delta −1000 only, not a second full application
    expect(markerOf("fin_expense", exp.id)).not.toBeNull();
  });
});

describe("T12: pay-stub deletion is a defined relationship (D9)", () => {
  const stubInput = (over: Partial<Parameters<typeof confirmPaystub>[2]> = {}) => ({
    employer: "Acme",
    payDate: "2026-01-15",
    netCents: 100_000,
    earnings: [],
    deductions: [],
    ...over,
  });

  it("T12: deleting a pay stub removes the stub, its linked income, and reverses its balance adjustment in one operation", () => {
    const out = confirmPaystub(handle, "s1", stubInput());
    expect(out.duplicate).toBe(false);
    expect(out.budget.balanceCents).toBe(100_000);
    expect(new FinIncomeRepo(handle, "s1").list()).toHaveLength(1);
    expect(out.paystub.incomeId).toBe(new FinIncomeRepo(handle, "s1").list()[0]!.id);

    expect(deletePaystub(handle, "s1", out.paystub.id)).toBe(true);
    expect(new FinPaystubRepo(handle, "s1").list()).toHaveLength(0);
    expect(new FinIncomeRepo(handle, "s1").list()).toHaveLength(0);
    expect(balanceOf("s1")).toBe(0);
    expect(deletePaystub(handle, "s1", out.paystub.id)).toBe(false); // already gone
  });

  it("T12: re-uploading and confirming the same stub counts the income exactly once (duplicate flagged)", () => {
    const first = confirmPaystub(handle, "s1", stubInput());
    expect(first.duplicate).toBe(false);

    const again = confirmPaystub(handle, "s1", stubInput());
    expect(again.duplicate).toBe(true);
    expect(new FinIncomeRepo(handle, "s1").list()).toHaveLength(1); // counted once
    expect(balanceOf("s1")).toBe(100_000); // applied once
    // The pre-existing income was not re-linked to a second stub.
    expect(again.paystub.incomeId).toBe(first.paystub.incomeId);
    expect(new FinPaystubRepo(handle, "s1").list()).toHaveLength(1);
  });

  it("T12: deleting a stub whose linked income is still scheduled reverses nothing (marker NULL — nothing was applied)", () => {
    const out = confirmPaystub(handle, "s1", stubInput({ payDate: daysFromNow(30), netCents: 5000 }));
    expect(balanceOf("s1")).toBe(0);
    expect(markerOf("fin_income", out.paystub.incomeId!)).toBeNull();

    expect(deletePaystub(handle, "s1", out.paystub.id)).toBe(true);
    expect(new FinIncomeRepo(handle, "s1").list()).toHaveLength(0);
    expect(balanceOf("s1")).toBe(0);
  });

  it("T12: if the linked income was already deleted independently, stub deletion proceeds with no invented reversal", () => {
    const out = confirmPaystub(handle, "s1", stubInput());
    expect(balanceOf("s1")).toBe(100_000);
    deleteIncome(handle, "s1", out.paystub.incomeId!); // reverses the balance there
    expect(balanceOf("s1")).toBe(0);

    expect(deletePaystub(handle, "s1", out.paystub.id)).toBe(true);
    expect(new FinPaystubRepo(handle, "s1").list()).toHaveLength(0);
    expect(balanceOf("s1")).toBe(0); // NOT −100000: no second reversal
  });
});

describe("ADR-019 §3.5 regression: paystub re-confirm duplicate identity (B1–B5)", () => {
  // Mirrors the adversarial driver's stubBase (VERDICTS.md ATTACK B):
  // same date+net+employer+period is the ADR identity; peripheral parse
  // fields (filename, gross, hours, earnings lines, …) are NOT.
  const stubBase = (over: Partial<Parameters<typeof confirmPaystub>[2]> = {}) => ({
    employer: "Acme Corp",
    payDate: daysFromNow(-5),
    periodStart: daysFromNow(-19),
    periodEnd: daysFromNow(-6),
    grossCents: 130_000,
    netCents: 100_000,
    hours: 40,
    hourlyRateCents: 3250,
    earnings: [{ label: "Regular", amountCents: 130_000 }],
    deductions: [{ label: "Federal Tax", amountCents: 30_000 }],
    ytdGrossCents: 1_300_000,
    ytdNetCents: 1_000_000,
    sourceFilename: "stub.pdf",
    sourceMime: "application/pdf",
    ...over,
  });
  const incomeCount = () => new FinIncomeRepo(handle, "s1").list().length;
  const stubCount = () => new FinPaystubRepo(handle, "s1").list().length;

  it("B1: exact re-upload returns the same stub, duplicate:true, still 1 income, balance unchanged", () => {
    const first = confirmPaystub(handle, "s1", stubBase());
    expect(first.duplicate).toBe(false);
    const again = confirmPaystub(handle, "s1", stubBase());
    expect(again.duplicate).toBe(true);
    expect(again.paystub.id).toBe(first.paystub.id);
    expect(incomeCount()).toBe(1);
    expect(stubCount()).toBe(1);
    expect(balanceOf("s1")).toBe(100_000);
  });

  it("B2: filename differs → duplicate:true, still 1 income, balance unchanged", () => {
    const first = confirmPaystub(handle, "s1", stubBase());
    const again = confirmPaystub(handle, "s1", stubBase({ sourceFilename: "stub (1).pdf" }));
    expect(again.duplicate).toBe(true);
    expect(again.paystub.id).toBe(first.paystub.id);
    expect(incomeCount()).toBe(1);
    expect(stubCount()).toBe(1);
    expect(balanceOf("s1")).toBe(100_000);
  });

  it("B2: gross differs (OCR variance) → duplicate:true, still 1 income, balance unchanged", () => {
    const first = confirmPaystub(handle, "s1", stubBase());
    const again = confirmPaystub(handle, "s1", stubBase({ grossCents: 130_100 }));
    expect(again.duplicate).toBe(true);
    expect(again.paystub.id).toBe(first.paystub.id);
    expect(incomeCount()).toBe(1);
    expect(stubCount()).toBe(1);
    expect(balanceOf("s1")).toBe(100_000);
  });

  it("B2: earnings-line order differs → duplicate:true, still 1 income, balance unchanged", () => {
    const twoLines = [
      { label: "Regular", amountCents: 100_000 },
      { label: "Overtime", amountCents: 30_000 },
    ];
    const first = confirmPaystub(handle, "s1", stubBase({ earnings: twoLines }));
    const again = confirmPaystub(handle, "s1", stubBase({ earnings: [twoLines[1]!, twoLines[0]!] }));
    expect(again.duplicate).toBe(true);
    expect(again.paystub.id).toBe(first.paystub.id);
    expect(incomeCount()).toBe(1);
    expect(stubCount()).toBe(1);
    expect(balanceOf("s1")).toBe(100_000);
  });

  it("B2: hours null-vs-value → duplicate:true, still 1 income, balance unchanged", () => {
    const first = confirmPaystub(handle, "s1", stubBase());
    const again = confirmPaystub(handle, "s1", stubBase({ hours: null }));
    expect(again.duplicate).toBe(true);
    expect(again.paystub.id).toBe(first.paystub.id);
    expect(incomeCount()).toBe(1);
    expect(stubCount()).toBe(1);
    expect(balanceOf("s1")).toBe(100_000);
  });

  it("B3: distinct employers, same date+net → both confirm, 2 incomes", () => {
    const a = confirmPaystub(handle, "s1", stubBase());
    const b = confirmPaystub(handle, "s1", stubBase({ employer: "Other LLC" }));
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.paystub.id).not.toBe(a.paystub.id);
    expect(b.paystub.incomeId).not.toBeNull();
    expect(incomeCount()).toBe(2);
    expect(stubCount()).toBe(2);
    expect(balanceOf("s1")).toBe(200_000);
  });

  it("B3b: distinct stub, SAME employer, different period, same date+net → creates its income (period discriminates)", () => {
    const a = confirmPaystub(handle, "s1", stubBase());
    const b = confirmPaystub(
      handle,
      "s1",
      stubBase({ periodStart: daysFromNow(-33), periodEnd: daysFromNow(-20) }),
    );
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.paystub.id).not.toBe(a.paystub.id);
    expect(b.paystub.incomeId).not.toBeNull();
    expect(incomeCount()).toBe(2);
    expect(stubCount()).toBe(2);
    expect(balanceOf("s1")).toBe(200_000);
  });

  it("B4: manual income first → stub saved UNLINKED, no second income, balance unchanged", () => {
    const date = daysFromNow(-5);
    createIncomeEntry(handle, "s1", { date, netCents: 100_000, platform: "Manual" });
    expect(balanceOf("s1")).toBe(100_000);
    const out = confirmPaystub(handle, "s1", stubBase({ payDate: date }));
    expect(out.duplicate).toBe(true);
    expect(out.paystub.incomeId).toBeNull();
    expect(incomeCount()).toBe(1);
    expect(stubCount()).toBe(1);
    expect(balanceOf("s1")).toBe(100_000);
  });

  // B5: the (date, net) set holds BOTH a manual and a stub-owned income;
  // a distinct third stub (different employer) must create its income
  // regardless of which row was inserted first (the old code keyed the
  // branch off findDuplicate's arbitrary LIMIT 1 pick). The stub-owned
  // row is constructed directly, as in the adversarial driver, because
  // confirmPaystub's own B4 branch will not create it after a manual row.
  const seedManualAndStubOwned = (order: "manual-first" | "stub-first") => {
    const date = daysFromNow(-5);
    const makeManual = () => createIncomeEntry(handle, "s1", { date, netCents: 100_000, platform: "Manual" });
    const makeOwned = () => {
      const owned = createIncomeEntry(handle, "s1", { date, netCents: 100_000, platform: "Acme Corp" });
      new FinPaystubRepo(handle, "s1").create({ ...stubBase({ payDate: date }), incomeId: owned.id });
      return owned;
    };
    if (order === "manual-first") {
      makeManual();
      makeOwned();
    } else {
      makeOwned();
      makeManual();
    }
    return date;
  };

  it("B5 (manual-first): distinct third stub creates its income", () => {
    const date = seedManualAndStubOwned("manual-first");
    expect(incomeCount()).toBe(2);
    expect(balanceOf("s1")).toBe(200_000);
    const third = confirmPaystub(handle, "s1", stubBase({ payDate: date, employer: "Employer-B" }));
    expect(third.duplicate).toBe(true);
    expect(third.paystub.incomeId).not.toBeNull();
    expect(incomeCount()).toBe(3);
    expect(balanceOf("s1")).toBe(300_000);
  });

  it("B5 (stub-first): distinct third stub creates its income", () => {
    const date = seedManualAndStubOwned("stub-first");
    expect(incomeCount()).toBe(2);
    expect(balanceOf("s1")).toBe(200_000);
    const third = confirmPaystub(handle, "s1", stubBase({ payDate: date, employer: "Employer-B" }));
    expect(third.duplicate).toBe(true);
    expect(third.paystub.incomeId).not.toBeNull();
    expect(incomeCount()).toBe(3);
    expect(balanceOf("s1")).toBe(300_000);
  });
});

describe("ADR-019 §8 migration: balance_applied_at (migrateSchema-only, legacy backfill)", () => {
  const dirs: string[] = [];
  const fileHandles: DbHandle[] = [];
  afterEach(() => {
    while (fileHandles.length) fileHandles.pop()?.sqlite.close();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("fresh createDb has the marker column on both tables", () => {
    for (const table of ["fin_income", "fin_expense"]) {
      const cols = handle.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      expect(cols.some((c) => c.name === "balance_applied_at"), table).toBe(true);
    }
  });

  it("legacy volume (baseline shape, no marker column) gains the column with marker = created_at, and reopening never stomps a live marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "brain-adr019-"));
    dirs.push(dir);
    const path = join(dir, "legacy.db");

    // Baseline CREATEs copied from `git show a9ed7c8:packages/server/src/db/schemaSql.ts`.
    const old = new BetterSqlite3(path);
    old.exec(`
      CREATE TABLE IF NOT EXISTS fin_income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL DEFAULT 'legacy',
        source_id INTEGER,
        date TEXT NOT NULL,
        gross_cents INTEGER,
        net_cents INTEGER NOT NULL DEFAULT 0,
        tax_cents INTEGER,
        hours REAL,
        platform TEXT,
        confidence REAL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS fin_expense (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL DEFAULT 'legacy',
        source_id INTEGER,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        merchant TEXT,
        category TEXT NOT NULL DEFAULT 'misc',
        direction TEXT NOT NULL DEFAULT 'out',
        confidence REAL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO fin_income (date, net_cents, created_at) VALUES ('2026-01-05', 12345, '2026-01-05T01:02:03.000Z');
      INSERT INTO fin_expense (date, amount_cents, created_at) VALUES ('2026-01-06', 2345, '2026-01-06T04:05:06.000Z');
    `);
    old.close();

    const h1 = createDb(path);
    fileHandles.push(h1);
    for (const table of ["fin_income", "fin_expense"]) {
      const cols = h1.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      expect(cols.some((c) => c.name === "balance_applied_at"), table).toBe(true);
    }
    const incRow = h1.sqlite.prepare(`SELECT balance_applied_at FROM fin_income WHERE id = 1`).get() as { balance_applied_at: string };
    const expRow = h1.sqlite.prepare(`SELECT balance_applied_at FROM fin_expense WHERE id = 1`).get() as { balance_applied_at: string };
    expect(incRow.balance_applied_at).toBe("2026-01-05T01:02:03.000Z"); // = its created_at (truthful: legacy rows were applied)
    expect(expRow.balance_applied_at).toBe("2026-01-06T04:05:06.000Z");

    // Change a live marker, reopen: the backfill runs only in the
    // first-add step, so the new value must survive untouched.
    h1.sqlite.prepare(`UPDATE fin_income SET balance_applied_at = '1999-12-31T00:00:00.000Z' WHERE id = 1`).run();
    h1.sqlite.close();
    fileHandles.pop();

    const h2 = createDb(path);
    fileHandles.push(h2);
    const reread = h2.sqlite.prepare(`SELECT balance_applied_at FROM fin_income WHERE id = 1`).get() as { balance_applied_at: string };
    expect(reread.balance_applied_at).toBe("1999-12-31T00:00:00.000Z");
  });
});
