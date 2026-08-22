import { useEffect, useState } from "react";
import type { FinBill, BillFrequency, FinIncome, FinExpense } from "@brain/shared";
import type { FinExtractionResult } from "@brain/shared";
import { useCountUp } from "../hooks/useCountUp.js";
import {
  getFinanceSummary, setBalance, addIncome, addExpense, createBill, deleteBill, markOccurrencePaid,
  ingestPaste, ingestImage, confirmIngest,
  listIncome, listExpense, editIncome, deleteIncome, editExpense, deleteExpense,
  type FinanceSummary,
} from "../api/finance.js";

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

export function FinancePanel() {
  const [sum, setSum] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [reservedOpen, setReservedOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setSum(await getFinanceSummary());
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, []);

  if (loading && !sum) return <div className="fin-panel"><p className="fin-empty">Loading your budget…</p></div>;
  if (!sum) return <div className="fin-panel"><p className="fin-empty">Couldn't reach the budget (offline?). Try again.</p></div>;

  const b = sum.budget;

  return (
    <div className="fin-panel">
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

      <div className="fin-row2">
        <div className="fin-stat"><span>Earned this week</span><Money cents={b.weekEarnedCents} className="fin-stat-num" /></div>
        <div className="fin-stat"><span>Balance</span><Money cents={b.balanceCents} className="fin-stat-num" /></div>
      </div>

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
        <BillManager onChanged={refresh} />
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
              <span className="fin-txn-lbl">{row.label || (row.category ?? "—")}</span>
              <span className="fin-txn-date">{row.date}</span>
              <strong>{fmt(row.cents)}</strong>
              <button className="fin-mini" onClick={() => setEditing(row)} aria-label="Edit">✏️</button>
              <button className="fin-mini" onClick={() => del(row)} aria-label="Delete">🗑️</button>
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

// ---- Add income / expense (manual, Stage 1a) ----
function AddMoney({ onDone }: { onDone: (kind: string, ok: boolean, dup: boolean) => void }) {
  const [mode, setMode] = useState<"income" | "expense" | null>(null);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(today());

  const submit = async () => {
    const c = toCents(amount);
    if (c == null || c <= 0) { onDone("Entry", false, false); return; }
    if (mode === "income") {
      const r = await addIncome({ date, netCents: c, platform: label || undefined });
      onDone("Income", !!r, !!r?.duplicate);
    } else {
      const r = await addExpense({ date, amountCents: c, category: label || "misc", direction: "out" });
      onDone("Expense", !!r, !!r?.duplicate);
    }
    setMode(null); setAmount(""); setLabel("");
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
      <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in dollars" />
      <input placeholder={mode === "income" ? "Platform (e.g. GoPuff)" : "Category (e.g. food)"} value={label} onChange={(e) => setLabel(e.target.value)} />
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
        {busy ? "Reading…" : "📷 Snap a screenshot"}
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {note && <div className="fin-muted">{note}</div>}
    </div>
  );
}

// ---- Recurring bill manager ----
function BillManager({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [bills, setBills] = useState<FinBill[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [freq, setFreq] = useState<BillFrequency>("monthly");
  const [anchor, setAnchor] = useState(today());

  const load = async () => {
    const list = await (await import("../api/finance.js")).listBills();
    setBills(list ?? []);
  };
  useEffect(() => { if (open) void load(); }, [open]);

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
              <li key={bl.id}>
                <span>{bl.name}</span><span className="fin-muted">{bl.frequency}</span><strong>{fmt(bl.amountCents)}</strong>
                <button className="fin-secondary" onClick={async () => { await deleteBill(bl.id); await load(); onChanged(); }}>Remove</button>
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
