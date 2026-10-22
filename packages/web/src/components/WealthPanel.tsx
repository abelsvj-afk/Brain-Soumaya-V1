import { useEffect, useRef, useState, type RefObject } from "react";
import type { FinGoalWithProgress, WealthSummary } from "@brain/shared";
import {
  getWealthSummary, createBucket, patchBucket, archiveBucket,
  createGoal, patchGoal, archiveGoal, listAllocations, allocate,
} from "../api/finance.js";
import { getCognitive, type CognitiveItem } from "../api/mind.js";
import type { FinAllocation } from "@brain/shared";
import { JourneyChips } from "./JourneyChips.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { fmtMoneyDateRel, fmtStampRel } from "./moneyDates.js";
import { getSpaceTimeZone } from "../utils/spaceTimezone.js";
import { useCountUp } from "../hooks/useCountUp.js";
import { prefersReducedMotion } from "../graph/motion.js";

const fmt = (cents: number): string => (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

/**
 * The Wealth surface (docs/specs/wealth-goals-allocation.md): what the user is intentionally
 * BUILDING with their money, layered on top of Money's own "what's happening right now."
 * Deliberately vocabulary-disciplined throughout — "allocate"/"earmarked"/"pledged", never
 * "saved"/"balance"/"deposited"/"invested" — because nothing here is a real money transfer.
 *
 * Renders identically whether embedded (default) or wrapped in a full-screen overlay by the
 * parent — this component has no knowledge of which mode it's in.
 *
 * `focusGoal` (Phase O, Galaxy entity detail focus, optional) is a one-shot request from a
 * Goal clicked in the 3D galaxy — expand its bucket and scroll to it.
 */
export function WealthPanel({ focusGoal }: { focusGoal?: { id: number; nonce: number } | null } = {}) {
  const [summary, setSummary] = useState<WealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [newBucketName, setNewBucketName] = useState("");
  const [newBucketCategory, setNewBucketCategory] = useState("");
  const [expandedBucket, setExpandedBucket] = useState<number | null>(null);
  const focusedGoalRef = useRef<HTMLDivElement | null>(null);
  // IM-82: Life Visions a Goal can be linked to (visionNodeId used to be settable
  // only from the Mind tab). Fetched once from the cognitive layer.
  const [visions, setVisions] = useState<CognitiveItem[]>([]);
  // IM-84: bucket edit replaces the native prompt(); archive uses ConfirmDialog.
  const [editingBucketId, setEditingBucketId] = useState<number | null>(null);
  const [editBucketName, setEditBucketName] = useState("");
  const [editBucketCategory, setEditBucketCategory] = useState("");
  const [confirmArchiveBucket, setConfirmArchiveBucket] = useState<{ id: number; name: string } | null>(null);

  // Step 1: find which bucket the focused Goal lives in and expand it (a Goal only ever
  // renders nested under its bucket here). Re-runs if `summary` arrives after the focus
  // request (e.g. the panel just mounted), and on every repeat click (`nonce`).
  useEffect(() => {
    if (!focusGoal || !summary) return;
    const goal = summary.goals.find((g) => g.id === focusGoal.id);
    if (goal) setExpandedBucket(goal.bucketId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGoal?.nonce, summary]);

  // Step 2: once the matching bucket is actually expanded (possibly by the effect above,
  // possibly already open), the GoalCard is mounted and `focusedGoalRef` is attached —
  // scroll to it. Split from step 1 because a bucket that only just opened doesn't have
  // its GoalCard in the DOM until AFTER this render commits.
  useEffect(() => {
    if (!focusGoal) return;
    focusedGoalRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedBucket, focusGoal?.nonce]);

  const refresh = async () => {
    setSummary(await getWealthSummary());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    void (async () => {
      try {
        const v = await getCognitive("life_vision");
        setVisions(Array.isArray(v) ? v : []);
      } catch {
        setVisions([]);
      }
    })();
    // Deployable depends on Safe-to-Spend too — a plain Money change (spending, a bill paid)
    // can flip Reconciliation even when nothing in Wealth's own data changed.
    const onChanged = () => void refresh();
    window.addEventListener("brain-finance-changed", onChanged);
    return () => window.removeEventListener("brain-finance-changed", onChanged);
  }, []);

  async function addBucket() {
    const name = newBucketName.trim();
    if (!name) return;
    const category = newBucketCategory.trim();
    setNewBucketName("");
    setNewBucketCategory("");
    // IM-82: bucket `category` was accepted server-side but never settable here.
    await createBucket(category ? { name, category } : { name });
    await refresh();
  }

  async function saveBucketEdit(id: number) {
    const name = editBucketName.trim();
    if (!name) return;
    const category = editBucketCategory.trim();
    // The server requires a non-empty category when present, so an emptied field
    // simply leaves the stored category unchanged rather than failing the save.
    await patchBucket(id, category ? { name, category } : { name });
    setEditingBucketId(null);
    await refresh();
  }

  if (loading && !summary) return <p className="fin-muted">Loading your Wealth…</p>;
  // IM-84: same honest-error + retry treatment as the Money hero.
  if (!summary) return (
    <div>
      <p className="fin-empty">Couldn't reach Wealth (offline?). Try again.</p>
      <button className="fin-secondary" onClick={() => { setLoading(true); void refresh(); }}>Retry</button>
    </div>
  );

  return (
    <div className="wealth-panel">
      <div className={`wealth-deployable ${summary.reconciliation === "over_committed" ? "over" : ""}`}>
        <div className="fin-hero-label">Deployable</div>
        <DeployableAmount cents={summary.deployableCents} />
        <p className="fin-muted" style={{ margin: "2px 0 0" }}>
          Safe-to-Spend minus what you've already earmarked toward goals.
        </p>
        {summary.reconciliation === "over_committed" && (
          <p className="wealth-warning" role="status">
            ⚠️ Your current financial position is below the amount you've earmarked toward goals by{" "}
            {fmt(-summary.deployableCents)}. Nothing was changed automatically — you decide what, if
            anything, to withdraw.
          </p>
        )}
      </div>

      {summary.buckets.length === 0 && (
        <p className="fin-muted">No buckets yet — start with one that fits what you're building (Emergency, Retirement, a big purchase…).</p>
      )}

      <ul className="wealth-buckets">
        {summary.buckets.map((b) => {
          const goals = summary.goals.filter((g) => g.bucketId === b.id);
          const open = expandedBucket === b.id;
          const allocatedInBucket = goals.reduce((s, g) => s + g.totalCents, 0);
          return (
            <li key={b.id} className="wealth-bucket">
              <button className="wealth-bucket-head" onClick={() => setExpandedBucket(open ? null : b.id)} aria-expanded={open}>
                <span className="wealth-bucket-name">{b.name}</span>
                {b.category && <span className="fin-muted">{b.category}</span>}
                <span className="fin-muted">{goals.length} goal{goals.length === 1 ? "" : "s"}{allocatedInBucket > 0 ? ` · ${fmt(allocatedInBucket)} allocated` : ""}</span>
                <span>{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="wealth-bucket-body">
                  {goals.length === 0 && <p className="fin-muted">No goals in this bucket yet.</p>}
                  {goals.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      deployableCents={summary.deployableCents}
                      visions={visions}
                      onChanged={refresh}
                      focusRef={g.id === focusGoal?.id ? focusedGoalRef : undefined}
                    />
                  ))}
                  <NewGoalForm bucketId={b.id} visions={visions} onCreated={refresh} />
                  <div className="wealth-bucket-actions">
                    <button
                      className="fin-mini"
                      onClick={() => { setEditingBucketId(b.id); setEditBucketName(b.name); setEditBucketCategory(b.category ?? ""); }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className="fin-mini"
                      onClick={() => setConfirmArchiveBucket({ id: b.id, name: b.name })}
                    >
                      📥 Archive
                    </button>
                  </div>
                  {editingBucketId === b.id && (
                    <div className="fin-inline-form">
                      <input className="list-filter" value={editBucketName} maxLength={80} onChange={(e) => setEditBucketName(e.target.value)} aria-label="Bucket name" />
                      <input className="list-filter" value={editBucketCategory} maxLength={40} placeholder="Category (e.g. emergency)" onChange={(e) => setEditBucketCategory(e.target.value)} aria-label="Bucket category" />
                      <button className="fin-mini" onClick={() => void saveBucketEdit(b.id)}>Save bucket</button>
                      <button className="fin-mini" onClick={() => setEditingBucketId(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="wealth-new-bucket">
        <input
          className="list-filter"
          value={newBucketName}
          maxLength={80}
          placeholder="New bucket name (e.g. Trucking, Retirement)…"
          onChange={(e) => setNewBucketName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addBucket()}
        />
        <input
          className="list-filter"
          value={newBucketCategory}
          maxLength={40}
          placeholder="Category (optional)"
          onChange={(e) => setNewBucketCategory(e.target.value)}
          aria-label="New bucket category"
        />
        <button className="fin-secondary" disabled={!newBucketName.trim()} onClick={() => void addBucket()}>
          ➕ New bucket
        </button>
      </div>

      {confirmArchiveBucket && (
        <ConfirmDialog
          title="Archive this bucket?"
          message={`Archive "${confirmArchiveBucket.name}"? Its goals stay, just tucked away.`}
          confirmLabel="Archive"
          onConfirm={async () => {
            const b = confirmArchiveBucket;
            setConfirmArchiveBucket(null);
            await archiveBucket(b.id);
            setExpandedBucket(null);
            await refresh();
          }}
          onCancel={() => setConfirmArchiveBucket(null)}
        />
      )}
    </div>
  );
}

/** IM-84: Deployable counts up with the SAME hook + duration as the Money hero's
 *  Money component — one motion standard across the tab. A child component so it
 *  mounts with its real value (like Money, which only mounts once the summary
 *  exists) and animates on subsequent changes. */
function DeployableAmount({ cents }: { cents: number }) {
  const shown = useCountUp(cents, 700);
  return <div className="wealth-deployable-amount">{fmt(shown)}</div>;
}

function NewGoalForm({ bucketId, visions, onCreated }: { bucketId: number; visions: CognitiveItem[]; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  // IM-82: a goal created in Wealth could never gain a deadline or a Vision in
  // Wealth — both were only settable elsewhere (targetDate nowhere, Vision in Mind).
  const [targetDate, setTargetDate] = useState("");
  const [visionId, setVisionId] = useState("");

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const targetCents = target.trim() ? Math.round(parseFloat(target) * 100) : null;
    setName("");
    setTarget("");
    setTargetDate("");
    setVisionId("");
    await createGoal({
      bucketId, name: trimmed,
      targetCents: Number.isFinite(targetCents) ? targetCents : null,
      targetDate: targetDate || null,
      visionNodeId: visionId ? Number(visionId) : null,
    });
    await onCreated();
  }

  return (
    <div className="wealth-new-goal">
      <input className="list-filter" value={name} maxLength={120} placeholder="New goal (e.g. First Truck Down Payment)…" onChange={(e) => setName(e.target.value)} />
      <input className="list-filter" value={target} placeholder="Target $ (optional)" inputMode="decimal" onChange={(e) => setTarget(e.target.value)} style={{ maxWidth: "140px" }} />
      <input className="list-filter" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} aria-label="Goal target date" style={{ maxWidth: "160px" }} />
      {visions.length > 0 && (
        <select className="list-filter" value={visionId} onChange={(e) => setVisionId(e.target.value)} aria-label="Life Vision" style={{ maxWidth: "180px" }}>
          <option value="">No Life Vision</option>
          {visions.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      )}
      <button className="fin-mini" disabled={!name.trim()} onClick={() => void submit()}>
        ➕ Add goal
      </button>
    </div>
  );
}

function GoalCard({
  goal,
  deployableCents,
  visions,
  onChanged,
  focusRef,
}: {
  goal: FinGoalWithProgress;
  deployableCents: number;
  visions: CognitiveItem[];
  onChanged: () => Promise<void>;
  /** Galaxy entity detail focus (Phase O): set only on the ONE GoalCard being focused. */
  focusRef?: RefObject<HTMLDivElement | null>;
}) {
  // ADR-019 §3.4: this is a money surface — its relative labels follow the
  // SPACE zone. Read through the synchronous getter at render (the same
  // derivation pattern ReviewPanel/TimelineView use), NOT a new hook
  // subscription per card: WealthPanel re-renders on every finance change,
  // and its usual parent (FinancePanel) owns the zone subscription.
  const timeZone = getSpaceTimeZone();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<FinAllocation[] | null>(null);
  // IM-84: the over-allocate confirm() and the failure alert() become the shared
  // dialog + an inline error in the app's own voice.
  const [pendingOver, setPendingOver] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  // IM-82: goal editing (name/target/date/Vision) from Wealth itself.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editVision, setEditVision] = useState("");

  const visionLabel = goal.visionNodeId != null ? visions.find((v) => v.id === goal.visionNodeId)?.label : undefined;

  async function doAllocate(amountCents: number) {
    setBusy(true);
    setErrorMsg(null);
    const result = await allocate(goal.id, amountCents);
    setBusy(false);
    if (!result) {
      setErrorMsg(amountCents < 0 ? "That withdrawal would take this goal's total below zero." : "Couldn't save that allocation — try again.");
      return;
    }
    setAmount("");
    if (showHistory) setHistory(await listAllocations(goal.id));
    await onChanged();
  }

  async function submit(sign: 1 | -1) {
    const raw = parseFloat(amount);
    if (!Number.isFinite(raw) || raw <= 0) return;
    const amountCents = Math.round(raw * 100) * sign;
    // Point-of-action warning (docs/specs/wealth-goals-allocation.md §3/§9): a courtesy, not a
    // block — the write still succeeds either way. Only checked for an ALLOCATE (sign > 0);
    // withdrawing only ever increases Deployable, so it never needs this warning.
    if (sign > 0 && amountCents > deployableCents) {
      setPendingOver(amountCents);
      return;
    }
    await doAllocate(amountCents);
  }

  async function saveEdit() {
    const name = editName.trim();
    if (!name) return;
    const targetCents = editTarget.trim() ? Math.round(parseFloat(editTarget) * 100) : null;
    await patchGoal(goal.id, {
      name,
      targetCents: Number.isFinite(targetCents) ? targetCents : null,
      targetDate: editDate || null,
      visionNodeId: editVision ? Number(editVision) : null,
    });
    setEditing(false);
    await onChanged();
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null) setHistory(await listAllocations(goal.id));
  }

  return (
    <div ref={focusRef} className="wealth-goal">
      <div className="wealth-goal-head">
        <strong>{goal.name}</strong>
        {goal.targetDate && <span className="fin-muted">by {fmtMoneyDateRel(goal.targetDate, new Date(), timeZone)}</span>}
      </div>
      {goal.visionNodeId != null && (
        <p className="fin-muted" style={{ margin: "2px 0 0" }}>🌅 {visionLabel ?? "Life Vision"}</p>
      )}
      {goal.fillPct != null ? (
        <div className="wealth-progress-track" role="progressbar" aria-valuenow={Math.round(goal.fillPct * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="wealth-progress-fill" style={{ width: `${Math.round(goal.fillPct * 100)}%` }} />
        </div>
      ) : null}
      <div className="wealth-goal-amounts">
        <span>{fmt(goal.totalCents)}{goal.targetCents ? ` of ${fmt(goal.targetCents)}` : " allocated (open-ended)"}</span>
        {goal.state === "goal_reached" && <span className="wealth-reached">✦ Reached</span>}
      </div>
      <div className="wealth-goal-controls">
        <input
          className="list-filter"
          value={amount}
          placeholder="Amount $"
          inputMode="decimal"
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
          style={{ maxWidth: "110px" }}
        />
        <button className="fin-mini" disabled={busy || !amount.trim()} onClick={() => void submit(1)}>+ Allocate</button>
        <button className="fin-mini" disabled={busy || !amount.trim()} onClick={() => void submit(-1)}>− Withdraw</button>
        <button className="fin-mini" onClick={() => void toggleHistory()}>{showHistory ? "Hide" : "History"}</button>
        <button
          className="fin-mini"
          onClick={() => {
            setEditName(goal.name);
            setEditTarget(goal.targetCents != null ? (goal.targetCents / 100).toFixed(2) : "");
            setEditDate(goal.targetDate ?? "");
            setEditVision(goal.visionNodeId != null ? String(goal.visionNodeId) : "");
            setEditing(true);
          }}
        >
          ✏️ Edit
        </button>
        <button
          className="fin-mini"
          onClick={() => setConfirmArchive(true)}
        >
          📥
        </button>
      </div>
      {errorMsg && <p className="wealth-error" role="alert">{errorMsg}</p>}
      {editing && (
        <div className="fin-inline-form">
          <input className="list-filter" value={editName} maxLength={120} onChange={(e) => setEditName(e.target.value)} aria-label="Goal name" />
          <input className="list-filter" value={editTarget} placeholder="Target $" inputMode="decimal" onChange={(e) => setEditTarget(e.target.value)} aria-label="Goal target in dollars" style={{ maxWidth: "120px" }} />
          <input className="list-filter" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} aria-label="Goal target date" style={{ maxWidth: "160px" }} />
          {visions.length > 0 && (
            <select className="list-filter" value={editVision} onChange={(e) => setEditVision(e.target.value)} aria-label="Life Vision" style={{ maxWidth: "180px" }}>
              <option value="">No Life Vision</option>
              {visions.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          )}
          <button className="fin-mini" onClick={() => void saveEdit()}>Save goal</button>
          <button className="fin-mini" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
      <JourneyChips kind="goal" refId={goal.id} />
      {showHistory && (
        <ul className="wealth-history">
          {history === null && <li className="fin-muted">Loading…</li>}
          {history !== null && history.length === 0 && <li className="fin-muted">No allocations yet.</li>}
          {history?.map((a) => (
            <li key={a.id}>
              <span className={a.amountCents >= 0 ? "wealth-in" : "wealth-out"}>{a.amountCents >= 0 ? "+" : ""}{fmt(a.amountCents)}</span>
              <span className="fin-muted">{fmtStampRel(a.createdAt, new Date(), timeZone)}</span>
              {a.note && <span className="fin-muted">— {a.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {pendingOver != null && (
        <ConfirmDialog
          title="Allocate past Deployable?"
          message={`This would put you ${fmt(pendingOver - deployableCents)} past what's currently deployable. Allocate anyway?`}
          confirmLabel="Allocate anyway"
          cancelLabel="Cancel"
          onConfirm={async () => { const c = pendingOver; setPendingOver(null); await doAllocate(c); }}
          onCancel={() => setPendingOver(null)}
        />
      )}
      {confirmArchive && (
        <ConfirmDialog
          title="Archive this goal?"
          message={`Archive "${goal.name}"? Its history stays, just tucked away.`}
          confirmLabel="Archive"
          onConfirm={async () => { setConfirmArchive(false); await archiveGoal(goal.id); await onChanged(); }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </div>
  );
}
