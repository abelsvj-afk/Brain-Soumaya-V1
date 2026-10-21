import { useEffect, useRef, useState } from "react";
import type { FinBill, BillFrequency, FinIncome, FinExpense, FinPaystub, PaystubExtractionResult, PaystubLineItem, FinAsset, FinAssetKind, IncomePoint, NetWorthPoint } from "@brain/shared";
import type { FinExtractionResult } from "@brain/shared";
import { useCountUp } from "../hooks/useCountUp.js";
import {
  getFinanceSummary, setBalance, setBuffer, addIncome, addExpense, createBill, deleteBill, markOccurrencePaid, listBills,
  ingestPaste, ingestImage, confirmIngest,
  listIncome, listExpense, editIncome, deleteIncome, editExpense, deleteExpense,
  getAfford, getWealthSummary,
  extractPaystubText, extractPaystubImage, confirmPaystub, listPaystubs, deletePaystub, paystubSourceObjectUrl,
  listAssets, createAsset, archiveAsset, listAssetSnapshots, addAssetSnapshot,
  getIncomeTrend, getNetWorthTrend,
  type FinanceSummary, type PaystubConfirmInput,
} from "../api/finance.js";
import { JourneyChips } from "./JourneyChips.js";
import { WealthPanel } from "./WealthPanel.js";
import { GrowthTrendChart, type ChartSeries } from "./GrowthTrendChart.js";
import { extractFileText } from "../lib/extractFileText.js";
import { prefersReducedMotion } from "../graph/motion.js";

/** A dollar amount that DIALS to its value (never snaps) — respects reduced-motion. */
function Money({ cents, className }: { cents: number; className?: string }) {
  const shown = useCountUp(cents, 700);
  return <span className={className}>{fmt(shown)}</span>;
}
function MoneyC({ cents, className }: { cents: number; className?: string }) {
  const shown = useCountUp(cents, 700);
  return <span className={className}>{fmtc(shown)}</span>;
}

/** An editable draft row in the confirm step (income or expense). */
interface DraftRow {
  keep: boolean;
  kind: "income" | "expense";
  amount: string; // dollars, editable
  label: string; // platform (income) or merchant (expense)
  category: string; // expense only
  date: string;
  confidence: number;
  duplicate: boolean;
}

/**
 * Financial OS — Stage 1a UI (mobile-first). The hero is "Safe to Spend", kept honest by the
 * deterministic Budget Engine on the server. Zero-AI: manual entry + bills. Money is cents on
 * the wire; dollars in the inputs. A shortfall is shown with icon + label + number (never
 * colour alone). See docs/financial-os/ux-design.md.
 */

const fmt = (cents: number): string =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtc = (cents: number): string =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
/** Parse a dollar string to integer cents; NaN → null. */
const toCents = (s: string): number | null => {
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const today = (): string => new Date().toISOString().slice(0, 10);

/** Shared body, rendered both embedded in RightDock's Money tab and inside
 *  FinanceFullscreen.tsx — mirrors WealthPanel/WealthFullscreen's split exactly. Only
 *  `embedded` differs: it shows the expand-to-fullscreen button, hidden when already
 *  full-screen. `focusGoal` (Phase O, Galaxy entity detail focus) is optional and only
 *  ever passed by RightDock's embedded Money tab — a Goal clicked in the 3D galaxy.
 *  `focusBill` (Phase AC.1) is the same mechanism for a Bill clicked in the Money Sky —
 *  threaded straight through to BillManager, which owns its own open/scroll state. */
export function FinancePanel({
  embedded = true,
  focusGoal,
  focusBill,
}: { embedded?: boolean; focusGoal?: { id: number; nonce: number } | null; focusBill?: { id: number; nonce: number } | null } = {}) {
  const [sum, setSum] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [reservedOpen, setReservedOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Money displays this; Money never computes it — the real figure lives in Wealth's own
  // getWealthSummary(). Kept separate from `sum` so a Wealth-only mutation (allocate/withdraw)
  // can refresh just this number via the shared brain-finance-changed event.
  const [earmarkedCents, setEarmarkedCents] = useState<number | null>(null);
  const [wealthOpen, setWealthOpen] = useState(false);

  // Galaxy entity detail focus (Phase O): a Goal lives inside Wealth, which is
  // collapsed by default here — a focus request must force it open, or WealthPanel
  // would never even mount to receive `focusGoal` itself.
  useEffect(() => {
    if (focusGoal) setWealthOpen(true);
  }, [focusGoal?.nonce]);

  const refresh = async () => {
    setLoading(true);
    setSum(await getFinanceSummary());
    setLoading(false);
  };
  const refreshEarmarked = async () => {
    const w = await getWealthSummary();
    setEarmarkedCents(w?.allocatedCents ?? null);
  };
  useEffect(() => {
    void refresh();
    void refreshEarmarked();
    const onChanged = () => void refreshEarmarked();
    window.addEventListener("brain-finance-changed", onChanged);
    return () => window.removeEventListener("brain-finance-changed", onChanged);
  }, []);

  if (loading && !sum) return <div className="fin-panel"><p className="fin-empty">Loading your budget…</p></div>;
  if (!sum) return <div className="fin-panel"><p className="fin-empty">Couldn't reach the budget (offline?). Try again.</p></div>;

  const b = sum.budget;

  return (
    <div className="fin-panel">
      {embedded && (
        <div className="fin-panel-head">
          <span className="fin-panel-title">💵 Money</span>
          <button
            className="fin-mini"
            title="Expand Money to full-screen"
            onClick={() => window.dispatchEvent(new Event("brain-open-finance-fullscreen"))}
          >
            ⛶
          </button>
        </div>
      )}
      {/* ---- Hero: Safe to Spend ---- */}
      <section className="fin-hero">
        <div className="fin-hero-label">Safe to Spend</div>
        <Money cents={b.safeToSpendCents} className="fin-hero-amount" />
        {b.shortfallCents > 0 && (
          <div className="fin-shortfall" role="status">
            <span aria-hidden>⚠️</span> Short by <MoneyC cents={b.shortfallCents} /> before {b.nextIncomeDate}
          </div>
        )}
      </section>

      {/* This is a separate question from Safe-to-Spend, not a refinement of it — never styled
          to look like part of the hero figure itself (docs/specs/wealth-goals-allocation.md §12). */}
      {!!earmarkedCents && earmarkedCents > 0 && (
        <button className="fin-earmarked-hint" onClick={() => setWealthOpen(true)}>
          🧭 <MoneyC cents={earmarkedCents} /> earmarked toward goals
        </button>
      )}

      <div className="fin-row2">
        <div className="fin-stat"><span>Earned this week</span><Money cents={b.weekEarnedCents} className="fin-stat-num" /></div>
        <div className="fin-stat"><span>Balance</span><Money cents={b.balanceCents} className="fin-stat-num" /></div>
      </div>

      {/* ---- Safety buffer (IM-78): bufferCents is subtracted, together with reserved
          bills, before Safe to Spend (shared BudgetSummary: balance − reserved − buffer).
          It used to be invisible and un-settable, so a hero number that looked "wrong"
          had no discoverable explanation. Render it, explain it, and let the user set it
          via the existing PUT /finance/account/buffer (setBuffer). ---- */}
      <section className="fin-buffer">
        <div className="fin-stat"><span>Safety buffer</span><MoneyC cents={b.bufferCents} className="fin-stat-num" /></div>
        <p className="fin-muted">
          Safe to Spend is your balance minus bills reserved and this buffer — the buffer
          stays untouched for surprises, so it never counts as spendable.
        </p>
        <BufferEditor current={b.bufferCents} onSet={async (c) => { const r = await setBuffer(c); await refresh(); return !!r; }} />
      </section>

      {/* ---- Reserved (collapsible, itemized) ---- */}
      <button className="fin-reserved-head" onClick={() => setReservedOpen((v) => !v)} aria-expanded={reservedOpen}>
        <span>Reserved for bills</span>
        <strong><Money cents={b.reservedCents} /> {reservedOpen ? "▾" : "▸"}</strong>
      </button>
      {reservedOpen && (
        <ul className="fin-reserved-list">
          {b.reserved.length === 0 && <li className="fin-muted">Nothing due before your next income.</li>}
          {b.reserved.map((r) => (
            <li key={`${r.billId}-${r.dueDate}`}><span>{r.name}</span><span>{r.dueDate}</span><strong>{fmt(r.amountCents)}</strong></li>
          ))}
        </ul>
      )}

      {msg && <div className="fin-msg">{msg}</div>}

      {/* ---- Quick actions ---- */}
      <BalanceEditor current={b.balanceCents} onSet={async (c) => { await setBalance(c); await refresh(); }} />
      <AddMoney onDone={async (kind, ok, dup) => { setMsg(ok ? `${kind} added${dup ? " (looks like a duplicate)" : ""}` : "Couldn't save"); await refresh(); }} />
      <SnapImport onDone={async (n) => { setMsg(n > 0 ? `Added ${n} item${n === 1 ? "" : "s"} from your screenshot` : "Nothing added"); await refresh(); }} />
      <PasteImport onDone={async (n) => { setMsg(n > 0 ? `Added ${n} item${n === 1 ? "" : "s"} from your paste` : "Nothing added"); await refresh(); }} />

      {/* ---- Pay stubs (docs/specs/paystub-ingestion.md) ---- */}
      <PaystubSection onChanged={refresh} />

      {/* ---- Upcoming bills ---- */}
      <section className="fin-bills">
        <h4>Upcoming bills</h4>
        {sum.upcoming.length === 0 && <p className="fin-muted">No upcoming bills. Add your recurring bills once below.</p>}
        <ul className="fin-bill-occ">
          {sum.upcoming.map((o) => (
            <li key={o.id}>
              <span className="fin-bill-name">{o.name}</span>
              <span className="fin-bill-due">{o.dueDate}</span>
              <strong>{fmt(o.amountCents)}</strong>
              <button className="fin-paid" onClick={async () => { await markOccurrencePaid(o.id); await refresh(); }}>Paid</button>
            </li>
          ))}
        </ul>
        <BillManager onChanged={refresh} focusBill={focusBill} />
      </section>

      {/* ---- What can I afford? (Stage 3 Forecast Engine, Zero-AI) ---- */}
      <AffordCalculator />

      {/* ---- Income & Net Worth Growth Trend (docs/specs/income-net-worth-trend.md) ---- */}
      <GrowthSection />

      {/* ---- Wealth: what you're intentionally BUILDING, not what's happening right now ---- */}
      <section className="fin-wealth-section">
        <div className="fin-wealth-head">
          <button className="fin-reserved-head" onClick={() => setWealthOpen((v) => !v)} aria-expanded={wealthOpen}>
            <span>🧭 Wealth</span>
            <strong>{wealthOpen ? "▾" : "▸"}</strong>
          </button>
          {wealthOpen && (
            <button
              className="fin-mini"
              title="Expand to full-screen"
              onClick={() => {
                // Collapse the embedded copy so only one WealthPanel instance is ever
                // mounted at a time — RightDock stays mounted underneath the fullscreen
                // overlay (they're independent App.tsx conditions), so leaving this open
                // would otherwise run two independent instances in parallel: duplicate
                // fetches, duplicate brain-finance-changed listeners, and unsynced local
                // UI state (expanded bucket, in-progress amount) between the two.
                setWealthOpen(false);
                window.dispatchEvent(new Event("brain-open-wealth-fullscreen"));
              }}
            >
              ⛶
            </button>
          )}
        </div>
        {wealthOpen && <WealthPanel focusGoal={focusGoal} />}
      </section>

      {/* ---- History: everything you added, editable + deletable ---- */}
      <History onChanged={refresh} />
    </div>
  );
}

// ---- History: recent income + expenses, each editable + deletable ----
interface TxnRow { kind: "income" | "expense"; id: number; date: string; cents: number; label: string; category?: string }

function History({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TxnRow[]>([]);
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const load = async () => {
    const [inc, exp] = await Promise.all([listIncome(), listExpense()]);
    const merged: TxnRow[] = [
      ...(inc ?? []).map((i: FinIncome): TxnRow => ({ kind: "income", id: i.id, date: i.date, cents: i.netCents, label: i.platform ?? "" })),
      ...(exp ?? []).map((e: FinExpense): TxnRow => ({ kind: "expense", id: e.id, date: e.date, cents: e.amountCents, label: e.merchant ?? "", category: e.category })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
    setRows(merged);
  };
  useEffect(() => { if (open) void load(); }, [open]);

  const del = async (row: TxnRow) => {
    if (row.kind === "income") await deleteIncome(row.id); else await deleteExpense(row.id);
    await load(); onChanged();
  };
  const save = async (row: TxnRow, amount: string, label: string, date: string, category: string) => {
    const c = toCents(amount);
    if (c == null || c <= 0) return;
    if (row.kind === "income") await editIncome(row.id, { netCents: c, platform: label || null, date });
    else await editExpense(row.id, { amountCents: c, merchant: label || null, date, category: category || "misc" });
    setEditing(null); await load(); onChanged();
  };

  return (
    <section className="fin-history">
      <button className="fin-secondary" onClick={() => setOpen((v) => !v)}>{open ? "Hide history" : "🧾 View / edit history"}</button>
      {open && (
        <ul className="fin-txn-list">
          {rows.length === 0 && <li className="fin-muted">Nothing recorded yet.</li>}
          {rows.map((row) => editing && editing.id === row.id && editing.kind === row.kind ? (
            <li key={`${row.kind}-${row.id}`} className="fin-txn edit">
              <EditRow row={row} onSave={save} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={`${row.kind}-${row.id}`} className="fin-txn">
              <span className={row.kind === "income" ? "fin-tag-in" : "fin-tag-out"}>{row.kind === "income" ? "IN" : "OUT"}</span>
              <button
                className="fin-txn-lbl fin-txn-lbl-btn"
                onClick={() => setExpandedKey((k) => (k === `${row.kind}-${row.id}` ? null : `${row.kind}-${row.id}`))}
                aria-expanded={expandedKey === `${row.kind}-${row.id}`}
              >
                {row.label || (row.category ?? "—")}
              </button>
              <span className="fin-txn-date">{row.date}</span>
              <strong>{fmt(row.cents)}</strong>
              <button className="fin-mini" onClick={() => setEditing(row)} aria-label="Edit">✏️</button>
              <button className="fin-mini" onClick={() => del(row)} aria-label="Delete">🗑️</button>
              {expandedKey === `${row.kind}-${row.id}` && (
                <div className="fin-row-detail">
                  <JourneyChips kind={row.kind} refId={row.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditRow({ row, onSave, onCancel }: { row: TxnRow; onSave: (r: TxnRow, amount: string, label: string, date: string, category: string) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState((row.cents / 100).toFixed(2));
  const [label, setLabel] = useState(row.label);
  const [date, setDate] = useState(row.date);
  const [category, setCategory] = useState(row.category ?? "");
  return (
    <>
      <input className="fin-draft-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
      <input className="fin-draft-lbl" value={label} placeholder={row.kind === "income" ? "Platform" : "Merchant"} onChange={(e) => setLabel(e.target.value)} />
      {row.kind === "expense" && <input className="fin-draft-cat" value={category} placeholder="Category" onChange={(e) => setCategory(e.target.value)} />}
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      <button className="fin-mini" onClick={() => onSave(row, amount, label, date, category)} aria-label="Save">✅</button>
      <button className="fin-mini" onClick={onCancel} aria-label="Cancel">✖️</button>
    </>
  );
}

// ---- Balance quick-set ----
function BalanceEditor({ current, onSet }: { current: number; onSet: (cents: number) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  return (
    <div className="fin-balance-edit">
      {!open ? (
        <button className="fin-secondary" onClick={() => { setVal((current / 100).toFixed(2)); setOpen(true); }}>Set balance</button>
      ) : (
        <div className="fin-inline-form">
          <input inputMode="decimal" placeholder="0.00" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Current balance in dollars" />
          <button onClick={() => { const c = toCents(val); if (c != null) onSet(c); setOpen(false); }}>Save</button>
          <button className="fin-secondary" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ---- Safety buffer editor (IM-78): same quick-set shape as BalanceEditor, plus
// explicit success/failure feedback — a silent save here would leave the user unsure
// whether the number behind Safe to Spend actually changed. ----
function BufferEditor({ current, onSet }: { current: number; onSet: (cents: number) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const save = async () => {
    const c = toCents(val);
    if (c == null || c < 0) { setFeedback("Enter an amount of $0 or more."); return; }
    const ok = await onSet(c);
    setFeedback(ok ? "Safety buffer updated." : "Couldn't save the safety buffer — try again.");
    if (ok) setOpen(false);
  };
  return (
    <div className="fin-balance-edit">
      {!open ? (
        <button className="fin-secondary" onClick={() => { setVal((current / 100).toFixed(2)); setFeedback(null); setOpen(true); }}>Set safety buffer</button>
      ) : (
        <div className="fin-inline-form">
          <input inputMode="decimal" placeholder="0.00" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Safety buffer in dollars" />
          <button onClick={() => void save()}>Save buffer</button>
          <button className="fin-secondary" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
      {feedback && <div className="fin-msg" role="status">{feedback}</div>}
    </div>
  );
}

// ---- Add income / expense (manual, Stage 1a) ----
type IncomeSource = "paycheck" | "self-employed" | "other";
function AddMoney({ onDone }: { onDone: (kind: string, ok: boolean, dup: boolean) => void }) {
  const [mode, setMode] = useState<"income" | "expense" | null>(null);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(today());
  // docs/specs/income-net-worth-trend.md Decision #2: a pure UI convenience, not a schema
  // change — picking "Self-employed" just pre-fills the free-text platform field (still
  // editable) so incomeTrend.ts's text heuristic can split it out on the Growth chart.
  const [source, setSource] = useState<IncomeSource>("paycheck");

  const submit = async () => {
    const c = toCents(amount);
    if (c == null || c <= 0) { onDone("Entry", false, false); return; }
    if (mode === "income") {
      const platform = label.trim() || (source === "self-employed" ? "Self-employed" : source === "other" ? "Other" : undefined);
      const r = await addIncome({ date, netCents: c, platform });
      onDone("Income", !!r, !!r?.duplicate);
    } else {
      const r = await addExpense({ date, amountCents: c, category: label || "misc", direction: "out" });
      onDone("Expense", !!r, !!r?.duplicate);
    }
    setMode(null); setAmount(""); setLabel(""); setSource("paycheck");
  };

  if (!mode) return (
    <div className="fin-add-row">
      <button className="fin-primary" onClick={() => setMode("income")}>＋ Income</button>
      <button className="fin-primary" onClick={() => setMode("expense")}>－ Expense</button>
    </div>
  );
  return (
    <div className="fin-form">
      <div className="fin-form-title">{mode === "income" ? "Add income" : "Add expense"}</div>
      {mode === "income" && (
        <div className="fin-source-select" role="group" aria-label="Income source">
          {(["paycheck", "self-employed", "other"] as const).map((s) => (
            <button key={s} className={source === s ? "fin-primary" : "fin-secondary"} onClick={() => setSource(s)} aria-pressed={source === s}>
              {s === "paycheck" ? "Paycheck" : s === "self-employed" ? "Self-employed" : "Other"}
            </button>
          ))}
        </div>
      )}
      <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in dollars" />
      <input
        placeholder={mode === "expense" ? "Category (e.g. food)" : source === "self-employed" ? "e.g. Rideshare, freelance design" : "Platform (e.g. GoPuff)"}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      <div className="fin-form-actions">
        <button className="fin-primary" onClick={submit}>Save</button>
        <button className="fin-secondary" onClick={() => setMode(null)}>Cancel</button>
      </div>
    </div>
  );
}

/** Convert an extraction result to editable draft rows (dups pre-unchecked for expenses). */
function resultToDrafts(result: FinExtractionResult): DraftRow[] {
  return [
    ...result.incomes.map((i): DraftRow => ({
      keep: true, kind: "income", amount: (i.netCents / 100).toFixed(2),
      label: i.platform ?? "", category: "", date: i.date ?? today(), confidence: i.confidence, duplicate: !!i.duplicate,
    })),
    ...result.expenses.map((e): DraftRow => ({
      keep: !e.duplicate, kind: "expense", amount: (e.amountCents / 100).toFixed(2),
      label: e.merchant ?? "", category: e.category ?? "misc", date: e.date ?? today(), confidence: e.confidence, duplicate: !!e.duplicate,
    })),
  ];
}

/** Shared editable draft list + confirm — used by both the paste and snap importers. */
function DraftReview({ sourceId, initial, onDone, onCancel }: { sourceId: number; initial: DraftRow[]; onDone: (n: number) => void; onCancel: () => void }) {
  const [drafts, setDrafts] = useState<DraftRow[]>(initial);
  const set = (i: number, patch: Partial<DraftRow>) => setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const confirm = async () => {
    const kept = drafts.filter((d) => d.keep && toCents(d.amount));
    const res = await confirmIngest({
      sourceId,
      incomes: kept.filter((d) => d.kind === "income").map((d) => ({ date: d.date, netCents: toCents(d.amount)!, platform: d.label || undefined })),
      expenses: kept.filter((d) => d.kind === "expense").map((d) => ({ date: d.date, amountCents: toCents(d.amount)!, merchant: d.label || undefined, category: d.category || "misc", direction: "out" as const })),
    });
    onDone(res?.committed ?? 0);
  };
  return (
    <>
      <div className="fin-form-title">Review {drafts.length} item{drafts.length === 1 ? "" : "s"} — confirm to add</div>
      <ul className="fin-draft-list">
        {drafts.map((d, i) => (
          <li key={i} className={`fin-draft ${d.keep ? "" : "off"}`}>
            <label className="fin-draft-keep">
              <input type="checkbox" checked={d.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label="Include this row" />
              <span className={d.kind === "income" ? "fin-tag-in" : "fin-tag-out"}>{d.kind === "income" ? "IN" : "OUT"}</span>
            </label>
            <input className="fin-draft-amt" inputMode="decimal" value={d.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-label="Amount" />
            <input className="fin-draft-lbl" value={d.label} placeholder={d.kind === "income" ? "Platform" : "Merchant"} onChange={(e) => set(i, { label: e.target.value })} />
            {d.kind === "expense" && (
              <input className="fin-draft-cat" value={d.category} placeholder="Category" onChange={(e) => set(i, { category: e.target.value })} aria-label="Category" />
            )}
            {(d.duplicate || d.confidence < 0.5) && (
              <span className="fin-draft-flag">{d.duplicate ? "⚠️ maybe duplicate" : "❓ check this"}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="fin-form-actions">
        <button className="fin-primary" onClick={confirm}>Confirm {drafts.filter((d) => d.keep).length}</button>
        <button className="fin-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

// ---- Paste import: paste Cash App / Venmo / bank text → editable drafts → confirm ----
function PasteImport({ onDone }: { onDone: (committed: number) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ sourceId: number; drafts: DraftRow[] } | null>(null);
  const reset = () => { setOpen(false); setText(""); setReview(null); };

  const read = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const out = await ingestPaste(text);
    setBusy(false);
    setReview(out ? { sourceId: out.sourceId, drafts: resultToDrafts(out.result) } : { sourceId: -1, drafts: [] });
  };

  if (!open) return <button className="fin-secondary" onClick={() => setOpen(true)}>✍️ Type or paste transactions</button>;
  return (
    <div className="fin-form">
      {!review ? (
        <>
          <div className="fin-form-title">Type it in your own words, or paste an export</div>
          <textarea className="fin-paste-area" rows={5} placeholder={"e.g.\ngot 44.30 from DoorDash today\nspent 12 at the store\n01/09 rent -600"} value={text} onChange={(e) => setText(e.target.value)} aria-label="Type or paste transactions" />
          <div className="fin-muted">One per line. Say where money came from or went, and I'll sort out the amounts — you confirm before anything's added.</div>
          <div className="fin-form-actions">
            <button className="fin-primary" onClick={read} disabled={busy}>{busy ? "Reading…" : "Read"}</button>
            <button className="fin-secondary" onClick={reset}>Cancel</button>
          </div>
        </>
      ) : review.drafts.length === 0 ? (
        <>
          <div className="fin-muted">Couldn't find any transactions in that text.</div>
          <div className="fin-form-actions"><button className="fin-secondary" onClick={() => setReview(null)}>Try again</button></div>
        </>
      ) : (
        <DraftReview sourceId={review.sourceId} initial={review.drafts} onDone={(n) => { reset(); onDone(n); }} onCancel={reset} />
      )}
    </div>
  );
}

/** Downscale an image File to a small JPEG data URL (keeps the upload under the body limit). */
async function fileToSmallDataUrl(file: File, maxDim = 1000, quality = 0.6): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- Snap import: photo/screenshot → vision auto-extract → drafts (degrades to manual) ----
function SnapImport({ onDone }: { onDone: (committed: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ sourceId: number; drafts: DraftRow[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setNote(null);
    try {
      const dataUrl = await fileToSmallDataUrl(file);
      const out = await ingestImage(dataUrl, "image/jpeg");
      if (out && (out.result.incomes.length || out.result.expenses.length)) {
        setReview({ sourceId: out.sourceId, drafts: resultToDrafts(out.result) });
      } else {
        setNote("Couldn't read that image automatically — add it with ＋ Income / － Expense above.");
      }
    } catch {
      setNote("Couldn't process that image — try a clearer screenshot or add it manually.");
    } finally {
      setBusy(false);
    }
  };

  if (review) {
    return <div className="fin-form"><DraftReview sourceId={review.sourceId} initial={review.drafts} onDone={(n) => { setReview(null); onDone(n); }} onCancel={() => setReview(null)} /></div>;
  }
  return (
    <div className="fin-snap">
      <label className="fin-secondary fin-snap-btn">
        {busy ? "Reading…" : "📷 Take a photo"}
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {note && <div className="fin-muted">{note}</div>}
    </div>
  );
}

// ---- Recurring bill manager ----
/** `focusBill` (Phase AC.1, Galaxy entity detail focus): a Bill clicked in the Money
 *  Sky — mirrors WealthPanel's `focusGoal` handling exactly (force-open, then scroll to
 *  the matching row once it's actually mounted). */
function BillManager({ onChanged, focusBill }: { onChanged: () => void; focusBill?: { id: number; nonce: number } | null }) {
  const [open, setOpen] = useState(false);
  const [bills, setBills] = useState<FinBill[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [freq, setFreq] = useState<BillFrequency>("monthly");
  const [anchor, setAnchor] = useState(today());
  const focusedBillRef = useRef<HTMLLIElement | null>(null);

  const load = async () => {
    const list = await listBills();
    setBills(list ?? []);
  };
  useEffect(() => { if (open) void load(); }, [open]);

  // Step 1: a focus request forces this normally-collapsed section open — without
  // this, BillManager (and the bill's own row) would never mount at all.
  useEffect(() => {
    if (focusBill) setOpen(true);
  }, [focusBill?.nonce]);

  // Step 2: once `bills` has actually loaded (async, after `open` flips true) and the
  // matching row is mounted, scroll to it. Re-runs whenever `bills` changes so it
  // doesn't fire before the list — and the ref it depends on — actually exist.
  useEffect(() => {
    if (!focusBill || !open) return;
    focusedBillRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBill?.nonce, bills, open]);

  const add = async () => {
    const c = toCents(amount);
    if (!name.trim() || c == null || c <= 0) return;
    await createBill({ name: name.trim(), amountCents: c, frequency: freq, anchorDate: anchor });
    setName(""); setAmount("");
    await load(); onChanged();
  };

  return (
    <div className="fin-bill-manager">
      <button className="fin-secondary" onClick={() => setOpen((v) => !v)}>{open ? "Done managing bills" : "Manage recurring bills"}</button>
      {open && (
        <div className="fin-bill-edit">
          <ul className="fin-bill-list">
            {bills.map((bl) => (
              <li key={bl.id} ref={bl.id === focusBill?.id ? focusedBillRef : undefined}>
                <div className="fin-bill-row">
                  <span>{bl.name}</span><span className="fin-muted">{bl.frequency}</span><strong>{fmt(bl.amountCents)}</strong>
                  <button className="fin-secondary" onClick={async () => { await deleteBill(bl.id); await load(); onChanged(); }}>Remove</button>
                </div>
                <JourneyChips kind="bill" refId={bl.id} />
              </li>
            ))}
          </ul>
          <div className="fin-form">
            <div className="fin-form-title">Add a bill (once)</div>
            <input placeholder="Name (e.g. Rent)" value={name} onChange={(e) => setName(e.target.value)} />
            <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Bill amount in dollars" />
            <select value={freq} onChange={(e) => setFreq(e.target.value as BillFrequency)} aria-label="Frequency">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
            <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} aria-label="First due date" />
            <div className="fin-form-actions"><button className="fin-primary" onClick={add}>Add bill</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- "What can I afford?" — Zero-AI scenario calculator (Stage 3 Forecast Engine) ----
function AffordCalculator() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [extra, setExtra] = useState("");
  const [result, setResult] = useState<{ weeks: number | null } | "error" | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const targetCents = toCents(amount);
    if (targetCents == null || targetCents <= 0) return;
    const extraCents = extra ? toCents(extra) : 0;
    setBusy(true);
    const r = await getAfford(targetCents, extraCents && extraCents > 0 ? extraCents : 0);
    setResult(r ? { weeks: r.weeks } : "error");
    setBusy(false);
  };

  return (
    <section className="fin-afford">
      <button className="fin-secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "🧮 What can I afford?"}
      </button>
      {open && (
        <div className="fin-afford-body">
          <div className="fin-inline-form">
            <input inputMode="decimal" placeholder="Amount (e.g. 400)" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Target amount in dollars" />
            <input inputMode="decimal" placeholder="Extra $/week (optional)" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Extra income per week in dollars" />
            <button className="fin-primary" onClick={check} disabled={busy || !amount}>{busy ? "…" : "Check"}</button>
          </div>
          {result === "error" && <p className="fin-muted">Couldn't reach the budget (offline?). Try again.</p>}
          {result && result !== "error" && (
            result.weeks == null ? (
              <p className="fin-muted">You're not currently saving toward this — earning more or cutting a bill would change that.</p>
            ) : (
              <p className="fin-afford-result">
                <strong>~{result.weeks} week{result.weeks === 1 ? "" : "s"}</strong>
                {result.weeks >= 5 && ` (about ${Math.round(result.weeks / 4.345)} month${Math.round(result.weeks / 4.345) === 1 ? "" : "s"})`} at your current pace.
              </p>
            )
          )}
        </div>
      )}
    </section>
  );
}

// ==========================================================================================
// Pay stubs (docs/specs/paystub-ingestion.md) — upload/photo -> extract -> review -> confirm,
// plus a saved-stubs list/detail view and a gross/net trend.
// ==========================================================================================

/** An editable earnings or deduction row in the pay stub confirm step — dollar/number strings,
 *  same editing convention as DraftRow above. Every field is individually editable per the
 *  spec's Resolved Decision #1 (supersedes the first draft's "top-level fields only" plan). */
interface PaystubLineDraft { label: string; amount: string; quantity: string; rate: string; ytd: string }
interface PaystubDraftState {
  employer: string; payDate: string; periodStart: string; periodEnd: string;
  gross: string; net: string; hours: string; hourlyRate: string;
  earnings: PaystubLineDraft[]; deductions: PaystubLineDraft[];
  ytdGross: string; ytdNet: string;
  sourceFilename?: string; sourceMime?: string; sourceData?: string;
}

function emptyPaystubDraft(): PaystubDraftState {
  return { employer: "", payDate: today(), periodStart: "", periodEnd: "", gross: "", net: "", hours: "", hourlyRate: "", earnings: [], deductions: [], ytdGross: "", ytdNet: "" };
}
function blankPaystubResult(): PaystubExtractionResult {
  return { netCents: 0, earnings: [], deductions: [], confidence: 0 };
}
function resultToPaystubDraft(r: PaystubExtractionResult, sourceFilename?: string, sourceMime?: string, sourceData?: string): PaystubDraftState {
  const dollars = (c?: number | null) => (c != null ? (c / 100).toFixed(2) : "");
  return {
    employer: r.employer ?? "",
    payDate: r.payDate ?? today(),
    periodStart: r.periodStart ?? "",
    periodEnd: r.periodEnd ?? "",
    gross: dollars(r.grossCents),
    // Net pay is the one required field, so a failed/blank extraction must leave it EMPTY
    // (matching every other optional field's blank-when-missing behavior) rather than a
    // pre-filled "0.00" — `dollars(0)` already returns "0.00" (a real, non-empty string,
    // not falsy), so a `|| "0.00"` fallback here was dead code that just made a MISSING
    // value look like a real one, letting a user believe net pay was already read.
    net: r.netCents > 0 ? dollars(r.netCents) : "",
    hours: r.hours != null ? String(r.hours) : "",
    hourlyRate: dollars(r.hourlyRateCents),
    earnings: r.earnings.map((e) => ({ label: e.label, amount: dollars(e.amountCents), quantity: e.quantity != null ? String(e.quantity) : "", rate: dollars(e.rateCents), ytd: "" })),
    deductions: r.deductions.map((d) => ({ label: d.label, amount: dollars(d.amountCents), quantity: "", rate: "", ytd: dollars(d.ytdCents) })),
    ytdGross: dollars(r.ytdGrossCents),
    ytdNet: dollars(r.ytdNetCents),
    sourceFilename, sourceMime, sourceData,
  };
}
/** null return = the one hard validation rule (net pay required, >0) — everything else is
 *  optional, matching the confirm step's forgiving spirit (fix it later via edit/delete). */
function draftToConfirmInput(d: PaystubDraftState): PaystubConfirmInput | null {
  const net = toCents(d.net);
  if (net == null || net <= 0) return null;
  const earnings: PaystubLineItem[] = d.earnings
    .filter((e) => e.label.trim() && toCents(e.amount) != null)
    .map((e) => {
      const quantity = e.quantity.trim() ? parseFloat(e.quantity) : undefined;
      const rateCents = e.rate.trim() ? toCents(e.rate) ?? undefined : undefined;
      return { label: e.label.trim(), amountCents: toCents(e.amount)!, ...(quantity != null && Number.isFinite(quantity) ? { quantity } : {}), ...(rateCents != null ? { rateCents } : {}) };
    });
  const deductions: PaystubLineItem[] = d.deductions
    .filter((x) => x.label.trim() && toCents(x.amount) != null)
    .map((x) => {
      const ytdCents = x.ytd.trim() ? toCents(x.ytd) ?? undefined : undefined;
      return { label: x.label.trim(), amountCents: toCents(x.amount)!, ...(ytdCents != null ? { ytdCents } : {}) };
    });
  const gross = d.gross.trim() ? toCents(d.gross) ?? undefined : undefined;
  const hourlyRateCents = d.hourlyRate.trim() ? toCents(d.hourlyRate) ?? undefined : undefined;
  const hours = d.hours.trim() ? parseFloat(d.hours) : undefined;
  const ytdGrossCents = d.ytdGross.trim() ? toCents(d.ytdGross) ?? undefined : undefined;
  const ytdNetCents = d.ytdNet.trim() ? toCents(d.ytdNet) ?? undefined : undefined;
  return {
    employer: d.employer.trim() || undefined,
    payDate: d.payDate || undefined,
    periodStart: d.periodStart || undefined,
    periodEnd: d.periodEnd || undefined,
    grossCents: gross,
    netCents: net,
    hours: hours != null && Number.isFinite(hours) ? hours : undefined,
    hourlyRateCents,
    earnings,
    deductions,
    ytdGrossCents,
    ytdNetCents,
    sourceFilename: d.sourceFilename,
    sourceMime: d.sourceMime,
    sourceData: d.sourceData,
  };
}

/** Raw file bytes as base64 (no data: prefix) — for retaining the original pay stub document. */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.includes("base64,") ? result.slice(result.indexOf("base64,") + 7) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
// Server caps the decoded original at 4MB (MAX_PAYSTUB_SOURCE_BYTES); leave real margin so a
// file just under the raw-byte limit doesn't get rejected after base64's ~33% inflation math.
const MAX_PAYSTUB_SOURCE_UPLOAD_BYTES = 3_800_000;

// ---- Upload UX — two clearly separate paths (docs/specs/paystub-ingestion.md §2) ----
function PaystubUpload({ onDraft }: { onDraft: (draft: PaystubDraftState, note?: string) => void }) {
  const [busy, setBusy] = useState(false);

  const attachSource = async (file: File): Promise<Pick<PaystubDraftState, "sourceFilename" | "sourceMime" | "sourceData">> => {
    if (file.size > MAX_PAYSTUB_SOURCE_UPLOAD_BYTES) return { sourceFilename: file.name, sourceMime: file.type || undefined };
    try {
      return { sourceFilename: file.name, sourceMime: file.type || undefined, sourceData: await fileToBase64(file) };
    } catch {
      return { sourceFilename: file.name, sourceMime: file.type || undefined };
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const lower = file.name.toLowerCase();
      const isDoc = lower.endsWith(".pdf") || lower.endsWith(".docx") || file.type === "application/pdf" || file.type.includes("wordprocessingml");
      const src = await attachSource(file);
      if (isDoc) {
        try {
          const { text } = await extractFileText(file);
          const r = await extractPaystubText(text);
          onDraft(resultToPaystubDraft(r?.result ?? blankPaystubResult(), src.sourceFilename, src.sourceMime, src.sourceData));
        } catch (e: any) {
          const scanned = /scanned/i.test(String(e?.message ?? ""));
          onDraft(
            { ...emptyPaystubDraft(), ...src },
            scanned ? "That PDF looks scanned — try 📷 Take a photo instead." : "Couldn't read that file automatically — try 📷 Take a photo instead, or fill it in manually.",
          );
        }
      } else {
        const dataUrl = await fileToSmallDataUrl(file);
        const r = await extractPaystubImage(dataUrl, "image/jpeg");
        onDraft(
          resultToPaystubDraft(r?.result ?? blankPaystubResult(), src.sourceFilename, src.sourceMime ?? "image/jpeg", src.sourceData),
          r?.result ? undefined : "Couldn't read that automatically — check the numbers before saving.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToSmallDataUrl(file);
      const r = await extractPaystubImage(dataUrl, "image/jpeg");
      onDraft(
        resultToPaystubDraft(r?.result ?? blankPaystubResult(), file.name, "image/jpeg", dataUrl.slice(dataUrl.indexOf("base64,") + 7)),
        r?.result ? undefined : "Couldn't read that automatically — check the numbers before saving.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fin-paystub-upload">
      <label className="fin-primary fin-snap-btn">
        {busy ? "Reading…" : "📤 Upload a pay stub"}
        <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
          style={{ display: "none" }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void handleUpload(f); }} />
      </label>
      <label className="fin-secondary fin-snap-btn">
        {busy ? "Reading…" : "📷 Take a photo"}
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void handlePhoto(f); }} />
      </label>
    </div>
  );
}

// ---- Confirm step: every earnings/deductions row is individually editable (Decision #1) ----
function PaystubDraftForm({ draft, note, onSave, onCancel }: { draft: PaystubDraftState; note?: string; onSave: (d: PaystubDraftState) => void; onCancel: () => void }) {
  const [d, setD] = useState<PaystubDraftState>(draft);
  const set = (patch: Partial<PaystubDraftState>) => setD((v) => ({ ...v, ...patch }));
  const setEarning = (i: number, patch: Partial<PaystubLineDraft>) => setD((v) => ({ ...v, earnings: v.earnings.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) }));
  const setDeduction = (i: number, patch: Partial<PaystubLineDraft>) => setD((v) => ({ ...v, deductions: v.deductions.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }));
  const blankLine = (): PaystubLineDraft => ({ label: "", amount: "", quantity: "", rate: "", ytd: "" });

  return (
    <div className="fin-form fin-paystub-form">
      <div className="fin-form-title">Review your pay stub — confirm to save</div>
      {note && <div className="fin-muted">{note}</div>}
      <input placeholder="Employer" value={d.employer} onChange={(e) => set({ employer: e.target.value })} aria-label="Employer" />
      <div className="fin-inline-form">
        <input type="date" value={d.payDate} onChange={(e) => set({ payDate: e.target.value })} aria-label="Pay date" />
        <input inputMode="decimal" placeholder="Gross" value={d.gross} onChange={(e) => set({ gross: e.target.value })} aria-label="Gross pay" />
        <input inputMode="decimal" placeholder="Net (required)" value={d.net} onChange={(e) => set({ net: e.target.value })} aria-label="Net pay" />
      </div>
      <div className="fin-inline-form">
        <input inputMode="decimal" placeholder="Hours" value={d.hours} onChange={(e) => set({ hours: e.target.value })} aria-label="Hours" />
        <input inputMode="decimal" placeholder="Hourly rate" value={d.hourlyRate} onChange={(e) => set({ hourlyRate: e.target.value })} aria-label="Hourly rate" />
      </div>

      <div className="fin-form-title">Earnings</div>
      <ul className="fin-draft-list">
        {d.earnings.map((e, i) => (
          <li key={i} className="fin-draft">
            <input className="fin-draft-lbl" placeholder="Label (e.g. Regular, Line-haul miles)" value={e.label} onChange={(ev) => setEarning(i, { label: ev.target.value })} />
            <input className="fin-draft-amt" inputMode="decimal" placeholder="Amount" value={e.amount} onChange={(ev) => setEarning(i, { amount: ev.target.value })} />
            <input className="fin-draft-cat" inputMode="decimal" placeholder="Qty" value={e.quantity} onChange={(ev) => setEarning(i, { quantity: ev.target.value })} aria-label="Quantity (hours or miles)" />
            <input className="fin-draft-cat" inputMode="decimal" placeholder="Rate" value={e.rate} onChange={(ev) => setEarning(i, { rate: ev.target.value })} aria-label="Rate" />
            <button className="fin-mini" onClick={() => setD((v) => ({ ...v, earnings: v.earnings.filter((_, idx) => idx !== i) }))} aria-label="Remove earnings row">🗑️</button>
          </li>
        ))}
      </ul>
      <button className="fin-secondary" onClick={() => setD((v) => ({ ...v, earnings: [...v.earnings, blankLine()] }))}>+ Add earnings row</button>

      <div className="fin-form-title">Deductions</div>
      <ul className="fin-draft-list">
        {d.deductions.map((x, i) => (
          <li key={i} className="fin-draft">
            <input className="fin-draft-lbl" placeholder="Label (e.g. Federal tax, 401k)" value={x.label} onChange={(ev) => setDeduction(i, { label: ev.target.value })} />
            <input className="fin-draft-amt" inputMode="decimal" placeholder="Amount" value={x.amount} onChange={(ev) => setDeduction(i, { amount: ev.target.value })} />
            <input className="fin-draft-cat" inputMode="decimal" placeholder="YTD" value={x.ytd} onChange={(ev) => setDeduction(i, { ytd: ev.target.value })} aria-label="Year-to-date" />
            <button className="fin-mini" onClick={() => setD((v) => ({ ...v, deductions: v.deductions.filter((_, idx) => idx !== i) }))} aria-label="Remove deduction row">🗑️</button>
          </li>
        ))}
      </ul>
      <button className="fin-secondary" onClick={() => setD((v) => ({ ...v, deductions: [...v.deductions, blankLine()] }))}>+ Add deduction row</button>

      <div className="fin-inline-form">
        <input inputMode="decimal" placeholder="YTD gross" value={d.ytdGross} onChange={(e) => set({ ytdGross: e.target.value })} aria-label="Year-to-date gross" />
        <input inputMode="decimal" placeholder="YTD net" value={d.ytdNet} onChange={(e) => set({ ytdNet: e.target.value })} aria-label="Year-to-date net" />
      </div>

      <div className="fin-form-actions">
        <button className="fin-primary" onClick={() => onSave(d)}>Save pay stub</button>
        <button className="fin-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Gross/net over saved pay stubs, oldest first — the pay-stub-only slice of the shared
 *  GrowthTrendChart (docs/specs/paystub-ingestion.md §6). */
function PaystubTrend({ stubs }: { stubs: FinPaystub[] }) {
  const ordered = [...stubs].sort((a, b) => (a.payDate ?? a.createdAt).localeCompare(b.payDate ?? b.createdAt));
  const monthDay = (iso: string) => iso.slice(5, 10);
  const series: ChartSeries[] = [
    { label: "Gross", color: "#7af9ff", points: ordered.map((s) => ({ x: monthDay(s.payDate ?? s.createdAt), y: (s.grossCents ?? s.netCents) / 100 })) },
    { label: "Net", color: "#ffd27a", dashed: true, points: ordered.map((s) => ({ x: monthDay(s.payDate ?? s.createdAt), y: s.netCents / 100 })) },
  ];
  return <GrowthTrendChart series={series} height={100} />;
}

function PaystubSection({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [stubs, setStubs] = useState<FinPaystub[]>([]);
  const [draft, setDraft] = useState<{ state: PaystubDraftState; note?: string } | null>(null);
  const [detail, setDetail] = useState<FinPaystub | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => setStubs((await listPaystubs()) ?? []);
  useEffect(() => { if (open) void load(); }, [open]);
  // Object URLs are real browser resources — revoke on unmount/replacement, same discipline
  // as attachmentObjectUrl's other callers.
  useEffect(() => () => { if (viewUrl) URL.revokeObjectURL(viewUrl); }, [viewUrl]);

  const save = async (d: PaystubDraftState) => {
    const input = draftToConfirmInput(d);
    if (!input) { setMsg("Net pay is required."); return; }
    const res = await confirmPaystub(input);
    if (!res || "error" in res) {
      // Keep the draft open on failure — closing it (the previous behavior) discarded
      // everything the user just entered, so a real error meant re-typing the whole pay
      // stub from scratch on every retry. Surface the server's actual reason instead of a
      // generic "try again" that gives no hint of what's actually wrong.
      const reason = res && "error" in res ? res.error : "unknown error";
      setDraft((v) => (v ? { ...v, note: `Couldn't save — ${reason}` } : v));
      return;
    }
    setDraft(null);
    setMsg("Pay stub saved");
    await load();
    onChanged();
  };

  const remove = async (id: number) => {
    await deletePaystub(id);
    setDetail(null);
    await load();
    onChanged();
  };

  const viewOriginal = async (id: number) => {
    const url = await paystubSourceObjectUrl(id);
    if (url) setViewUrl(url); else setMsg("No original document saved for this pay stub.");
  };

  return (
    <section className="fin-paystubs">
      <button className="fin-reserved-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>📄 Pay Stubs</span>
        <strong>{open ? "▾" : "▸"}</strong>
      </button>
      {open && (
        <div className="fin-paystub-body">
          {/* Rendered unconditionally (not just in the list view) — save()'s validation
           *  failure ("Net pay is required.") sets this while the draft form stays open,
           *  so it must be visible THERE too. It was previously nested inside the
           *  `!draft && !detail` branch, meaning a failed save looked like Save did
           *  nothing at all: the message was set but the only place it rendered was a
           *  view the user had just navigated away from. */}
          {msg && <div className="fin-muted fin-paystub-msg">{msg}</div>}
          {!draft && !detail && (
            <>
              <PaystubUpload onDraft={(state, note) => { setMsg(null); setDraft({ state, note }); }} />
              {stubs.length > 1 && <PaystubTrend stubs={stubs} />}
              <ul className="fin-paystub-list">
                {stubs.length === 0 && <li className="fin-muted">No pay stubs saved yet.</li>}
                {stubs.map((s) => (
                  <li key={s.id} className="fin-paystub-row">
                    <button className="fin-txn-lbl fin-txn-lbl-btn" onClick={() => setDetail(s)}>
                      {s.employer || "Pay stub"} — {s.payDate ?? "no date"}
                    </button>
                    <span>{s.grossCents != null ? `${fmt(s.grossCents)} → ` : ""}{fmt(s.netCents)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {draft && <PaystubDraftForm draft={draft.state} note={draft.note} onSave={save} onCancel={() => { setMsg(null); setDraft(null); }} />}
          {detail && !viewUrl && (
            <div className="fin-paystub-detail">
              <button className="fin-secondary" onClick={() => setDetail(null)}>← Back</button>
              <h4>{detail.employer || "Pay stub"}</h4>
              <p className="fin-muted">
                {detail.payDate ?? ""} {detail.periodStart && detail.periodEnd ? `(${detail.periodStart} – ${detail.periodEnd})` : ""}
              </p>
              <p>Gross: {detail.grossCents != null ? fmt(detail.grossCents) : "—"} · Net: {fmt(detail.netCents)}</p>
              {detail.hours != null && <p>Hours: {detail.hours}{detail.hourlyRateCents != null ? ` @ ${fmt(detail.hourlyRateCents)}/hr` : ""}</p>}
              {detail.earnings.length > 0 && (
                <>
                  <h5>Earnings</h5>
                  <ul className="fin-paystub-lines">
                    {detail.earnings.map((e, i) => (
                      <li key={i}>
                        {e.label}{e.quantity != null ? ` (${e.quantity}${e.rateCents != null ? ` @ ${fmt(e.rateCents)}` : ""})` : ""} <strong>{fmt(e.amountCents)}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail.deductions.length > 0 && (
                <>
                  <h5>Deductions</h5>
                  <ul className="fin-paystub-lines">
                    {detail.deductions.map((x, i) => (
                      <li key={i}>
                        {x.label} <strong>{fmt(x.amountCents)}</strong>{x.ytdCents != null ? ` (YTD ${fmt(x.ytdCents)})` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {(detail.ytdGrossCents != null || detail.ytdNetCents != null) && (
                <p className="fin-muted">
                  YTD: {detail.ytdGrossCents != null ? `gross ${fmt(detail.ytdGrossCents)} ` : ""}{detail.ytdNetCents != null ? `net ${fmt(detail.ytdNetCents)}` : ""}
                </p>
              )}
              <div className="fin-form-actions">
                {detail.hasSource && <button className="fin-secondary" onClick={() => viewOriginal(detail.id)}>View original</button>}
                <button className="fin-secondary" onClick={() => remove(detail.id)}>Delete</button>
              </div>
            </div>
          )}
          {viewUrl && (
            <div className="fin-paystub-viewer">
              <button className="fin-secondary" onClick={() => { URL.revokeObjectURL(viewUrl); setViewUrl(null); }}>Close</button>
              {detail?.sourceMime === "application/pdf" ? (
                <iframe src={viewUrl} title="Original pay stub document" className="fin-paystub-iframe" />
              ) : (
                <img src={viewUrl} alt="Original pay stub document" className="fin-paystub-img" />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ==========================================================================================
// Income & Net Worth Growth Trend (docs/specs/income-net-worth-trend.md)
// ==========================================================================================

function AssetManager({ onChanged }: { onChanged: () => void }) {
  const [assets, setAssets] = useState<FinAsset[]>([]);
  const [kind, setKind] = useState<FinAssetKind>("savings");
  const [label, setLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<number, { amount: string; asOf: string }>>({});

  const load = async () => setAssets((await listAssets()) ?? []);
  useEffect(() => { void load(); }, []);

  const add = async () => {
    if (!label.trim()) return;
    await createAsset(kind, label.trim());
    setLabel("");
    await load();
    onChanged();
  };
  // Archives, never hard-deletes (user decision: "archive should keep the history") — its
  // past snapshots keep counting toward historical Net Worth points.
  const remove = async (id: number) => {
    await archiveAsset(id);
    await load();
    onChanged();
  };
  const logSnapshot = async (assetId: number) => {
    const draft = drafts[assetId];
    const c = draft ? toCents(draft.amount) : null;
    if (c == null) return;
    await addAssetSnapshot(assetId, c, draft?.asOf || today());
    setDrafts((s) => ({ ...s, [assetId]: { amount: "", asOf: today() } }));
    onChanged();
  };

  return (
    <div className="fin-assets">
      <ul className="fin-asset-list">
        {assets.length === 0 && <li className="fin-muted">No accounts yet — add a savings, investment, or retirement account below.</li>}
        {assets.map((a) => (
          <li key={a.id} className="fin-asset-row">
            <span>{a.label} <span className="fin-muted">({a.kind})</span></span>
            <div className="fin-inline-form">
              <input inputMode="decimal" placeholder="Balance" value={drafts[a.id]?.amount ?? ""}
                onChange={(e) => setDrafts((s) => ({ ...s, [a.id]: { amount: e.target.value, asOf: s[a.id]?.asOf ?? today() } }))}
                aria-label={`${a.label} balance`} />
              <input type="date" value={drafts[a.id]?.asOf ?? today()}
                onChange={(e) => setDrafts((s) => ({ ...s, [a.id]: { amount: s[a.id]?.amount ?? "", asOf: e.target.value } }))}
                aria-label={`${a.label} as-of date`} />
              <button className="fin-mini" onClick={() => logSnapshot(a.id)} aria-label={`Log ${a.label} balance`}>✅</button>
              <button className="fin-mini" onClick={() => remove(a.id)} aria-label={`Remove ${a.label}`}>🗑️</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="fin-form">
        <div className="fin-form-title">Add an account</div>
        <select value={kind} onChange={(e) => setKind(e.target.value as FinAssetKind)} aria-label="Account type">
          <option value="savings">Savings</option>
          <option value="investment">Investment</option>
          <option value="retirement">Retirement</option>
          <option value="other">Other</option>
        </select>
        <input placeholder="Name (e.g. Emergency fund)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="fin-form-actions"><button className="fin-primary" onClick={add}>Add account</button></div>
      </div>
    </div>
  );
}

function GrowthSection() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"income" | "netWorth">("income");
  const [income, setIncome] = useState<IncomePoint[] | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthPoint[] | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);

  const load = async () => {
    setIncome(await getIncomeTrend(12));
    setNetWorth(await getNetWorthTrend(12));
  };
  useEffect(() => { if (open) void load(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onChanged = () => void load();
    window.addEventListener("brain-finance-changed", onChanged);
    return () => window.removeEventListener("brain-finance-changed", onChanged);
  }, [open]);

  const monthLabel = (iso: string): string => {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  };

  const incomeSeries: ChartSeries[] = income ? [{ label: "Income", color: "#7af9ff", points: income.map((p) => ({ x: monthLabel(p.periodStart), y: p.totalCents / 100 })) }] : [];
  // Net worth's cash portion is a real number today, projected backward for months before
  // now (spec Decision #3) — dashed marks that honestly instead of presenting it as history.
  const netWorthSeries: ChartSeries[] = netWorth
    ? [{ label: "Net worth", color: "#a6ff7a", points: netWorth.map((p) => ({ x: monthLabel(p.asOf), y: p.totalCents / 100, dashed: p.cashIsProjected })) }]
    : [];

  return (
    <section className="fin-growth">
      <button className="fin-reserved-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>📈 Growth</span>
        <strong>{open ? "▾" : "▸"}</strong>
      </button>
      {open && (
        <div className="fin-growth-body">
          <div className="fin-growth-toggle" role="group" aria-label="Chart">
            <button className={mode === "income" ? "fin-primary" : "fin-secondary"} onClick={() => setMode("income")} aria-pressed={mode === "income"}>Income</button>
            <button className={mode === "netWorth" ? "fin-primary" : "fin-secondary"} onClick={() => setMode("netWorth")} aria-pressed={mode === "netWorth"}>Net Worth</button>
          </div>
          {mode === "income" ? <GrowthTrendChart series={incomeSeries} /> : <GrowthTrendChart series={netWorthSeries} />}
          {mode === "netWorth" && netWorth?.some((p) => p.cashIsProjected) && (
            <p className="fin-muted gtc-note">Dashed = projected from today's cash balance (no history yet) — solid segments are real logged balances.</p>
          )}
          <button className="fin-secondary" onClick={() => setAssetsOpen((v) => !v)} aria-expanded={assetsOpen}>
            {assetsOpen ? "Hide accounts" : "💰 Manage accounts"}
          </button>
          {assetsOpen && <AssetManager onChanged={load} />}
        </div>
      )}
    </section>
  );
}
