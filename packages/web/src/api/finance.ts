import { API, afetch, DEFAULT_TIMEOUT_MS } from "./http.js";
import type {
  FinAccount, FinBill, FinBillOccurrence, FinIncome, FinExpense, BudgetSummary, BillFrequency,
  ExpenseDirection, FinExtractionResult, MoneyStar, FinBucket, FinGoal, FinAllocation, WealthSummary,
  PaystubExtractionResult, PaystubLineItem, FinPaystub, FinAsset, FinAssetKind, FinAssetSnapshot,
  IncomePoint, NetWorthPoint,
} from "@brain/shared";

/**
 * Financial OS client (Stage 1a). Thin wrappers over /api/finance; space-scoped server-side
 * via the x-space-id header. Money is INTEGER cents. Offline-safe callers guard on null.
 */

export interface FinanceSummary {
  budget: BudgetSummary;
  account: FinAccount;
  upcoming: Array<FinBillOccurrence & { name: string }>;
  /** ADR-019 §3.7: the LIVE upcoming total before the display limit — the UI
   *  states the truncation whenever this exceeds `upcoming.length`. */
  upcomingTotal: number;
}

async function getJson<T>(path: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  try {
    const res = await afetch(`${API}/finance${path}`, {}, timeoutMs);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
async function send<T>(path: string, method: string, body?: unknown): Promise<T | null> {
  try {
    const res = await afetch(`${API}/finance${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as T;
    // A money change (balance/bill/income/expense/paid) → refresh the galaxy's money-sky stars.
    try { window.dispatchEvent(new Event("brain-finance-changed")); } catch { /* no window */ }
    return out;
  } catch {
    return null;
  }
}

/**
 * Same as send(), but surfaces the server's own error message on failure instead of collapsing
 * every distinct failure (a specific validation issue, a 413 "file too large", a real 500) into
 * a bare null. Used where the caller actually shows that reason to the user (paystub confirm) —
 * a real, reported "it just says failed to save" complaint traced directly to this exact
 * swallowing, since every route on this file already crafts a specific `{ error }` body.
 */
async function sendChecked<T>(path: string, method: string, body?: unknown): Promise<{ data: T } | { error: string }> {
  try {
    const res = await afetch(`${API}/finance${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      let message = `Request failed (${res.status}).`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody && typeof errBody.error === "string" && errBody.error.trim()) message = errBody.error;
      } catch {
        /* non-JSON error body — keep the generic status message */
      }
      return { error: message };
    }
    const out = (await res.json()) as T;
    try { window.dispatchEvent(new Event("brain-finance-changed")); } catch { /* no window */ }
    return { data: out };
  } catch {
    return { error: "Network error — check your connection and try again." };
  }
}

export const getFinanceSummary = (timeoutMs: number = DEFAULT_TIMEOUT_MS) => getJson<FinanceSummary>("/summary", timeoutMs);
export const getMoneySky = () => getJson<MoneyStar[]>("/sky");

export interface AffordResult {
  /** Whole weeks at the current pace, or null when the pace never gets there. */
  weeks: number | null;
  surplusCents: number;
  weeklyBillLoadCents: number;
}
export const getAfford = (targetCents: number, extraPerWeekCents = 0) =>
  getJson<AffordResult>(`/afford?targetCents=${targetCents}&extraPerWeekCents=${extraPerWeekCents}`);
export const setBalance = (cents: number) => send<FinAccount>("/account/balance", "PUT", { cents });
export const setBuffer = (cents: number) => send<FinAccount>("/account/buffer", "PUT", { cents });

export const listBills = () => getJson<FinBill[]>("/bills");
export interface BillInput {
  name: string; amountCents: number; frequency: BillFrequency; anchorDate: string;
  everyDays?: number; autopay?: boolean; category?: string; graceDays?: number;
  lateFeeCents?: number; payee?: string; accountLast4?: string;
}
export const createBill = (b: BillInput) => send<FinBill>("/bills", "POST", b);
export const patchBill = (id: number, patch: Partial<BillInput> & { active?: boolean }) => send<FinBill>(`/bills/${id}`, "PATCH", patch);
export const deleteBill = (id: number) => send<{ ok: boolean }>(`/bills/${id}`, "DELETE");
export type MarkOccurrencePaidResult =
  | { ok: true; budget: BudgetSummary }
  | { ok: false; error: string };
/**
 * ADR-019 P1: mark an occurrence paid. Without `expenseId` the server records
 * a new expense (claim-first, atomic); with one it MATCHES that existing
 * expense instead (no new deduction). Goes through sendChecked so a 409
 * (e.g. the chosen expense is already linked to another occurrence) surfaces
 * the server's own error text to the row instead of collapsing to null.
 */
export const markOccurrencePaid = async (id: number, expenseId?: number): Promise<MarkOccurrencePaidResult> => {
  const res = await sendChecked<{ ok: boolean; budget: BudgetSummary }>(
    `/bills/occurrence/${id}/paid`, "POST", expenseId != null ? { expenseId } : {},
  );
  return "error" in res ? { ok: false, error: res.error } : { ok: true, budget: res.data.budget };
};
/** ADR-019 P4: skip a single occurrence (stops reserving, leaves Upcoming;
 *  the recurring bill is untouched). A repeat skip answers `alreadyResolved` —
 *  the caller's refresh is the correct UI outcome either way. */
export const skipOccurrence = (id: number) => send<{ ok: boolean; alreadyResolved?: boolean; budget: BudgetSummary }>(`/bills/occurrence/${id}/skip`, "POST");

export interface IncomeInput { date: string; netCents: number; grossCents?: number; taxCents?: number; hours?: number; platform?: string }
export interface ExpenseInput { date: string; amountCents: number; category: string; direction?: ExpenseDirection; merchant?: string }
export const addIncome = (i: IncomeInput) => send<{ income: FinIncome; duplicate: boolean; budget: BudgetSummary }>("/income", "POST", i);
export const addExpense = (e: ExpenseInput) => send<{ expense: FinExpense; duplicate: boolean; budget: BudgetSummary }>("/expense", "POST", e);

// ---- History: list + edit + delete recorded transactions ----
export const listIncome = () => getJson<FinIncome[]>("/income");
export const listExpense = () => getJson<FinExpense[]>("/expense");
export const editIncome = (id: number, patch: { date?: string; netCents?: number; platform?: string | null; grossCents?: number | null; taxCents?: number | null; hours?: number | null }) => send<{ ok: boolean; budget: BudgetSummary }>(`/income/${id}`, "PATCH", patch);
export const deleteIncome = (id: number) => send<{ ok: boolean; budget: BudgetSummary }>(`/income/${id}`, "DELETE");
export const editExpense = (id: number, patch: { date?: string; amountCents?: number; merchant?: string | null; category?: string; direction?: ExpenseDirection }) => send<{ ok: boolean; budget: BudgetSummary }>(`/expense/${id}`, "PATCH", patch);
export const deleteExpense = (id: number) => send<{ ok: boolean; budget: BudgetSummary }>(`/expense/${id}`, "DELETE");

// ---- Ingestion (Stage 1b/1c): paste / image → drafts → confirm ----
export const ingestPaste = (text: string) => send<{ sourceId: number; result: FinExtractionResult }>("/ingest/paste", "POST", { text });
export const ingestImage = (dataUrl: string, mime: string) =>
  send<{ sourceId: number; result: FinExtractionResult; readable: boolean }>("/ingest/image", "POST", { dataUrl, mime });
export interface ConfirmInput {
  sourceId: number;
  incomes: Array<{ date?: string; netCents: number; platform?: string }>;
  expenses: Array<{ date?: string; amountCents: number; merchant?: string; category: string; direction?: ExpenseDirection }>;
}
export const confirmIngest = (input: ConfirmInput) => send<{ committed: number; budget: BudgetSummary }>("/ingest/confirm", "POST", input);

// ---- Wealth (docs/specs/wealth-goals-allocation.md): intention layered on Money's reality.
// These go through the same getJson/send helpers as everything above — a Wealth mutation
// dispatches "brain-finance-changed" automatically, for free, exactly like a bill/income/
// expense change already does. No separate event wiring needed anywhere.
export const getWealthSummary = () => getJson<WealthSummary>("/wealth/summary");
/**
 * Batch L (MIN-07, REG-138) — truthful-state variant of getWealthSummary
 * (the IM-45 pattern): a failed fetch is `{ ok: false }`, never a null that
 * the Financial Goals expansion reads as "still loading". The fail-soft
 * wrapper above stays for callers that only refresh an already-loaded copy.
 */
export async function getWealthSummaryResult(): Promise<{ ok: true; summary: WealthSummary } | { ok: false }> {
  const s = await getWealthSummary();
  return s ? { ok: true, summary: s } : { ok: false };
}

export const listBuckets = () => getJson<FinBucket[]>("/wealth/buckets");
export interface BucketInput { name: string; category?: string }
export const createBucket = (b: BucketInput) => send<FinBucket>("/wealth/buckets", "POST", b);
export const patchBucket = (id: number, patch: Partial<BucketInput>) => send<FinBucket>(`/wealth/buckets/${id}`, "PATCH", patch);
export const archiveBucket = (id: number) => send<{ ok: boolean }>(`/wealth/buckets/${id}`, "DELETE");

export const listGoals = (opts: { bucketId?: number; visionNodeId?: number } = {}) => {
  const params = new URLSearchParams();
  if (opts.bucketId != null) params.set("bucketId", String(opts.bucketId));
  if (opts.visionNodeId != null) params.set("visionNodeId", String(opts.visionNodeId));
  const qs = params.toString();
  return getJson<FinGoal[]>(`/wealth/goals${qs ? `?${qs}` : ""}`);
};
export interface GoalInput {
  bucketId: number;
  name: string;
  targetCents?: number | null;
  targetDate?: string | null;
  /** Life Vision (docs/specs/life-vision.md): the life_vision node this Goal helps fund. */
  visionNodeId?: number | null;
}
export const createGoal = (g: GoalInput) => send<FinGoal>("/wealth/goals", "POST", g);
export const patchGoal = (id: number, patch: Partial<Omit<GoalInput, "bucketId">>) => send<FinGoal>(`/wealth/goals/${id}`, "PATCH", patch);
export const archiveGoal = (id: number) => send<{ ok: boolean }>(`/wealth/goals/${id}`, "DELETE");

export const listAllocations = (goalId: number) => getJson<FinAllocation[]>(`/wealth/goals/${goalId}/allocations`);
/** Positive = allocate, negative = withdraw — the entire de-allocation model is this one signed call. */
export const allocate = (goalId: number, amountCents: number, note?: string) =>
  send<{ allocation: FinAllocation; wealth: WealthSummary }>(`/wealth/goals/${goalId}/allocations`, "POST", { amountCents, note });

// ---- Pay stubs (docs/specs/paystub-ingestion.md): upload -> extract -> review -> confirm.
// No persisted "pending source" like paste/image above — extraction is stateless.
export const extractPaystubText = (text: string) => send<{ result: PaystubExtractionResult }>("/paystub/extract-text", "POST", { text });
export const extractPaystubImage = (dataUrl: string, mime: string) =>
  send<{ result: PaystubExtractionResult | null }>("/paystub/extract-image", "POST", { dataUrl, mime });

export interface PaystubConfirmInput {
  employer?: string;
  payDate?: string;
  periodStart?: string;
  periodEnd?: string;
  grossCents?: number;
  netCents: number;
  hours?: number;
  hourlyRateCents?: number;
  earnings: PaystubLineItem[];
  deductions: PaystubLineItem[];
  ytdGrossCents?: number;
  ytdNetCents?: number;
  sourceFilename?: string;
  sourceMime?: string;
  sourceData?: string; // base64
}
export const confirmPaystub = (input: PaystubConfirmInput) =>
  sendChecked<{ paystub: FinPaystub; budget: BudgetSummary }>("/paystub/confirm", "POST", input);
export const listPaystubs = () => getJson<FinPaystub[]>("/paystub");
export const getPaystub = (id: number) => getJson<FinPaystub>(`/paystub/${id}`);
export const deletePaystub = (id: number) => send<{ ok: boolean }>(`/paystub/${id}`, "DELETE");
/** Fetch the original document's bytes as an object URL for inline viewing (same pattern as
 *  attachmentObjectUrl) — caller must URL.revokeObjectURL it when done. */
export async function paystubSourceObjectUrl(id: number): Promise<string | null> {
  try {
    const res = await afetch(`${API}/finance/paystub/${id}/download`);
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

// ---- Income & Net Worth Growth Trend (docs/specs/income-net-worth-trend.md) ----
export const listAssets = (includeArchived = false) => getJson<FinAsset[]>(`/assets${includeArchived ? "?includeArchived=true" : ""}`);
export const createAsset = (kind: FinAssetKind, label: string) => send<FinAsset>("/assets", "POST", { kind, label });
export const patchAsset = (id: number, patch: { kind?: FinAssetKind; label?: string }) => send<FinAsset>(`/assets/${id}`, "PATCH", patch);
/** Archives (never hard-deletes) — its history keeps counting toward past Net Worth points. */
export const archiveAsset = (id: number) => send<{ ok: boolean }>(`/assets/${id}`, "DELETE");
export const listAssetSnapshots = (assetId: number) => getJson<FinAssetSnapshot[]>(`/assets/${assetId}/snapshots`);
export const addAssetSnapshot = (assetId: number, amountCents: number, asOf: string) =>
  send<FinAssetSnapshot>(`/assets/${assetId}/snapshots`, "POST", { amountCents, asOf });

export const getIncomeTrend = (months = 12) => getJson<IncomePoint[]>(`/trend/income?months=${months}`);
export const getNetWorthTrend = (months = 12) => getJson<NetWorthPoint[]>(`/trend/net-worth?months=${months}`);
