import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { FinExtractionResult, ExtractedIncome, ExtractedExpense, BudgetSummary, FinSourceKind, PaystubExtractionResult, PaystubLineItem, FinPaystub } from "@brain/shared";
import type { LlmProvider } from "../llm/adapter.js";
import { HeuristicOcrProvider } from "../ocr/heuristic.js";
import { heuristicExtractPaystub } from "../ocr/paystubHeuristic.js";
import { FinSourceRepo } from "../repositories/finSource.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinCategoryOverrideRepo } from "../repositories/finCategoryOverride.repo.js";
import { FinPaystubRepo } from "../repositories/finPaystub.repo.js";
import { categorize } from "./categorize.js";
import { getBudgetSummary } from "./summary.js";
import { spaceTimezone, localDay } from "../agent/notify/policy.js";

/**
 * Ingestion pipeline (Stage 1b) — paste text → retained source → DRAFT candidates → (user
 * confirms) → committed rows. Nothing commits until confirm; every committed row links to its
 * source for traceability. Offline: the heuristic parser needs no cloud key. See
 * docs/financial-os/architecture.md §3.
 */

/** A default day for a candidate that carried no parseable date: the
 *  SPACE's local calendar day (owner rule 2026-10-21) — an entry logged in
 *  the user's evening is dated that evening's day, never tomorrow's UTC
 *  date. */
function today(handle: DbHandle, spaceId: string): string {
  return localDay(new Date(), spaceTimezone(handle.sqlite, spaceId));
}

/** Categorize expenses (learned overrides + rules) + flag likely duplicates against the DB. */
function annotate(handle: DbHandle, spaceId: string, raw: FinExtractionResult): FinExtractionResult {
  const overrides = new FinCategoryOverrideRepo(handle, spaceId);
  const incomeRepo = new FinIncomeRepo(handle, spaceId);
  const expenseRepo = new FinExpenseRepo(handle, spaceId);
  const incomes: ExtractedIncome[] = raw.incomes.map((i) => ({
    ...i,
    duplicate: !!incomeRepo.findDuplicate(i.date ?? today(handle, spaceId), i.netCents),
  }));
  const expenses: ExtractedExpense[] = raw.expenses.map((e) => ({
    ...e,
    category: categorize(e.merchant, overrides.get(e.merchant ?? "")),
    duplicate: !!expenseRepo.findDuplicate(e.date ?? today(handle, spaceId), e.amountCents, e.merchant ?? null),
  }));
  return { incomes, expenses, provider: raw.provider };
}

/** Persist a pending source with its (truncated) raw + annotated result for traceability. */
function persistSource(handle: DbHandle, spaceId: string, kind: FinSourceKind, mime: string | null, rawText: string | null, result: FinExtractionResult): number {
  return new FinSourceRepo(handle, spaceId).create({
    kind,
    mime,
    // NOTE: raw image blobs are NOT written to disk yet (Stage 2 hardening, decision D1);
    // for paste we retain the text, for image we retain the mime + extraction only.
    extractionJson: JSON.stringify({ raw: rawText ? rawText.slice(0, 20_000) : undefined, result }),
  }).id;
}

/**
 * Parse pasted text into DRAFT candidates: retain the raw source (status=pending), run the
 * heuristic provider, categorize + dedup-flag. Returns the sourceId + the annotated result.
 * Commits NOTHING. Offline: needs no cloud key.
 */
export async function ingestPaste(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  text: string,
): Promise<{ sourceId: number; result: FinExtractionResult }> {
  const raw = await new HeuristicOcrProvider().extract({ kind: "paste", text });
  const result = annotate(handle, spaceId, raw);
  const sourceId = persistSource(handle, spaceId, "paste", null, text, result);
  return { sourceId, result };
}

/**
 * Read a financial screenshot/PDF via the vision provider (Stage 1c). Degrades gracefully:
 * if no vision key is configured (or the call fails), it returns an EMPTY result so the UI
 * drops to manual entry — the source is still retained. Commits NOTHING.
 */
export async function ingestImage(
  handle: DbHandle,
  llm: LlmProvider,
  spaceId: string = DEFAULT_SPACE,
  image: { dataUrl: string; mime: string },
): Promise<{ sourceId: number; result: FinExtractionResult; readable: boolean }> {
  let raw: FinExtractionResult | null = null;
  try {
    raw = (await llm.extractFinancialImage?.(image)) ?? null;
  } catch {
    raw = null; // never let a vision failure break ingestion
  }
  const base: FinExtractionResult = raw ?? { incomes: [], expenses: [], provider: "vision" };
  const result = annotate(handle, spaceId, base);
  const kind: FinSourceKind = image.mime === "application/pdf" ? "pdf" : "image";
  const sourceId = persistSource(handle, spaceId, kind, image.mime, null, result);
  return { sourceId, result, readable: !!raw && (result.incomes.length > 0 || result.expenses.length > 0) };
}

/**
 * Commit the user-confirmed rows against a pending source: insert each income/expense linked to
 * the source, learn any category the user set, adjust the balance going forward (D3), mark the
 * source confirmed, and return the fresh budget.
 */
export function confirmIngest(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: {
    sourceId: number;
    incomes: Array<{ date?: string; netCents: number; platform?: string }>;
    expenses: Array<{ date?: string; amountCents: number; merchant?: string; category: string; direction?: "out" | "in" }>;
  },
): { committed: number; budget: BudgetSummary } | null {
  const sources = new FinSourceRepo(handle, spaceId);
  const source = sources.get(input.sourceId);
  if (!source || source.status !== "pending") return null; // unknown or already handled

  const incomeRepo = new FinIncomeRepo(handle, spaceId);
  const expenseRepo = new FinExpenseRepo(handle, spaceId);
  const account = new FinAccountRepo(handle, spaceId);
  const overrides = new FinCategoryOverrideRepo(handle, spaceId);
  let committed = 0;

  const tx = handle.sqlite.transaction(() => {
    for (const i of input.incomes) {
      const date = (i.date ?? today(handle, spaceId)).slice(0, 10);
      incomeRepo.create({ date, netCents: i.netCents, platform: i.platform ?? null, sourceId: source.id, confidence: 1 });
      account.adjustBalance(i.netCents);
      committed++;
    }
    for (const e of input.expenses) {
      const date = (e.date ?? today(handle, spaceId)).slice(0, 10);
      const dir = e.direction ?? "out";
      expenseRepo.create({ date, amountCents: e.amountCents, category: e.category, direction: dir, merchant: e.merchant ?? null, sourceId: source.id, confidence: 1 });
      account.adjustBalance(dir === "out" ? -e.amountCents : e.amountCents);
      if (e.merchant && e.category) overrides.set(e.merchant, e.category); // remember the choice
      committed++;
    }
    sources.setStatus(source.id, "confirmed");
  });
  tx();

  return { committed, budget: getBudgetSummary(handle, spaceId) };
}

/**
 * Pay stub ingestion (docs/specs/paystub-ingestion.md). Unlike paste/image ingest above, this
 * has no persisted "pending source" step: extraction is a pure, stateless read (nothing
 * commits), and confirmPaystub below is the one atomic write. Tries the LLM first (when
 * configured), falling back to the offline regex parser — text extraction always works with
 * no cloud key, matching this codebase's "never hard-depend on a cloud key" rule.
 */
export async function ingestPaystubText(llm: LlmProvider, text: string): Promise<PaystubExtractionResult> {
  let result: PaystubExtractionResult | null = null;
  try {
    result = (await llm.extractPaystub?.(text)) ?? null;
  } catch {
    result = null;
  }
  return result ?? heuristicExtractPaystub(text);
}

/** A photographed paper stub or screenshot. Degrades to null (empty manual draft) with no
 *  vision key configured or on any failure — there's no offline OCR fallback for images. */
export async function ingestPaystubImage(
  llm: LlmProvider,
  image: { dataUrl: string; mime: string },
): Promise<PaystubExtractionResult | null> {
  try {
    return (await llm.extractPaystubImage?.(image)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Commit a (user-reviewed/edited) pay stub: one FinIncome row (net pay — Safe-to-Spend is
 * unaffected in shape) plus one fin_paystub row holding the full detail + original document.
 * taxCents is derived as the sum of the confirmed deductions, same "never store what can be
 * computed" spirit as the rest of Financial OS, but persisted onto FinIncome (a genuinely
 * dormant column until now) so existing income displays show more detail for free.
 */
export function confirmPaystub(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: {
    employer?: string | null;
    payDate?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    grossCents?: number | null;
    netCents: number;
    hours?: number | null;
    hourlyRateCents?: number | null;
    earnings: PaystubLineItem[];
    deductions: PaystubLineItem[];
    ytdGrossCents?: number | null;
    ytdNetCents?: number | null;
    sourceFilename?: string | null;
    sourceMime?: string | null;
    sourceData?: string | null;
  },
): { paystub: FinPaystub; budget: BudgetSummary } {
  const incomeRepo = new FinIncomeRepo(handle, spaceId);
  const account = new FinAccountRepo(handle, spaceId);
  const paystubRepo = new FinPaystubRepo(handle, spaceId);
  const date = (input.payDate ?? today(handle, spaceId)).slice(0, 10);
  const taxCents = input.deductions.reduce((s, d) => s + (d.amountCents || 0), 0);

  const tx = handle.sqlite.transaction(() => {
    const income = incomeRepo.create({
      date,
      netCents: input.netCents,
      grossCents: input.grossCents ?? null,
      taxCents: taxCents > 0 ? taxCents : null,
      hours: input.hours ?? null,
      platform: input.employer ?? null,
      confidence: 1,
    });
    account.adjustBalance(input.netCents);
    return paystubRepo.create({ ...input, incomeId: income.id });
  });
  const paystub = tx();

  return { paystub, budget: getBudgetSummary(handle, spaceId) };
}
