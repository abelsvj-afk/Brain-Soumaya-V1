import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { FinPaystub, FinAsset, FinAssetSnapshot, IncomePoint, NetWorthPoint } from "@brain/shared";

/**
 * docs/specs/paystub-ingestion.md + docs/specs/income-net-worth-trend.md — the new REST
 * surface end-to-end (thin routes over the already-unit-tested repos/services). Same
 * real-HTTP-server pattern as financeRoutes.test.ts.
 */

let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;
let otherSpaceId: string;

beforeAll(async () => {
  ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = async (tag: string) => {
    const res = await fetch(`${base}/api/space/auth`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }),
    });
    return ((await res.json()) as { id: string }).id;
  };
  spaceId = await auth("paystub");
  otherSpaceId = await auth("paystub-other");
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

const H = (sid = spaceId) => ({ "Content-Type": "application/json", "x-space-id": sid });
const post = async (p: string, b: unknown, sid = spaceId) => {
  const res = await fetch(`${base}${p}`, { method: "POST", headers: H(sid), body: JSON.stringify(b) });
  return { status: res.status, body: await res.json() };
};
const patch = async (p: string, b: unknown, sid = spaceId) => {
  const res = await fetch(`${base}${p}`, { method: "PATCH", headers: H(sid), body: JSON.stringify(b) });
  return { status: res.status, body: await res.json() };
};
const del = async (p: string, sid = spaceId) => {
  const res = await fetch(`${base}${p}`, { method: "DELETE", headers: { "x-space-id": sid } });
  return { status: res.status, body: await res.json() };
};
const get = async (p: string, sid = spaceId) => {
  const res = await fetch(`${base}${p}`, { headers: { "x-space-id": sid } });
  return { status: res.status, body: await res.json() };
};

describe("pay stub routes", () => {
  it("extract-text falls back to the offline heuristic parser (HeuristicProvider has no extractPaystub)", async () => {
    const { status, body } = await post("/api/finance/paystub/extract-text", { text: "Net Pay 900.00" });
    expect(status).toBe(200);
    expect((body as any).result.netCents).toBe(90_000);
  });

  it("confirms a pay stub: creates the FinIncome row and the fin_paystub detail record", async () => {
    const { status, body } = await post("/api/finance/paystub/confirm", {
      employer: "Acme Corp",
      payDate: "2026-03-01",
      netCents: 95_000,
      grossCents: 120_000,
      earnings: [{ label: "Regular", amountCents: 120_000 }],
      deductions: [{ label: "Federal tax", amountCents: 25_000 }],
    });
    expect(status).toBe(200);
    const paystub = (body as { paystub: FinPaystub }).paystub;
    expect(paystub.netCents).toBe(95_000);
    expect(paystub.earnings).toHaveLength(1);

    const list = await get("/api/finance/paystub");
    expect((list.body as FinPaystub[]).some((s) => s.id === paystub.id)).toBe(true);

    const detail = await get(`/api/finance/paystub/${paystub.id}`);
    expect((detail.body as FinPaystub).employer).toBe("Acme Corp");
    expect((detail.body as FinPaystub).hasSource).toBe(false);
  });

  it("rejects a confirm with no net pay", async () => {
    const { status } = await post("/api/finance/paystub/confirm", { earnings: [], deductions: [] });
    expect(status).toBe(400);
  });

  it("View original 404s with no saved source, and round-trips real bytes when one is saved", async () => {
    const noSource = await post("/api/finance/paystub/confirm", { netCents: 1000, earnings: [], deductions: [] });
    const noSourceId = (noSource.body as { paystub: FinPaystub }).paystub.id;
    const res404 = await fetch(`${base}/api/finance/paystub/${noSourceId}/download`, { headers: { "x-space-id": spaceId } });
    expect(res404.status).toBe(404);

    const sourceData = Buffer.from("hello pay stub").toString("base64");
    const withSource = await post("/api/finance/paystub/confirm", {
      // Distinct payDate: under ADR-019 §3.5 a stub with the stub above's
      // date + net and no employer/period IS that stub (a re-upload), so
      // this source round-trip fixture must be a genuinely distinct stub.
      payDate: "2026-03-02",
      netCents: 1000, earnings: [], deductions: [], sourceFilename: "stub.pdf", sourceMime: "application/pdf", sourceData,
    });
    const withSourceId = (withSource.body as { paystub: FinPaystub }).paystub.id;
    const res200 = await fetch(`${base}/api/finance/paystub/${withSourceId}/download`, { headers: { "x-space-id": spaceId } });
    expect(res200.status).toBe(200);
    const buf = Buffer.from(await res200.arrayBuffer());
    expect(buf.toString()).toBe("hello pay stub");
  });

  it("deletes a pay stub", async () => {
    const created = await post("/api/finance/paystub/confirm", { netCents: 500, earnings: [], deductions: [] });
    const id = (created.body as { paystub: FinPaystub }).paystub.id;
    expect((await del(`/api/finance/paystub/${id}`)).status).toBe(200);
    expect((await get(`/api/finance/paystub/${id}`)).status).toBe(404);
  });

  it("never leaks another space's pay stubs", async () => {
    const list = await get("/api/finance/paystub", otherSpaceId);
    expect(list.body).toEqual([]);
  });
});

describe("pay stub validation flexibility (Phase W)", () => {
  // The confirmed root cause: PaystubLineItemBody.amountCents required nonnegative and
  // .label capped at 80 chars — a legitimate negative adjustment/chargeback line, or a
  // manually-edited verbose line-item label, rejected the ENTIRE pay stub even though
  // netCents/grossCents and every other field were perfectly valid. Different jobs were
  // never actually forced into one rigid required-field schema (earnings/deductions were
  // already flexible arrays) — these two specific false positives were the real bug.

  it("1. truck driver pay stub: trucking-specific earnings (mileage, detention, layover, a negative retro correction) with no hourly fields at all", async () => {
    const { status, body } = await post("/api/finance/paystub/confirm", {
      employer: "XYZ Trucking",
      payDate: "2026-03-01",
      netCents: 145_000,
      grossCents: 180_000,
      earnings: [
        { label: "Line-haul miles", amountCents: 130_000, quantity: 2500, rateCents: 52 },
        { label: "Detention pay", amountCents: 15_000 },
        { label: "Layover pay", amountCents: 10_000 },
        { label: "Retro mileage correction", amountCents: -3_000 }, // negative — a real chargeback/correction
      ],
      deductions: [
        { label: "Federal tax", amountCents: 20_000 },
        { label: "Escrow refund", amountCents: -1_500 }, // negative deduction — a refund/reversal
      ],
      // hours / hourlyRateCents intentionally absent — not applicable to this pay structure
    });
    expect(status).toBe(200);
    const paystub = (body as { paystub: FinPaystub }).paystub;
    expect(paystub.hours).toBeNull();
    expect(paystub.earnings).toHaveLength(4);
  });

  it("2. hourly employee pay stub: hours/hourlyRateCents populated, trucking-specific concepts simply don't exist on this document", async () => {
    const { status, body } = await post("/api/finance/paystub/confirm", {
      employer: "Retail Co",
      netCents: 72_000,
      grossCents: 90_000,
      hours: 80,
      hourlyRateCents: 1_800,
      earnings: [
        { label: "Regular", amountCents: 72_000 },
        { label: "Overtime", amountCents: 18_000 },
      ],
      deductions: [{ label: "Federal tax", amountCents: 18_000 }],
    });
    expect(status).toBe(200);
    expect((body as { paystub: FinPaystub }).paystub.hours).toBe(80);
  });

  it("3. salary employee pay stub: salary + deductions only, no hourly or trucking fields", async () => {
    const { status, body } = await post("/api/finance/paystub/confirm", {
      employer: "Software Inc",
      netCents: 310_000,
      grossCents: 400_000,
      earnings: [{ label: "Salary", amountCents: 400_000 }],
      deductions: [
        { label: "Federal tax", amountCents: 70_000 },
        { label: "401k", amountCents: 20_000 },
      ],
    });
    expect(status).toBe(200);
    expect((body as { paystub: FinPaystub }).paystub.hourlyRateCents).toBeNull();
  });

  it("4. a truly invalid pay stub (no net pay at all) is rejected with a SPECIFIC error message, not the bare generic string", async () => {
    const { status, body } = await post("/api/finance/paystub/confirm", { earnings: [], deductions: [] });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/net pay/i);
    expect((body as { error: string }).error).not.toBe("Invalid pay stub");
  });

  it("5. an entirely absent optional field (employer) still saves successfully", async () => {
    const { status, body } = await post("/api/finance/paystub/confirm", { netCents: 50_000, earnings: [], deductions: [] });
    expect(status).toBe(200);
    expect((body as { paystub: FinPaystub }).paystub.employer).toBeNull();
  });

  it("6. an explicit zero (zero hours, zero quantity) is preserved as 0, not treated as missing", async () => {
    const { body } = await post("/api/finance/paystub/confirm", {
      netCents: 60_000,
      hours: 0,
      earnings: [{ label: "Salary", amountCents: 60_000, quantity: 0 }],
      deductions: [],
    });
    const paystub = (body as { paystub: FinPaystub }).paystub;
    expect(paystub.hours).toBe(0);
    expect(paystub.earnings[0]!.quantity).toBe(0);
  });

  it("7. a genuinely missing hours field is never silently converted to 0", async () => {
    // Distinct payDate from test 6: same date + net with no employer/period
    // is the same stub under ADR-019 §3.5, and test 6's stub has hours: 0.
    const { body } = await post("/api/finance/paystub/confirm", { payDate: "2026-03-03", netCents: 60_000, earnings: [], deductions: [] });
    expect((body as { paystub: FinPaystub }).paystub.hours).toBeNull();
  });

  it("accepts a negative line-item amount (chargeback/retro correction) — the confirmed false-positive this phase fixes", async () => {
    const { status, body } = await post("/api/finance/paystub/confirm", {
      netCents: 100_000,
      earnings: [{ label: "Retro mileage correction", amountCents: -2_500 }],
      deductions: [],
    });
    expect(status).toBe(200);
    expect((body as { paystub: FinPaystub }).paystub.earnings[0]!.amountCents).toBe(-2_500);
  });

  it("accepts a line-item label longer than the old 80-char cap (a verbose, manually-edited accessorial-pay description)", async () => {
    const longLabel = "Non-Taxable Per Diem Reimbursement for Interstate Line-Haul Miles Driven This Pay Period";
    expect(longLabel.length).toBeGreaterThan(80);
    const { status } = await post("/api/finance/paystub/confirm", {
      netCents: 100_000,
      earnings: [{ label: longLabel, amountCents: 5_000 }],
      deductions: [],
    });
    expect(status).toBe(200);
  });

  it("still rejects a negative top-level net pay — financial safety: only line-item amounts may be negative, never the stub's actual net/gross pay", async () => {
    const { status } = await post("/api/finance/paystub/confirm", { netCents: -100, earnings: [], deductions: [] });
    expect(status).toBe(400);
  });

  it("a deduction reversal correctly reduces the derived FinIncome.taxCents rather than corrupting it", async () => {
    const { body } = await post("/api/finance/paystub/confirm", {
      netCents: 90_000,
      earnings: [],
      deductions: [
        { label: "Federal tax", amountCents: 20_000 },
        { label: "Prior-period deduction refund", amountCents: -20_000 },
      ],
    });
    const paystub = (body as { paystub: FinPaystub }).paystub;
    // Net deductions sum to 0 here — confirmPaystub() stores taxCents as null (not a
    // nonsensical 0-or-negative value) when the deductions net out to <= 0.
    const income = await get(`/api/finance/income`);
    const row = (income.body as { taxCents: number | null }[]).find((r) => (r as any).id === paystub.incomeId);
    expect(row?.taxCents ?? null).toBeNull();
  });
});

describe("asset (net worth) routes", () => {
  it("creates an asset, logs a snapshot, lists both, then archives (not hard-deletes)", async () => {
    const created = await post("/api/finance/assets", { kind: "savings", label: "Emergency fund" });
    expect(created.status).toBe(200);
    const asset = created.body as FinAsset;

    const snap = await post(`/api/finance/assets/${asset.id}/snapshots`, { amountCents: 250_000, asOf: "2026-03-01" });
    expect(snap.status).toBe(200);
    expect((snap.body as FinAssetSnapshot).amountCents).toBe(250_000);

    const listed = await get("/api/finance/assets");
    expect((listed.body as FinAsset[]).some((a) => a.id === asset.id)).toBe(true);

    const snapshots = await get(`/api/finance/assets/${asset.id}/snapshots`);
    expect((snapshots.body as FinAssetSnapshot[])).toHaveLength(1);

    const patched = await patch(`/api/finance/assets/${asset.id}`, { label: "Emergency fund (renamed)" });
    expect((patched.body as FinAsset).label).toBe("Emergency fund (renamed)");

    expect((await del(`/api/finance/assets/${asset.id}`)).status).toBe(200);
    const afterArchive = await get("/api/finance/assets");
    expect((afterArchive.body as FinAsset[]).some((a) => a.id === asset.id)).toBe(false);
    const withArchived = await get("/api/finance/assets?includeArchived=true");
    expect((withArchived.body as FinAsset[]).some((a) => a.id === asset.id)).toBe(true);
  });

  it("404s a snapshot post against a nonexistent asset", async () => {
    const { status } = await post("/api/finance/assets/999999/snapshots", { amountCents: 100, asOf: "2026-01-01" });
    expect(status).toBe(404);
  });
});

describe("trend routes", () => {
  it("returns a continuous 12-month income series by default", async () => {
    const { status, body } = await get("/api/finance/trend/income");
    expect(status).toBe(200);
    expect((body as IncomePoint[])).toHaveLength(12);
  });

  it("returns a continuous net-worth series honoring a custom ?months=", async () => {
    const { status, body } = await get("/api/finance/trend/net-worth?months=3");
    expect(status).toBe(200);
    expect((body as NetWorthPoint[])).toHaveLength(3);
  });

  it("400s an out-of-range months value", async () => {
    const { status } = await get("/api/finance/trend/income?months=999");
    expect(status).toBe(400);
  });
});
