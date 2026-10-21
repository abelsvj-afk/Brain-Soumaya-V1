import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf, rateLimit } from "../middleware.js";
import { FinAccountRepo } from "../../repositories/finAccount.repo.js";
import { FinIncomeRepo } from "../../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../../repositories/finExpense.repo.js";
import { FinBillRepo } from "../../repositories/finBill.repo.js";
import { getBudgetSummary } from "../../finance/summary.js";
import { ingestPaste, ingestImage, confirmIngest, ingestPaystubText, ingestPaystubImage, confirmPaystub } from "../../finance/ingest.js";
import { editIncome, deleteIncome, editExpense, deleteExpense } from "../../finance/mutations.js";
import { moneySky } from "../../finance/sky.js";
import { weeklyBillLoadCents, weeklySurplusCents, weeksToAfford } from "../../finance/forecast.js";
import { FinBucketRepo } from "../../repositories/finBucket.repo.js";
import { FinGoalRepo } from "../../repositories/finGoal.repo.js";
import { FinAllocationRepo } from "../../repositories/finAllocation.repo.js";
import { getWealthSummary } from "../../finance/wealth.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { FinPaystubRepo } from "../../repositories/finPaystub.repo.js";
import { FinAssetRepo } from "../../repositories/finAsset.repo.js";
import { FinAssetSnapshotRepo } from "../../repositories/finAssetSnapshot.repo.js";
import { incomeSeries } from "../../finance/incomeTrend.js";
import { netWorthSeries } from "../../finance/netWorthTrend.js";

/**
 * Financial OS (Stage 1a) routes. Thin: validate with zod → delegate to space-scoped repos +
 * the pure Budget Engine → json. Money is INTEGER cents everywhere. Deterministic + offline
 * (no OCR/LLM here). See docs/financial-os/.
 */

const cents = z.number().int(); // signed for balances
const posCents = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "date must be YYYY-MM-DD");

const BalanceBody = z.object({ cents }).strict();
const BufferBody = z.object({ cents: posCents }).strict();

const BillBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    amountCents: posCents,
    frequency: z.enum(["weekly", "biweekly", "monthly", "custom"]),
    anchorDate: isoDate,
    everyDays: z.number().int().positive().max(3650).optional(),
    autopay: z.boolean().optional(),
    category: z.string().trim().min(1).max(40).optional(),
    graceDays: z.number().int().nonnegative().max(90).optional(),
    lateFeeCents: posCents.optional(),
    payee: z.string().trim().max(80).optional(),
    accountLast4: z.string().regex(/^\d{4}$/).optional(),
  })
  .strict();
const BillPatch = BillBody.partial().extend({ active: z.boolean().optional() });

const IncomeBody = z
  .object({
    date: isoDate,
    netCents: posCents,
    grossCents: posCents.optional(),
    taxCents: posCents.optional(),
    hours: z.number().nonnegative().max(1000).optional(),
    platform: z.string().trim().max(60).optional(),
  })
  .strict();

const ExpenseBody = z
  .object({
    date: isoDate,
    amountCents: posCents,
    category: z.string().trim().min(1).max(40),
    direction: z.enum(["out", "in"]).optional(),
    merchant: z.string().trim().max(80).optional(),
  })
  .strict();

const PaystubLineItemBody = z
  .object({
    label: z.string().trim().min(1).max(160),
    // Signed, not posCents: a real pay stub can carry a negative line item — a chargeback,
    // a retro/mileage correction, a deduction refund/reversal — especially common on
    // accessorial-heavy trucking stubs. Rejecting the whole document over one legitimate
    // negative adjustment line was a confirmed false-positive (Phase W audit); the
    // top-level netCents/grossCents stay posCents below since a stub's actual net/gross
    // pay is never legitimately negative.
    amountCents: cents,
    quantity: z.number().nonnegative().max(1_000_000).optional(),
    rateCents: posCents.optional(),
    ytdCents: posCents.optional(),
  })
  .strict();

const PaystubConfirmBody = z
  .object({
    employer: z.string().trim().max(120).optional(),
    payDate: isoDate.optional(),
    periodStart: isoDate.optional(),
    periodEnd: isoDate.optional(),
    grossCents: posCents.optional(),
    netCents: posCents,
    hours: z.number().nonnegative().max(1000).optional(),
    hourlyRateCents: posCents.optional(),
    earnings: z.array(PaystubLineItemBody).max(100).default([]),
    deductions: z.array(PaystubLineItemBody).max(100).default([]),
    ytdGrossCents: posCents.optional(),
    ytdNetCents: posCents.optional(),
    sourceFilename: z.string().trim().max(200).optional(),
    sourceMime: z.string().trim().max(80).optional(),
    // base64 — size-checked at the handler (decoded byte length), same pattern as
    // nodes.ts's attachment upload, since a reasonable string-length cap here can't
    // account for base64's ~33% inflation as precisely as a decoded-byte check.
    sourceData: z.string().max(6_000_000).optional(),
  })
  .strict();
const MAX_PAYSTUB_SOURCE_BYTES = 4_000_000; // 4 MB decoded — matches MAX_ATTACHMENT_BYTES

// Friendly field names for the paystub error message below — never leaks a stack trace or
// internal type name, just names the part of the document that had a problem (Phase W §21).
const PAYSTUB_FIELD_LABELS: Record<string, string> = {
  netCents: "net pay",
  grossCents: "gross pay",
  hours: "hours",
  hourlyRateCents: "hourly rate",
  payDate: "pay date",
  periodStart: "pay period start date",
  periodEnd: "pay period end date",
  employer: "employer",
  ytdGrossCents: "year-to-date gross",
  ytdNetCents: "year-to-date net",
};

/** Turn the first zod issue from a failed PaystubConfirmBody parse into a plain-language
 *  description of WHAT was wrong, instead of a bare "Invalid pay stub" — e.g. "the amount
 *  on earnings line 3" rather than the raw path `earnings.2.amountCents`. */
function describePaystubIssue(issue: z.ZodIssue): string {
  const top = String(issue.path[0] ?? "");
  if (top === "earnings" || top === "deductions") {
    const idx = typeof issue.path[1] === "number" ? issue.path[1] + 1 : undefined;
    const sub = String(issue.path[2] ?? "");
    const subLabel = sub === "amountCents" ? "amount" : sub === "label" ? "label" : sub || "entry";
    return idx ? `the ${subLabel} on ${top} line ${idx}` : `a ${top} line`;
  }
  return PAYSTUB_FIELD_LABELS[top] ?? (top || "the pay stub");
}

const AssetBody = z.object({ kind: z.enum(["savings", "investment", "retirement", "other"]), label: z.string().trim().min(1).max(80) }).strict();
const AssetPatch = AssetBody.partial();
const SnapshotBody = z.object({ amountCents: posCents, asOf: isoDate }).strict();

const bad = (res: any, msg: string, issues?: unknown) => res.status(400).json({ error: msg, issues });

export function financeRoutes(ctx: AppContext): Router {
  const r = Router();

  // ---- Live budget summary (the home view + AI snapshot source) ----
  r.get("/summary", (_req, res) => {
    const spaceId = spaceOf(res);
    const account = new FinAccountRepo(ctx.handle, spaceId).getOrCreate();
    const budget = getBudgetSummary(ctx.handle, spaceId);
    const upcoming = new FinBillRepo(ctx.handle, spaceId).upcoming(20);
    res.json({ budget, account, upcoming });
  });

  // ---- Money-sky: bills as stars with a state (Stage 4) ----
  r.get("/sky", (_req, res) => res.json(moneySky(ctx.handle, spaceOf(res))));

  // ---- Forecast (Stage 3): "how many weeks to afford $X at my current pace" ----
  // Zero-AI — pure math already covered by finance/forecast.ts's own unit tests; this
  // route just wires it up. `weeks: null` (not Infinity — JSON can't carry that) means
  // the current pace never gets there.
  const AffordQuery = z.object({
    targetCents: z.coerce.number().int().positive(),
    extraPerWeekCents: z.coerce.number().int().nonnegative().optional(),
  });
  r.get("/afford", (req, res) => {
    const p = AffordQuery.safeParse(req.query);
    if (!p.success) return bad(res, "Query must include a positive integer targetCents", p.error.issues);
    const spaceId = spaceOf(res);
    const budget = getBudgetSummary(ctx.handle, spaceId);
    const bills = new FinBillRepo(ctx.handle, spaceId).list();
    const weeklyBillLoad = weeklyBillLoadCents(bills);
    const surplusCents = weeklySurplusCents(budget.avgWeeklyIncomeCents, weeklyBillLoad);
    const weeks = weeksToAfford(p.data.targetCents, surplusCents, p.data.extraPerWeekCents ?? 0);
    res.json({ weeks: Number.isFinite(weeks) ? weeks : null, surplusCents, weeklyBillLoadCents: weeklyBillLoad });
  });

  // ---- Account (balance / buffer / meta) ----
  r.get("/account", (_req, res) => res.json(new FinAccountRepo(ctx.handle, spaceOf(res)).getOrCreate()));
  r.put("/account/balance", (req, res) => {
    const p = BalanceBody.safeParse(req.body);
    if (!p.success) return bad(res, "Body must be { cents }", p.error.issues);
    res.json(new FinAccountRepo(ctx.handle, spaceOf(res)).setBalance(p.data.cents));
  });
  r.put("/account/buffer", (req, res) => {
    const p = BufferBody.safeParse(req.body);
    if (!p.success) return bad(res, "Body must be { cents }", p.error.issues);
    res.json(new FinAccountRepo(ctx.handle, spaceOf(res)).setBuffer(p.data.cents));
  });

  // ---- Bills ----
  r.get("/bills", (_req, res) => res.json(new FinBillRepo(ctx.handle, spaceOf(res)).list()));
  r.post("/bills", (req, res) => {
    const p = BillBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid bill", p.error.issues);
    res.json(new FinBillRepo(ctx.handle, spaceOf(res)).create(p.data));
  });
  r.patch("/bills/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = BillPatch.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid patch", p.error.issues);
    const bill = new FinBillRepo(ctx.handle, spaceOf(res)).update(id, p.data);
    return bill ? res.json(bill) : res.status(404).json({ error: "Not found" });
  });
  r.delete("/bills/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    return new FinBillRepo(ctx.handle, spaceOf(res)).deactivate(id)
      ? res.json({ ok: true })
      : res.status(404).json({ error: "Not found" });
  });
  r.post("/bills/occurrence/:id/paid", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const spaceId = spaceOf(res);
    const bills = new FinBillRepo(ctx.handle, spaceId);
    if (!bills.markPaid(id)) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, budget: getBudgetSummary(ctx.handle, spaceId) });
  });

  // ---- Manual income / expense (adjusts the balance going forward, per D3) ----
  r.post("/income", (req, res) => {
    const p = IncomeBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid income", p.error.issues);
    const spaceId = spaceOf(res);
    const inc = new FinIncomeRepo(ctx.handle, spaceId);
    const duplicate = inc.findDuplicate(p.data.date, p.data.netCents);
    const income = inc.create(p.data);
    new FinAccountRepo(ctx.handle, spaceId).adjustBalance(p.data.netCents);
    res.json({ income, duplicate: !!duplicate, budget: getBudgetSummary(ctx.handle, spaceId) });
  });
  r.post("/expense", (req, res) => {
    const p = ExpenseBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid expense", p.error.issues);
    const spaceId = spaceOf(res);
    const exp = new FinExpenseRepo(ctx.handle, spaceId);
    const dir = p.data.direction ?? "out";
    const duplicate = exp.findDuplicate(p.data.date, p.data.amountCents, p.data.merchant ?? null);
    const expense = exp.create(p.data);
    new FinAccountRepo(ctx.handle, spaceId).adjustBalance(dir === "out" ? -p.data.amountCents : p.data.amountCents);
    res.json({ expense, duplicate: !!duplicate, budget: getBudgetSummary(ctx.handle, spaceId) });
  });
  r.get("/income", (_req, res) => res.json(new FinIncomeRepo(ctx.handle, spaceOf(res)).list()));
  r.get("/expense", (_req, res) => res.json(new FinExpenseRepo(ctx.handle, spaceOf(res)).list()));

  // ---- Edit / delete recorded transactions (balance-aware, per D3) ----
  const IncomePatch = z.object({
    date: isoDate.optional(), netCents: posCents.optional(), platform: z.string().trim().max(60).nullable().optional(),
    // IM-82: same optional detail fields IncomeBody accepts at creation — editable after the fact.
    grossCents: posCents.nullable().optional(), taxCents: posCents.nullable().optional(),
    hours: z.number().nonnegative().max(1000).nullable().optional(),
  }).strict();
  const ExpensePatch = z.object({
    date: isoDate.optional(), amountCents: posCents.optional(), merchant: z.string().trim().max(80).nullable().optional(),
    category: z.string().trim().min(1).max(40).optional(), direction: z.enum(["out", "in"]).optional(),
  }).strict();

  r.patch("/income/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = IncomePatch.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid patch", p.error.issues);
    const budget = editIncome(ctx.handle, spaceOf(res), id, p.data);
    return budget ? res.json({ ok: true, budget }) : res.status(404).json({ error: "Not found" });
  });
  r.delete("/income/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const budget = deleteIncome(ctx.handle, spaceOf(res), id);
    return budget ? res.json({ ok: true, budget }) : res.status(404).json({ error: "Not found" });
  });
  r.patch("/expense/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = ExpensePatch.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid patch", p.error.issues);
    const budget = editExpense(ctx.handle, spaceOf(res), id, p.data);
    return budget ? res.json({ ok: true, budget }) : res.status(404).json({ error: "Not found" });
  });
  r.delete("/expense/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const budget = deleteExpense(ctx.handle, spaceOf(res), id);
    return budget ? res.json({ ok: true, budget }) : res.status(404).json({ error: "Not found" });
  });

  // ---- Ingestion (Stage 1b): paste → drafts → confirm. Offline, no key. ----
  const PasteBody = z.object({ text: z.string().min(1).max(20000) }).strict();
  r.post("/ingest/paste", async (req, res) => {
    const p = PasteBody.safeParse(req.body);
    if (!p.success) return bad(res, "Body must be { text }", p.error.issues);
    const out = await ingestPaste(ctx.handle, spaceOf(res), p.data.text);
    res.json(out); // { sourceId, result } — nothing committed yet
  });

  // Snap a screenshot/PDF (Stage 1c). Vision auto-extracts when a key is configured; with no
  // key (or on failure) it returns an empty result + readable:false so the UI drops to manual.
  const ImageBody = z
    // Cap under the global 1mb JSON body limit; the client downsizes before upload.
    .object({ dataUrl: z.string().min(16).startsWith("data:").max(950_000), mime: z.string().max(60) })
    .strict();
  // Unlike /ingest/paste (purely the offline HeuristicOcrProvider, no cloud call),
  // this is the one route in this file that actually calls the vision LLM — give it
  // a tighter ceiling than the generic /api limit.
  const llmLimiter = rateLimit({ max: Number(process.env.LLM_RATE_LIMIT_MAX ?? 20) });
  r.post("/ingest/image", llmLimiter, async (req, res) => {
    const p = ImageBody.safeParse(req.body);
    if (!p.success) return bad(res, "Body must be { dataUrl, mime }", p.error.issues);
    const out = await ingestImage(ctx.handle, ctx.llm, spaceOf(res), { dataUrl: p.data.dataUrl, mime: p.data.mime });
    res.json(out);
  });

  const ConfirmBody = z
    .object({
      sourceId: z.number().int().positive(),
      incomes: z
        .array(z.object({ date: isoDate.optional(), netCents: posCents, platform: z.string().trim().max(60).optional() }))
        .max(200)
        .default([]),
      expenses: z
        .array(
          z.object({
            date: isoDate.optional(),
            amountCents: posCents,
            merchant: z.string().trim().max(80).optional(),
            category: z.string().trim().min(1).max(40),
            direction: z.enum(["out", "in"]).optional(),
          }),
        )
        .max(200)
        .default([]),
    })
    .strict();
  r.post("/ingest/confirm", (req, res) => {
    const p = ConfirmBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid confirmation", p.error.issues);
    const out = confirmIngest(ctx.handle, spaceOf(res), p.data);
    return out ? res.json(out) : res.status(404).json({ error: "Source not found or already handled" });
  });

  // ---- Pay stubs (docs/specs/paystub-ingestion.md): upload -> extract -> review -> confirm.
  // No persisted "pending source" like paste/image above — extraction is stateless (nothing
  // commits) and /paystub/confirm is the one atomic write.
  const PaystubTextBody = z.object({ text: z.string().min(1).max(50_000) }).strict();
  r.post("/paystub/extract-text", async (req, res) => {
    const p = PaystubTextBody.safeParse(req.body);
    if (!p.success) return bad(res, "Body must be { text }", p.error.issues);
    const result = await ingestPaystubText(ctx.llm, p.data.text);
    res.json({ result });
  });

  // Photographed paper stub or screenshot — calls the vision LLM, same tighter rate limit
  // as /ingest/image.
  r.post("/paystub/extract-image", llmLimiter, async (req, res) => {
    const p = ImageBody.safeParse(req.body);
    if (!p.success) return bad(res, "Body must be { dataUrl, mime }", p.error.issues);
    const result = await ingestPaystubImage(ctx.llm, { dataUrl: p.data.dataUrl, mime: p.data.mime });
    res.json({ result }); // result may be null — the UI drops to a manual/empty draft
  });

  r.post("/paystub/confirm", (req, res) => {
    const p = PaystubConfirmBody.safeParse(req.body);
    if (!p.success) {
      const first = p.error.issues[0];
      const msg = first ? `This pay stub has a problem with ${describePaystubIssue(first)}.` : "Invalid pay stub";
      return bad(res, msg, p.error.issues);
    }
    const { sourceData, ...rest } = p.data;
    let source = sourceData;
    if (source) {
      const b64 = source.includes("base64,") ? source.slice(source.indexOf("base64,") + 7) : source;
      const size = Math.floor((b64.length * 3) / 4);
      if (size > MAX_PAYSTUB_SOURCE_BYTES) {
        return res.status(413).json({ error: `Original file too large (max ${(MAX_PAYSTUB_SOURCE_BYTES / 1e6).toFixed(1)} MB).` });
      }
      source = b64;
    }
    const out = confirmPaystub(ctx.handle, spaceOf(res), { ...rest, sourceData: source ?? null });
    res.json(out);
  });

  r.get("/paystub", (_req, res) => res.json(new FinPaystubRepo(ctx.handle, spaceOf(res)).list()));
  r.get("/paystub/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const stub = new FinPaystubRepo(ctx.handle, spaceOf(res)).get(id);
    return stub ? res.json(stub) : res.status(404).json({ error: "Not found" });
  });
  // The original document's bytes, for "View original" — same fetch-blob-then-object-URL
  // pattern as nodes.ts's attachment download, never sent inline with list()/get().
  r.get("/paystub/:id/download", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const repo = new FinPaystubRepo(ctx.handle, spaceOf(res));
    const blob = repo.getSourceBlob(id);
    if (!blob) return res.status(404).json({ error: "No original document saved for this pay stub." });
    const stub = repo.get(id);
    res.setHeader("Content-Type", blob.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${(blob.filename || stub?.employer || "paystub").replace(/"/g, "")}"`);
    res.send(Buffer.from(blob.data, "base64"));
  });
  r.delete("/paystub/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    return new FinPaystubRepo(ctx.handle, spaceOf(res)).remove(id)
      ? res.json({ ok: true })
      : res.status(404).json({ error: "Not found" });
  });

  // ---- Income & Net Worth Growth Trend (docs/specs/income-net-worth-trend.md) ----
  r.get("/assets", (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    res.json(new FinAssetRepo(ctx.handle, spaceOf(res)).list(includeArchived));
  });
  r.post("/assets", (req, res) => {
    const p = AssetBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid asset", p.error.issues);
    res.json(new FinAssetRepo(ctx.handle, spaceOf(res)).create(p.data));
  });
  r.patch("/assets/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = AssetPatch.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid patch", p.error.issues);
    const asset = new FinAssetRepo(ctx.handle, spaceOf(res)).update(id, p.data);
    return asset ? res.json(asset) : res.status(404).json({ error: "Not found" });
  });
  // Archives, never hard-deletes — a snapshot's contribution to past Net Worth points must
  // survive (user decision: "archive should keep the history"), same DELETE→archive shape
  // as /wealth/buckets/:id above.
  r.delete("/assets/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    return new FinAssetRepo(ctx.handle, spaceOf(res)).archive(id)
      ? res.json({ ok: true })
      : res.status(404).json({ error: "Not found" });
  });

  r.get("/assets/:id/snapshots", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    res.json(new FinAssetSnapshotRepo(ctx.handle, spaceOf(res)).listByAsset(id));
  });
  r.post("/assets/:id/snapshots", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = SnapshotBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid snapshot", p.error.issues);
    const spaceId = spaceOf(res);
    if (!new FinAssetRepo(ctx.handle, spaceId).get(id)) return res.status(404).json({ error: "Asset not found" });
    res.json(new FinAssetSnapshotRepo(ctx.handle, spaceId).create({ assetId: id, amountCents: p.data.amountCents, asOf: p.data.asOf }));
  });

  const TrendQuery = z.object({ months: z.coerce.number().int().min(1).max(60).optional() });
  r.get("/trend/income", (req, res) => {
    const p = TrendQuery.safeParse(req.query);
    if (!p.success) return bad(res, "Invalid months", p.error.issues);
    res.json(incomeSeries(ctx.handle, spaceOf(res), p.data.months ?? 12));
  });
  r.get("/trend/net-worth", (req, res) => {
    const p = TrendQuery.safeParse(req.query);
    if (!p.success) return bad(res, "Invalid months", p.error.issues);
    res.json(netWorthSeries(ctx.handle, spaceOf(res), p.data.months ?? 12));
  });

  // ---- Wealth (docs/specs/wealth-goals-allocation.md): intention layered on Money's reality.
  // Deployable/Reconciliation are computed fresh on every read, never stored. Allocations are
  // ledger records of intent, never real transfers — nothing here moves money or touches
  // fin_account; the point-of-action warning (spec §3/§9) is a client-side UI courtesy, not a
  // server-enforced block, so the route always succeeds an allocate. The one write-time guard
  // is FinAllocationRepo.create() rejecting a withdrawal that would take a goal below zero.
  const BucketBody = z.object({ name: z.string().trim().min(1).max(80), category: z.string().trim().min(1).max(40).optional() }).strict();
  const BucketPatch = BucketBody.partial();

  r.get("/wealth/summary", (_req, res) => {
    const spaceId = spaceOf(res);
    const budget = getBudgetSummary(ctx.handle, spaceId);
    res.json(getWealthSummary(ctx.handle, spaceId, budget));
  });

  r.get("/wealth/buckets", (_req, res) => res.json(new FinBucketRepo(ctx.handle, spaceOf(res)).list()));
  r.post("/wealth/buckets", (req, res) => {
    const p = BucketBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid bucket", p.error.issues);
    res.json(new FinBucketRepo(ctx.handle, spaceOf(res)).create(p.data));
  });
  r.patch("/wealth/buckets/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = BucketPatch.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid patch", p.error.issues);
    const bucket = new FinBucketRepo(ctx.handle, spaceOf(res)).update(id, p.data);
    return bucket ? res.json(bucket) : res.status(404).json({ error: "Not found" });
  });
  r.delete("/wealth/buckets/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const spaceId = spaceOf(res);
    const ok = new FinBucketRepo(ctx.handle, spaceId).archive(id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    // Cascade: a still-active goal inside an archived bucket would otherwise keep
    // affecting allocatedCents/deployableCents/reconciliation and keep appearing as a
    // Money Sky star, with no UI path left to reach it (WealthPanel only ever renders
    // a goal nested under its bucket). Archiving the bucket must actually make its
    // contents "tucked away" as promised, not orphan them still-active.
    const goalRepo = new FinGoalRepo(ctx.handle, spaceId);
    for (const g of goalRepo.list({ bucketId: id })) goalRepo.archive(g.id);
    res.json({ ok: true });
  });

  const GoalBody = z
    .object({
      bucketId: z.number().int().positive(),
      name: z.string().trim().min(1).max(120),
      targetCents: posCents.nullable().optional(),
      targetDate: isoDate.nullable().optional(),
      visionNodeId: z.number().int().positive().nullable().optional(),
    })
    .strict();
  const GoalPatch = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      targetCents: posCents.nullable().optional(),
      targetDate: isoDate.nullable().optional(),
      visionNodeId: z.number().int().positive().nullable().optional(),
    })
    .strict();

  // Life Vision (docs/specs/life-vision.md): a Financial Goal may optionally point at a
  // life_vision node. Validated here (route layer), same pattern as the bucketId check
  // just above — must exist in this space, not soft-deleted, and actually be a Vision
  // (not some other node kind). `null`/absent are always allowed (no Vision required).
  const visionError = (spaceId: string, visionNodeId: number | null | undefined): string | null => {
    if (visionNodeId == null) return null;
    const node = new NodesRepo(ctx.handle, spaceId).getById(visionNodeId);
    if (!node) return "Life Vision not found in this space";
    if (node.kind !== "life_vision") return "Not a Life Vision";
    return null;
  };

  r.get("/wealth/goals", (req, res) => {
    const bucketId = req.query.bucketId != null ? Number(req.query.bucketId) : undefined;
    if (bucketId != null && !Number.isInteger(bucketId)) return bad(res, "Invalid bucketId");
    const visionNodeId = req.query.visionNodeId != null ? Number(req.query.visionNodeId) : undefined;
    if (visionNodeId != null && !Number.isInteger(visionNodeId)) return bad(res, "Invalid visionNodeId");
    res.json(new FinGoalRepo(ctx.handle, spaceOf(res)).list({ bucketId, visionNodeId }));
  });
  r.post("/wealth/goals", (req, res) => {
    const p = GoalBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid goal", p.error.issues);
    const spaceId = spaceOf(res);
    if (!new FinBucketRepo(ctx.handle, spaceId).get(p.data.bucketId)) return bad(res, "Bucket not found in this space");
    const vErr = visionError(spaceId, p.data.visionNodeId);
    if (vErr) return bad(res, vErr);
    res.json(new FinGoalRepo(ctx.handle, spaceId).create(p.data));
  });
  r.patch("/wealth/goals/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = GoalPatch.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid patch", p.error.issues);
    const spaceId = spaceOf(res);
    const vErr = visionError(spaceId, p.data.visionNodeId);
    if (vErr) return bad(res, vErr);
    const goal = new FinGoalRepo(ctx.handle, spaceId).update(id, p.data);
    return goal ? res.json(goal) : res.status(404).json({ error: "Not found" });
  });
  r.delete("/wealth/goals/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    return new FinGoalRepo(ctx.handle, spaceOf(res)).archive(id)
      ? res.json({ ok: true })
      : res.status(404).json({ error: "Not found" });
  });

  // ---- Allocations: the entire allocate/de-allocate model is one signed ledger write.
  // Positive amountCents = allocate, negative = withdraw. Zero is meaningless — rejected.
  const AllocationBody = z
    .object({ amountCents: cents.refine((n) => n !== 0, "amountCents cannot be zero"), note: z.string().trim().max(200).optional() })
    .strict();

  r.get("/wealth/goals/:id/allocations", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    res.json(new FinAllocationRepo(ctx.handle, spaceOf(res)).list(id));
  });
  r.post("/wealth/goals/:id/allocations", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return bad(res, "Invalid id");
    const p = AllocationBody.safeParse(req.body);
    if (!p.success) return bad(res, "Invalid allocation", p.error.issues);
    const spaceId = spaceOf(res);
    if (!new FinGoalRepo(ctx.handle, spaceId).get(id)) return res.status(404).json({ error: "Goal not found" });
    const allocation = new FinAllocationRepo(ctx.handle, spaceId).create({ goalId: id, amountCents: p.data.amountCents, note: p.data.note ?? null });
    if (!allocation) return bad(res, "That withdrawal would take this goal's total below zero");
    res.json({ allocation, wealth: getWealthSummary(ctx.handle, spaceId, getBudgetSummary(ctx.handle, spaceId)) });
  });

  return r;
}
