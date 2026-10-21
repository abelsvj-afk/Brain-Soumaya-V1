import { useEffect, useRef, useState } from "react";
import type { Journey, JourneyLinksDetail } from "@brain/shared";
import { getJourneys, createJourney, patchJourney, deleteJourney, journeyLinks } from "../api/journeys.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { prefersReducedMotion } from "../graph/motion.js";

/**
 * Journeys (Vision 2.0) — the highest-level organizer: a life chapter everything can belong to
 * (Become an RN, Recover Financially, Buy My First Home…). This panel is the home for creating +
 * tending them; linking objects to a journey happens from those objects (a memory's inspector, a
 * transaction, etc.). Mobile-first. See docs/VISION_2_JOURNEYS.md.
 */

const SUGGESTED = [
  { title: "Recover Financially", icon: "💵" },
  { title: "Get Healthy", icon: "💪" },
  { title: "Build My Business", icon: "🚀" },
  { title: "Learn Something New", icon: "📚" },
];

export function JourneysPanel({
  onFocus,
  focusJourney,
  onAskJourney,
}: {
  onFocus?: (id: number) => void;
  /** Galaxy entity detail focus (Phase O): a Journey hub clicked in the 3D galaxy —
   *  expand and scroll to the matching card. `nonce` makes a repeat click on the same
   *  Journey re-trigger too, without JourneyCard needing to report back that it
   *  "consumed" the request (a done journey never has a hub to click, so this only
   *  ever needs to match against the `active` list below). */
  focusJourney?: { id: number; nonce: number } | null;
  /** Journey → Chat (Phase AC.1, docs/specs/soumaya-connective-tissue-onboarding.md):
   *  "Ask Soumaya about this" — reuses the existing Chat/journeyId contract (Phase Q
   *  server-side), never a second scoping system. */
  onAskJourney?: (journey: { id: number; title: string }) => void;
}) {
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  // Distinguishes "never loaded yet" from "the last load failed" — getJourneys()
  // returns null on ANY failure, and this used to be handed straight to setJourneys,
  // so a single network hiccup showed "Loading your journeys…" forever. Worse,
  // refresh() runs after every mutation, so a blip mid-session wiped the whole panel
  // back to that same permanent loading state.
  const [loadError, setLoadError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("🧭");

  const refresh = async () => {
    const result = await getJourneys();
    if (result) {
      setJourneys(result);
      setLoadError(false);
    } else {
      // Keep whatever we already had rather than nulling it out — a failed refresh
      // should read as "couldn't update," not "everything is gone."
      setLoadError(true);
      pushToast("Couldn't refresh your Journeys — try again.", "⚠️", 3500);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const add = async (t: string, ic: string) => {
    if (!t.trim()) return;
    const created = await createJourney({ title: t.trim(), icon: ic.trim() || "🧭" });
    if (!created) {
      pushToast("Couldn't create that Journey — try again.", "⚠️", 3500);
      return;
    }
    setTitle(""); setAdding(false);
    await refresh();
  };

  if (journeys === null) {
    return (
      <div className="jn-panel">
        <p className="jn-empty">
          {loadError ? "Couldn't load your Journeys — " : "Loading your journeys…"}
          {loadError && <button className="jn-secondary" onClick={() => void refresh()}>Retry</button>}
        </p>
      </div>
    );
  }

  const active = journeys.filter((j) => j.status !== "done");
  const done = journeys.filter((j) => j.status === "done");

  return (
    <div className="jn-panel">
      <div className="jn-intro">
        A <strong>Journey</strong> is a meaningful chapter of your life. Memories, money, tasks and goals
        all connect through it — so instead of "where do I save this?", the question becomes
        "<em>what Journey does this move forward?</em>"
      </div>

      {active.length === 0 && (
        <div className="jn-suggest">
          {/* Gated on active.length, not journeys.length — a brand-new brain and
              someone who's completed every Journey they started both have zero
              active ones, and both deserve this prompt instead of it vanishing
              forever the moment a single Journey (ever) existed. */}
          <div className="jn-empty">Start with one that fits your life right now:</div>
          <div className="jn-suggest-row">
            {SUGGESTED.map((s) => (
              <button key={s.title} className="jn-chip" onClick={() => add(s.title, s.icon)}>{s.icon} {s.title}</button>
            ))}
          </div>
        </div>
      )}

      {active.map((j) => <JourneyCard key={j.id} j={j} onChanged={refresh} onFocus={onFocus} focusJourney={focusJourney} onAskJourney={onAskJourney} />)}

      {adding ? (
        <div className="jn-form">
          <div className="jn-form-row">
            <input
              className="jn-icon-in"
              value={icon}
              // Array.from splits by Unicode code point, not UTF-16 unit — .slice(0,2)
              // truncated any emoji outside the BMP (most modern ones) mid-character.
              // Still imperfect for multi-codepoint ZWJ sequences (e.g. 👨‍👩‍👧), but
              // strictly better than cutting a single emoji in half.
              onChange={(e) => setIcon(Array.from(e.target.value).slice(0, 1).join(""))}
              aria-label="Icon"
            />
            <input className="jn-title-in" placeholder="Name your journey (e.g. Become an RN)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Journey title" />
          </div>
          <div className="jn-form-actions">
            <button className="jn-primary" onClick={() => add(title, icon)}>Create</button>
            <button className="jn-secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="jn-primary jn-add" onClick={() => setAdding(true)}>＋ New Journey</button>
      )}

      {done.length > 0 && (
        <details className="jn-done">
          <summary>Completed ({done.length})</summary>
          {done.map((j) => <JourneyCard key={j.id} j={j} onChanged={refresh} onFocus={onFocus} onAskJourney={onAskJourney} />)}
        </details>
      )}
    </div>
  );
}

function JourneyCard({
  j,
  onChanged,
  onFocus,
  focusJourney,
  onAskJourney,
}: {
  j: Journey;
  onChanged: () => void;
  onFocus?: (id: number) => void;
  focusJourney?: { id: number; nonce: number } | null;
  onAskJourney?: (journey: { id: number; title: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<JourneyLinksDetail | null>(null);
  const [linksError, setLinksError] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Galaxy entity detail focus (Phase O): every JourneyCard in the `active` list is
  // always mounted (unlike WealthPanel's goals, which sit behind a collapsed bucket),
  // so this effect can expand + scroll directly — no second "wait for it to mount"
  // step needed. Keyed on the nonce alone (not `j.id`) so a repeat click on the SAME
  // Journey re-fires this effect too.
  useEffect(() => {
    if (!focusJourney || focusJourney.id !== j.id) return;
    setOpen(true);
    cardRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusJourney?.nonce]);
  const serverPct = Math.round((j.progress ?? 0) * 100);
  // Local, so the thumb moves with the finger instead of only after a round-trip —
  // the drag used to fire a PATCH per pixel (~100 requests for a full 0->100 drag),
  // each one triggering onChanged()'s full refetch, with no guarantee they land in
  // the order they were sent.
  const [pct, setPct] = useState(serverPct);
  useEffect(() => setPct(serverPct), [serverPct]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setLinksError(false);
      void journeyLinks(j.id).then((result) => {
        if (cancelled) return; // this journey closed (or another opened) before it resolved
        if (result) setLinks(result);
        else { setLinks(null); setLinksError(true); }
      });
    } else {
      // Reset so re-opening shows "Loading…" rather than a stale list from last time.
      setLinks(null);
    }
    return () => { cancelled = true; };
  }, [open, j.id]);

  const bumpProgress = (next: number) => {
    const clamped = Math.max(0, Math.min(100, next));
    setPct(clamped);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void patchJourney(j.id, { progress: clamped / 100 }).then((ok) => {
        if (ok) onChanged();
        else { pushToast("Couldn't save that progress — try again.", "⚠️", 3500); setPct(serverPct); }
      });
    }, 350);
  };

  const setStatus = async (status: "active" | "paused" | "done") => {
    const ok = await patchJourney(j.id, { status });
    if (!ok) {
      pushToast("Couldn't update that Journey — try again.", "⚠️", 3500);
      return;
    }
    // Marking a whole Journey complete had zero feedback beyond the list
    // re-sorting underneath you — no toast, no sound, nothing.
    if (status === "done") {
      playSfx("milestone");
      pushToast(`"${j.title}" complete ✦`, "🧭", 4500);
    }
    onChanged();
  };

  const remove = async () => {
    if (!confirm(`Delete "${j.title}"? Its links are removed (the memories/items stay).`)) return;
    const ok = await deleteJourney(j.id);
    if (ok) onChanged();
    else pushToast("Couldn't delete that Journey — try again.", "⚠️", 3500);
  };

  return (
    <div ref={cardRef} className={`jn-card ${j.status}`}>
      <button className="jn-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="jn-icon">{j.icon ?? "🧭"}</span>
        <span className="jn-name">{j.title}</span>
        {/* Paused/done used to be distinguished ONLY by a subtle 0.6/0.7 opacity
            on the whole card — invisible at a glance, especially collapsed. */}
        {j.status === "paused" && <span className="jn-status-badge paused">⏸ Paused</span>}
        {j.status === "done" && <span className="jn-status-badge done">✓ Done</span>}
        <span className="jn-link-count">{j.linkCount ?? 0} linked</span>
      </button>
      <div className="jn-bar" aria-label={`${pct}% progress`}><div className="jn-bar-fill" style={{ width: `${pct}%` }} /></div>
      {open && (
        <div className="jn-detail">
          {j.description && <p className="jn-desc">{j.description}</p>}
          <div className="jn-progress-row">
            <span>Progress</span>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => bumpProgress(Number(e.target.value))}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress"
            />
            <strong>{pct}%</strong>
          </div>
          <div className="jn-detail-actions">
            {onAskJourney && (
              <button className="jn-secondary" onClick={() => onAskJourney({ id: j.id, title: j.title })}>
                💬 Ask Soumaya
              </button>
            )}
            {j.status !== "done" ? (
              <button className="jn-secondary" onClick={() => void setStatus("done")}>Mark complete</button>
            ) : (
              <button className="jn-secondary" onClick={() => void setStatus("active")}>Reopen</button>
            )}
            {j.status === "active" ? (
              <button className="jn-secondary" onClick={() => void setStatus("paused")}>Pause</button>
            ) : j.status === "paused" ? (
              <button className="jn-secondary" onClick={() => void setStatus("active")}>Resume</button>
            ) : null}
            <button className="jn-danger" onClick={() => void remove()}>Delete</button>
          </div>
          <JourneyLinksSection detail={links} linksError={linksError} onFocus={onFocus} />
        </div>
      )}
    </div>
  );
}

const fmt = (cents: number): string => (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

/** Everything linked to a Journey — memories/tasks with fly-to, transactions with
 *  earned/spent totals. The totals come from the server's aggregate over ALL links
 *  (IM-87), never from summing the display-capped rows shown here. A linked bill
 *  shows as a separate note rather than folding into the total: it's a recurring
 *  schedule, not a dated transaction. */
function JourneyLinksSection({
  detail,
  linksError,
  onFocus,
}: {
  detail: JourneyLinksDetail | null;
  linksError?: boolean;
  onFocus?: (id: number) => void;
}) {
  if (linksError) return <p className="jn-hint">⚠️ Couldn't load what's linked — try reopening this Journey.</p>;
  if (detail === null) return <p className="jn-hint">Loading what's linked…</p>;
  const { links } = detail;
  if (detail.totalCount === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
        <p className="jn-hint" style={{ margin: 0 }}>
          Nothing linked yet — connect a memory, task, or transaction from where you're already working.
        </p>
        <button
          className="mini"
          onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "panel", value: "ingest" } }))}
        >
          ➕ Dump a thought to link here
        </button>
      </div>
    );
  }
  const memories = links.filter((l) => l.kind === "node" || l.kind === "insight" || l.kind === "doc");
  // Goals ARE hydrated server-side (fin_goal name) — the panel used to drop them
  // on the floor, so a goal-only journey showed an empty detail under an
  // "N linked" header (IM-86). Rendered as plain rows: a goal's refId is a
  // fin_goal id, not a node id, so the fly-to onFocus must NOT be wired to it.
  const goals = links.filter((l) => l.kind === "goal");
  const income = links.filter((l) => l.kind === "income");
  const expense = links.filter((l) => l.kind === "expense");
  const bills = links.filter((l) => l.kind === "bill");
  // True totals over every linked transaction (server aggregate), not the shown subset.
  const earned = detail.earnedCents;
  const spent = detail.spentCents;
  const hasTxnTotals = earned !== 0 || spent !== 0;
  const unshown = unshownText(detail);

  return (
    <div className="jn-links">
      {memories.length > 0 && (
        <div className="jn-links-group">
          <div className="jn-links-label">🧭 Memories &amp; Tasks</div>
          {memories.map((l) => (
            <button key={`${l.kind}-${l.refId}`} className="jn-link-row" onClick={() => onFocus?.(l.refId)} title="Find it in the galaxy">
              {l.label}
            </button>
          ))}
        </div>
      )}
      {goals.length > 0 && (
        <div className="jn-links-group">
          <div className="jn-links-label">🎯 Goals</div>
          {goals.map((l) => (
            <div key={`goal-${l.refId}`} className="jn-link-row">
              {l.label}
            </div>
          ))}
        </div>
      )}
      {(income.length > 0 || expense.length > 0 || hasTxnTotals) && (
        <div className="jn-links-group">
          <div className="jn-links-label">💵 Transactions</div>
          {[...income, ...expense].map((l) => (
            <div key={`${l.kind}-${l.refId}`} className="jn-link-row jn-link-txn">
              <span>{l.label}</span>
              <strong className={l.kind === "income" ? "jn-earn" : "jn-spend"}>
                {l.kind === "income" ? "+" : "-"}{fmt(l.amount ?? 0)}
              </strong>
            </div>
          ))}
          <div className="jn-links-total">
            <strong className="jn-earn">+{fmt(earned)} earned</strong> · <strong className="jn-spend">-{fmt(spent)} spent</strong>
          </div>
        </div>
      )}
      {bills.length > 0 && (
        <button
          className="jn-links-note"
          style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, font: "inherit", color: "inherit" }}
          onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "tab", value: "money" } }))}
          title="Open Money to see these bills"
        >
          📅 {bills.length} recurring bill{bills.length !== 1 ? "s" : ""} linked
        </button>
      )}
      {unshown && <p className="jn-hint">{unshown}</p>}
      {links.length > 0 && links.length < detail.totalCount && (
        <p className="jn-hint">Showing {links.length} of {detail.totalCount} linked</p>
      )}
    </div>
  );
}

const KIND_NOUN: Record<string, [string, string]> = {
  task: ["task", "tasks"],
  chat: ["chat", "chats"],
  achievement: ["achievement", "achievements"],
  node: ["memory", "memories"],
  goal: ["goal", "goals"],
  insight: ["insight", "insights"],
  doc: ["document", "documents"],
  income: ["income entry", "income entries"],
  expense: ["expense entry", "expense entries"],
  bill: ["bill", "bills"],
};

/** IM-86: links that exist but produced no displayable summary (kinds with no
 *  source table to hydrate from — task/chat/achievement — and dangling refs) are
 *  stated plainly, so the detail never reads "nothing here" while the header
 *  counts them. Returns null when everything linked is shown. */
function unshownText(detail: JourneyLinksDetail): string | null {
  const parts = Object.entries(detail.unshownByKind)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([kind, n]) => {
      const count = n as number;
      const noun = KIND_NOUN[kind];
      return `${count} ${noun ? (count === 1 ? noun[0] : noun[1]) : kind}`;
    });
  return parts.length > 0 ? `Also linked but not shown in detail here: ${parts.join(", ")}.` : null;
}
