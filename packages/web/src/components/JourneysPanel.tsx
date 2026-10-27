import { useEffect, useRef, useState } from "react";
import type { Journey, JourneyLinkSummary, JourneyLinksDetail } from "@brain/shared";
import { getJourneys, getJourney, createJourney, patchJourney, deleteJourney, journeyLinks } from "../api/journeys.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { prefersReducedMotion } from "../graph/motion.js";
import {
  JOURNEY_COLORS,
  filterAndSortJourneys,
  formatJourneyDate,
  nextIconValue,
  nextStepFor,
  type JourneySort,
  type JourneyStatusFilter,
} from "./journeysPanelHelpers.js";
import { JourneyLinkPicker } from "./JourneyLinkPicker.js";

/**
 * Journeys (Vision 2.0) — the highest-level organizer: a life chapter everything can belong to
 * (Become an RN, Recover Financially, Buy My First Home…). This panel is the home for creating +
 * tending them; linking objects to a journey happens from those objects (a memory's inspector, a
 * transaction, etc.) AND from the in-card picker (IM-88). Mobile-first. See docs/VISION_2_JOURNEYS.md.
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
  // IM-85: the create form used to collect icon + title only, although the server
  // has always accepted description (≤2000) + color — both are collected now.
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | undefined>(undefined);
  // REG-161/JN-04: the explicit span dates the server has always accepted
  // (startedAt/endedAt) — collected here so a journey's span is settable,
  // not API-only. Bare calendar dates, stored as given.
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  // IM-88: search / status filter / sort over the panel's own lists.
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<JourneyStatusFilter>("all");
  const [sort, setSort] = useState<JourneySort>("recent");

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

  const add = async (t: string, ic: string, desc?: string, col?: string, spanStart?: string, spanEnd?: string) => {
    if (!t.trim()) return;
    const created = await createJourney({
      title: t.trim(),
      icon: ic.trim() || "🧭",
      ...(desc?.trim() ? { description: desc.trim() } : {}),
      ...(col ? { color: col } : {}),
      ...(spanStart ? { startedAt: spanStart } : {}),
      ...(spanEnd ? { endedAt: spanEnd } : {}),
    });
    if (!created) {
      pushToast("Couldn't create that Journey — try again.", "⚠️", 3500);
      return;
    }
    setTitle(""); setDescription(""); setColor(undefined); setStartedAt(""); setEndedAt(""); setAdding(false);
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
  const shownActive = filterAndSortJourneys(active, query, statusFilter, sort);
  const shownDone = filterAndSortJourneys(done, query, statusFilter, sort);

  return (
    <div className="jn-panel">
      <div className="jn-intro">
        A <strong>Journey</strong> is a meaningful chapter of your life. Memories, money, tasks and goals
        all connect through it — so instead of "where do I save this?", the question becomes
        "<em>what Journey does this move forward?</em>"
      </div>

      {journeys.length > 1 && (
        <div className="jn-toolbar">
          <input
            className="jn-search"
            placeholder="Search journeys…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search journeys"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as JourneyStatusFilter)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="done">Done</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as JourneySort)} aria-label="Sort journeys">
            <option value="recent">Recently updated</option>
            <option value="title">Title A–Z</option>
            <option value="progress">Progress</option>
            <option value="links">Most linked</option>
          </select>
        </div>
      )}

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

      {/* REG-165/JN-08: the no-match hint is keyed on BOTH lists being empty
          under the filter — the old check looked at the active list only, so
          filter "Done" printed "No journeys match" directly above the matching
          completed journeys. It still shows when journeys exist but none match. */}
      {(query.trim() !== "" || statusFilter !== "all") && shownActive.length === 0 && shownDone.length === 0 && journeys.length > 0 && (
        <p className="jn-hint">No journeys match your search/filter.</p>
      )}

      {shownActive.map((j) => <JourneyCard key={j.id} j={j} onChanged={refresh} onFocus={onFocus} focusJourney={focusJourney} onAskJourney={onAskJourney} />)}

      {adding ? (
        <div className="jn-form">
          <div className="jn-form-row">
            <input
              className="jn-icon-in"
              value={icon}
              // IM-89: grapheme-aware — one code point truncated ZWJ/flag emoji
              // mid-sequence (see firstGrapheme/nextIconValue in the helpers).
              onChange={(e) => setIcon(nextIconValue(icon, e.target.value))}
              aria-label="Icon"
            />
            <input className="jn-title-in" placeholder="Name your journey (e.g. Become an RN)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Journey title" />
          </div>
          <textarea
            className="jn-desc-in"
            placeholder="What is this chapter about? (optional)"
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Description"
          />
          <JourneyColorPicker value={color} onChange={setColor} />
          <div className="jn-form-row">
            <label className="jn-date-field">
              <span>Starts</span>
              <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} aria-label="Journey start date" />
            </label>
            <label className="jn-date-field">
              <span>Ends</span>
              <input type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} aria-label="Journey end date" />
            </label>
          </div>
          <div className="jn-form-actions">
            <button className="jn-primary" onClick={() => add(title, icon, description, color, startedAt || undefined, endedAt || undefined)}>Create</button>
            <button className="jn-secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="jn-primary jn-add" onClick={() => setAdding(true)}>＋ New Journey</button>
      )}

      {shownDone.length > 0 && (
        <details className="jn-done">
          <summary>Completed ({shownDone.length})</summary>
          {shownDone.map((j) => <JourneyCard key={j.id} j={j} onChanged={refresh} onFocus={onFocus} onAskJourney={onAskJourney} />)}
        </details>
      )}
    </div>
  );
}

/** IM-85 colour picker: preset swatches + a native colour input for anything
 *  else + an explicit "No colour" choice. Shared by the create and edit forms. */
function JourneyColorPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="jn-color-row" role="group" aria-label="Colour">
      <span className="jn-color-label">Colour</span>
      <button
        type="button"
        className={`jn-swatch none${value === undefined ? " sel" : ""}`}
        onClick={() => onChange(undefined)}
        aria-label="No colour"
        aria-pressed={value === undefined}
      >
        ∅
      </button>
      {JOURNEY_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`jn-swatch${value === c.value ? " sel" : ""}`}
          style={{ background: c.value }}
          onClick={() => onChange(c.value)}
          aria-label={`Colour ${c.label}`}
          aria-pressed={value === c.value}
        />
      ))}
      <input
        type="color"
        className="jn-color-in"
        value={value ?? "#5bd6ff"}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Custom colour"
      />
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
  // IM-89 decision — USE getJourney(id) in the detail view (not remove it):
  // it was the one journeys read with zero web callers while the detail was
  // assembled from the list row alone. The detail now loads the journey's own
  // record on open and renders description/colour/dates from it; local merges
  // below keep it fresh after edits made from this same card.
  const [detailJourney, setDetailJourney] = useState<Journey | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editIcon, setEditIcon] = useState("🧭");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState<string | undefined>(undefined);
  // REG-161/JN-04: the explicit span dates, editable from the card.
  const [editStartedAt, setEditStartedAt] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");

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

  const loadLinks = async (isCancelled: () => boolean) => {
    const result = await journeyLinks(j.id);
    if (isCancelled()) return;
    if (result) setLinks(result);
    else { setLinks(null); setLinksError(true); }
  };

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setLinksError(false);
      void loadLinks(() => cancelled);
      void getJourney(j.id).then((result) => {
        if (cancelled || !result) return;
        const { links: _rawLinks, ...journey } = result;
        setDetailJourney(journey);
      });
    } else {
      // Reset so re-opening shows "Loading…" rather than a stale list from last time.
      setLinks(null);
      setDetailJourney(null);
      setEditing(false);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // IM-85 edit flow: every field the server accepts (title/icon/description/
  // colour) is editable from the detail view, through the same patchJourney
  // the status/progress controls already use.
  const startEdit = () => {
    const src = detailJourney ?? j;
    setEditTitle(src.title);
    setEditIcon(src.icon ?? "🧭");
    setEditDescription(src.description ?? "");
    setEditColor(src.color);
    setEditStartedAt(src.startedAt ?? "");
    setEditEndedAt(src.endedAt ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) {
      pushToast("A Journey needs a title.", "⚠️", 3500);
      return;
    }
    const updated = await patchJourney(j.id, {
      title: editTitle.trim(),
      icon: editIcon.trim() || "🧭",
      description: editDescription.trim(),
      // "" clears the colour server-side (an omitted/undefined field would
      // leave the old colour in place — see JourneysRepo.update's merge).
      color: editColor ?? "",
      // REG-161/JN-04: blank clears the explicit span date (null), a picked
      // date sets it; omitted would leave a stale span in place.
      startedAt: editStartedAt || null,
      endedAt: editEndedAt || null,
    });
    if (!updated) {
      pushToast("Couldn't save those changes — try again.", "⚠️", 3500);
      return;
    }
    setDetailJourney((prev) => (prev ? { ...prev, ...updated } : updated));
    setEditing(false);
    pushToast("Journey updated", "🧭", 3000);
    onChanged();
  };

  const dj = detailJourney ?? j;
  const created = formatJourneyDate(dj.createdAt);
  const updated = formatJourneyDate(dj.updatedAt);
  // REG-161/JN-04: the card's start line reflects the span start — an explicit
  // startedAt IS the span start (spanFor: explicit wins), so it is shown as
  // "Started"; without one, the line is honestly relabeled "Created" (the
  // record's creation date, not the span — the link-inferred span start lives
  // on the Chronicle band). An explicit end date is shown whenever present.
  const spanStart = dj.startedAt ? formatJourneyDate(dj.startedAt) : null;
  const spanEnd = dj.endedAt ? formatJourneyDate(dj.endedAt) : null;
  // REG-160/JN-03: the missions-completed count the server ships on every
  // list/get payload — displayed so the derived progress share is checkable
  // against the bar.
  const missionsDone = dj.missionsCompleted ?? j.missionsCompleted;
  const nextStep = links
    ? nextStepFor({
        status: j.status,
        pct,
        totalCount: links.totalCount,
        taskCount: links.links.filter((l) => l.kind === "task").length,
        goalCount: links.links.filter((l) => l.kind === "goal").length,
      })
    : null;

  return (
    <div ref={cardRef} className={`jn-card ${j.status}`} style={dj.color ? { borderLeft: `4px solid ${dj.color}` } : undefined}>
      <button className="jn-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="jn-icon">{dj.icon ?? "🧭"}</span>
        <span className="jn-name">{dj.title}</span>
        {/* Paused/done used to be distinguished ONLY by a subtle 0.6/0.7 opacity
            on the whole card — invisible at a glance, especially collapsed. */}
        {j.status === "paused" && <span className="jn-status-badge paused">⏸ Paused</span>}
        {j.status === "done" && <span className="jn-status-badge done">✓ Done</span>}
        <span className="jn-link-count">{j.linkCount ?? 0} linked</span>
      </button>
      <div className="jn-bar" aria-label={`${pct}% progress`}>
        <div className="jn-bar-fill" style={{ width: `${pct}%`, ...(dj.color ? { background: dj.color } : {}) }} />
      </div>
      {open && (
        <div className="jn-detail">
          {/* REG-161/JN-04: explicit span dates are visible on the card when
              present; otherwise the creation date is labeled as created, not
              as the journey's start. "Last moved" is the record's updatedAt —
              links and edits both touch it server-side. */}
          {(created || updated || spanStart) && (
            <p className="jn-meta">
              {spanStart ? <>Started {spanStart}</> : created ? <>Created {created}</> : null}
              {spanEnd && <> · Ends {spanEnd}</>}
              {((spanStart || created) && updated) && <> · </>}
              {updated && <>Last moved {updated}</>}
            </p>
          )}
          {/* REG-160/JN-03: missions completed — the count behind the bar. */}
          {missionsDone != null && missionsDone > 0 && (
            <p className="jn-meta">🧭 {missionsDone} mission{missionsDone === 1 ? "" : "s"} completed</p>
          )}
          {editing ? (
            <div className="jn-form">
              <div className="jn-form-row">
                <input
                  className="jn-icon-in"
                  value={editIcon}
                  onChange={(e) => setEditIcon(nextIconValue(editIcon, e.target.value))}
                  aria-label="Icon"
                />
                <input className="jn-title-in" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="Journey title" />
              </div>
              <textarea
                className="jn-desc-in"
                value={editDescription}
                maxLength={2000}
                rows={3}
                onChange={(e) => setEditDescription(e.target.value)}
                aria-label="Description"
                placeholder="What is this chapter about? (optional)"
              />
              <JourneyColorPicker value={editColor} onChange={setEditColor} />
              <div className="jn-form-row">
                <label className="jn-date-field">
                  <span>Starts</span>
                  <input type="date" value={editStartedAt} onChange={(e) => setEditStartedAt(e.target.value)} aria-label="Journey start date" />
                </label>
                <label className="jn-date-field">
                  <span>Ends</span>
                  <input type="date" value={editEndedAt} onChange={(e) => setEditEndedAt(e.target.value)} aria-label="Journey end date" />
                </label>
              </div>
              <div className="jn-form-actions">
                <button className="jn-primary" onClick={() => void saveEdit()}>Save changes</button>
                <button className="jn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {dj.description && <p className="jn-desc">{dj.description}</p>}
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
              {nextStep && <p className="jn-next-step">{nextStep}</p>}
              <div className="jn-detail-actions">
                {onAskJourney && (
                  <button className="jn-secondary" onClick={() => onAskJourney({ id: j.id, title: j.title })}>
                    💬 Ask Soumaya
                  </button>
                )}
                <button className="jn-secondary" onClick={startEdit}>✏️ Edit</button>
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
            </>
          )}
          <JourneyLinksSection
            detail={links}
            linksError={linksError}
            journeyId={j.id}
            onFocus={onFocus}
            onLinksChanged={() => { void loadLinks(() => false); onChanged(); }}
          />
        </div>
      )}
    </div>
  );
}

const fmt = (cents: number): string => (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

/** The small date shown on a linked row (IM-88): the item's own date when it
 *  has one, otherwise the date it was linked. */
function linkDate(l: JourneyLinkSummary): string | null {
  const own = formatJourneyDate(l.occurredAt);
  if (own) return own;
  const linked = formatJourneyDate(l.linkedAt);
  return linked ? `linked ${linked}` : null;
}

/** Everything linked to a Journey — memories/tasks with fly-to, transactions with
 *  earned/spent totals. The totals come from the server's aggregate over ALL links
 *  (IM-87), never from summing the display-capped rows shown here. A linked bill
 *  shows as a separate note rather than folding into the total: it's a recurring
 *  schedule, not a dated transaction. */
function JourneyLinksSection({
  detail,
  linksError,
  journeyId,
  onFocus,
  onLinksChanged,
}: {
  detail: JourneyLinksDetail | null;
  linksError?: boolean;
  journeyId: number;
  onFocus?: (id: number) => void;
  onLinksChanged: () => void;
}) {
  if (linksError) return <p className="jn-hint">⚠️ Couldn't load what's linked — try reopening this Journey.</p>;
  if (detail === null) return <p className="jn-hint">Loading what's linked…</p>;
  const { links } = detail;
  const linkedKeys = new Set(links.map((l) => `${l.kind}:${l.refId}`));
  const picker = <JourneyLinkPicker journeyId={journeyId} linkedKeys={linkedKeys} onLinked={onLinksChanged} />;
  if (detail.totalCount === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
        <p className="jn-hint" style={{ margin: 0 }}>
          Nothing linked yet — connect a memory, task, or transaction from where you're already working, or right here:
        </p>
        <button
          className="mini"
          onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "panel", value: "ingest" } }))}
        >
          ➕ Dump a thought to link here
        </button>
        {picker}
      </div>
    );
  }
  const memories = links.filter((l) => l.kind === "node" || l.kind === "insight" || l.kind === "doc");
  // IM-86 remainder: tasks/chats/achievements are hydrated server-side into
  // per-link summaries (real node labels for tasks that resolve; a generic
  // label + the link's own date where no source row exists) — they render as
  // their own groups here and no longer fall into the "also linked" count.
  const tasks = links.filter((l) => l.kind === "task");
  const chats = links.filter((l) => l.kind === "chat");
  const achievements = links.filter((l) => l.kind === "achievement");
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

  const datedRow = (l: JourneyLinkSummary, children?: React.ReactNode) => {
    const d = linkDate(l);
    return (
      <>
        <span>{l.label}</span>
        {children}
        {d && <span className="jn-link-date">{d}</span>}
      </>
    );
  };

  return (
    <div className="jn-links">
      {memories.length > 0 && (
        <div className="jn-links-group">
          <div className="jn-links-label">🧭 Memories &amp; Insights</div>
          {memories.map((l) => (
            <button key={`${l.kind}-${l.refId}`} className="jn-link-row" onClick={() => onFocus?.(l.refId)} title="Find it in the galaxy">
              {datedRow(l)}
            </button>
          ))}
        </div>
      )}
      {tasks.length > 0 && (
        <div className="jn-links-group">
          <div className="jn-links-label">✅ Tasks</div>
          {tasks.map((l) =>
            l.nodeRefId != null ? (
              <button key={`task-${l.refId}`} className="jn-link-row" onClick={() => onFocus?.(l.nodeRefId!)} title="Find it in the galaxy">
                {datedRow(l)}
              </button>
            ) : (
              <div key={`task-${l.refId}`} className="jn-link-row">{datedRow(l)}</div>
            ),
          )}
        </div>
      )}
      {goals.length > 0 && (
        <div className="jn-links-group">
          <div className="jn-links-label">🎯 Goals</div>
          {goals.map((l) => (
            <div key={`goal-${l.refId}`} className="jn-link-row">
              {datedRow(l)}
            </div>
          ))}
        </div>
      )}
      {chats.length > 0 && (
        <div className="jn-links-group">
          <div className="jn-links-label">💬 Chats</div>
          {chats.map((l) => (
            <div key={`chat-${l.refId}`} className="jn-link-row">{datedRow(l)}</div>
          ))}
        </div>
      )}
      {achievements.length > 0 && (
        <div className="jn-links-group">
          <div className="jn-links-label">🏆 Achievements</div>
          {achievements.map((l) => (
            <div key={`achievement-${l.refId}`} className="jn-link-row">{datedRow(l)}</div>
          ))}
        </div>
      )}
      {(income.length > 0 || expense.length > 0 || hasTxnTotals) && (
        <div className="jn-links-group">
          <div className="jn-links-label">💵 Transactions</div>
          {[...income, ...expense].map((l) => (
            <div key={`${l.kind}-${l.refId}`} className="jn-link-row jn-link-txn">
              <span>{l.label}</span>
              {/* IM-88: the server has always sent occurredAt for transactions;
                  the panel used to drop it. Date-only values render as that
                  local calendar date (see formatJourneyDate). */}
              {formatJourneyDate(l.occurredAt) && <span className="jn-link-date">{formatJourneyDate(l.occurredAt)}</span>}
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
      {picker}
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

/** IM-86: links that exist but produced no displayable summary (after the
 *  remainder work: dangling refs of the hydratable kinds, whose target row is
 *  gone) are stated plainly, so the detail never reads "nothing here" while the
 *  header counts them. Returns null when everything linked is shown. */
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
