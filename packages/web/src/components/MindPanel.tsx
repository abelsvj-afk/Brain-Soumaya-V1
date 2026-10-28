import { useEffect, useMemo, useState } from "react";
import {
  COGNITIVE_KINDS,
  COGNITIVE_META,
  skillTier,
  IDEA_PROMOTE_SUPPORT,
  WORKING_MEMORY_DECAY_PER_HOUR,
  THOUGHT_SOURCE_COLOR,
  visionRequirementCents,
  type CognitiveKind,
  type WealthSummary,
} from "@brain/shared";
import { getWealthSummary, getWealthSummaryResult, patchGoal } from "../api/finance.js";
import { parseTolerantMs } from "../utils/dueReminders.js";
import { spaceLocalDay, visionTargetDateKey, formatCalendarDate } from "../utils/localDay.js";
import {
  getCognitiveResult,
  createCognitive,
  getUpcomingEventsResult,
  type UpcomingEvent,
  setCognitiveProgress,
  updateCognitive,
  promoteIdea,
  splitIdea,
  mergeIdeas,
  unlinkCognitive,
  pruneCognitive,
  getCognitiveEvidence,
  getPersonProfile,
  getPersonSuggestionsResult,
  dismissPersonSuggestion,
  type CognitiveEvidence,
  type PersonProfile,
  type CognitiveItem,
  getThoughtsResult,
  addThought,
  reinforceThought,
  promoteThought,
  dismissThought,
  editThought,
  deleteNode,
  type Thought,
} from "../api/client.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { fmtBrowseDate, emotionBucketOf, BROWSE_EMOTION_LABEL } from "../utils/browseFormat.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { mindSpaceEnabled, setMindSpaceEnabled } from "./MindSpace.js";
import { MemoryAttachments } from "./MemoryAttachments.js";

/** Same formatting convention as WealthPanel.tsx's own local `fmt` — kept local here
 *  too rather than extracted, since it's a one-line wrapper around Intl formatting. */
const fmt = (cents: number): string => (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

/** IM-48: a future event's absolute local date ("Fri, Nov 6, 2026") — the card used
 *  to show ONLY the relative "in Nd / overdue Nd", so the actual day was nowhere in
 *  the tab. Parsed via the shared tolerant parser; "" when unparseable (never raw). */
const fmtEventDate = (raw?: string | null): string => {
  if (!raw) return "";
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

/** IM-49: human names for the working-memory source colours (THOUGHT_SOURCE_COLOR).
 *  The dot colour was the ONLY encoding and it was explained nowhere in the tab. */
const THOUGHT_SOURCE_LABEL: Record<string, string> = {
  manual: "held by you",
  chat: "surfaced in chat",
  goal: "goal-driven",
  priority: "a priority",
  emotion: "a feeling",
};

/**
 * The Mind tab — the COGNITIVE LAYER. Beyond what you've remembered, this is what
 * you're pursuing and becoming: goals your memories drift toward, ideas, skills
 * that level up, the people you orbit, your identity, your mental models. Each is
 * a first-class body in the galaxy (colour/icon from the single-source
 * COGNITIVE_META). Create them here; Soumaya then pulls related memories into
 * their orbit over time.
 */
export function MindPanel({
  onFocus,
  onChanged,
}: {
  onFocus: (id: number) => void;
  /** Refresh the galaxy after a new cognitive body is charted (so it appears). */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<CognitiveItem[]>([]);
  // Batch L (MIN-06, REG-137) — the TRUE mapped total, independent of the
  // 100-row page getCognitiveResult returns. The search placeholder and the
  // truncation line read this, never items.length, so a capped list can't
  // present its returned count as the mapped count.
  const [totalItems, setTotalItems] = useState(0);
  // True when the cognitive-list fetch itself FAILED (server dead/slow/errored),
  // as opposed to succeeding with an empty list — the two render differently
  // (error + Retry vs "Nothing mapped yet"), so a dead server can no longer
  // masquerade as an empty mind. Only the cognitive list tracks this; the
  // panel's optional sources (thoughts, suggestions, events) stay fail-soft.
  const [loadError, setLoadError] = useState(false);
  // IM-45: the same truthful-state treatment for the panel's OTHER refreshes —
  // working memory, people suggestions, and upcoming events each track their own
  // failure so a dead server can't render as a clear mind space / no suggestions
  // / dateless events. `loading` covers the first cognitive fetch (no skeleton
  // existed at all: first paint was indistinguishable from an empty mind).
  const [loading, setLoading] = useState(true);
  const [thoughtsError, setThoughtsError] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  // IM-47: search + kind filter + sort across the cognitive list (Browse→All pattern).
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<CognitiveKind | "all">("all");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "progress" | "links">("recent");
  // IM-48: which capped evidence/interaction lists are expanded ("+N more").
  const [expandedLists, setExpandedLists] = useState<Record<string, boolean>>({});
  // IM-50: delete goes through the shared ConfirmDialog, never window.confirm.
  const [pendingDelete, setPendingDelete] = useState<CognitiveItem | null>(null);
  // IM-136: idea split (per-idea inline form) + merge (two-idea selection).
  const [splitFor, setSplitFor] = useState<number | null>(null);
  const [splitLabel, setSplitLabel] = useState("");
  const [splitContent, setSplitContent] = useState("");
  const [pendingSplit, setPendingSplit] = useState<CognitiveItem | null>(null);
  const [mergeSelection, setMergeSelection] = useState<number[]>([]);
  const [pendingMerge, setPendingMerge] = useState(false);
  const [kind, setKind] = useState<CognitiveKind>("goal");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [aliasText, setAliasText] = useState(""); // comma-separated aliases (create)
  const [editAliases, setEditAliases] = useState(""); // comma-separated aliases (edit)
  const [showHelp, setShowHelp] = useState(false); // "how the Mind works" explainer
  const [eventDate, setEventDate] = useState(""); // for future_event
  const [events, setEvents] = useState<Record<number, UpcomingEvent>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // Inline editing of a cognitive object (label + content).
  const [editId, setEditId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editContent, setEditContent] = useState("");
  // Working memory (the mind space): live thoughts you're holding right now.
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [thought, setThought] = useState("");
  const [ambient, setAmbient] = useState(mindSpaceEnabled());
  // A thought mid-way through dissolving into a real memory — gives the fade/reinforce
  // loop a felt ending instead of just vanishing on the next poll. Scoped to THIS list
  // only (not mirrored to the ambient MindSpace overlay): promoting only happens via a
  // button here, so MindSpace is always hidden at the instant it would fire — see the
  // comment in MindSpace.tsx.
  const [settlingIds, setSettlingIds] = useState<Set<number>>(new Set());
  const SETTLE_MS = 650;
  const settleThenRefresh = (id: number) => {
    setSettlingIds((s) => new Set(s).add(id));
    window.setTimeout(() => {
      setSettlingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      void refreshThoughts();
    }, SETTLE_MS);
  };
  // Inline editing of a working-memory thought.
  const [editThoughtId, setEditThoughtId] = useState<number | null>(null);
  const [editThoughtText, setEditThoughtText] = useState("");
  // Identity evidence (Phase 5): lazy-loaded per identity when expanded.
  const [evidence, setEvidence] = useState<Record<number, CognitiveEvidence>>({});
  const [evidenceOpen, setEvidenceOpen] = useState<number | null>(null);
  // Batch L (MIN-07, REG-138) — lazy expansions carry their own truthful
  // state: loading / error-with-retry, never blank-on-failure. The primary
  // reads solved exactly this (strict Results + error + Retry); the lazy
  // reads one level down did not inherit it.
  const [evidenceStatus, setEvidenceStatus] = useState<Record<number, "loading" | "error">>({});
  // People (Phase 6): CRM profiles (lazy) + "people you mention" suggestions.
  const [profiles, setProfiles] = useState<Record<number, PersonProfile>>({});
  const [profileOpen, setProfileOpen] = useState<number | null>(null);
  const [profileStatus, setProfileStatus] = useState<Record<number, "loading" | "error">>({});
  const [suggestions, setSuggestions] = useState<{ name: string; count: number }[]>([]);
  // Life Vision (docs/specs/life-vision.md): target date on the edit form, and the
  // "Financial Goals" section — reuses the existing Wealth summary (already-computed
  // fillPct/totalCents per goal), no separate Vision-specific finance calculation.
  const [editDate, setEditDate] = useState(""); // life_vision only — YYYY-MM-DD
  const [visionGoalsOpen, setVisionGoalsOpen] = useState<number | null>(null);
  const [wealth, setWealth] = useState<WealthSummary | null>(null);
  // Batch L (MIN-07): the Financial Goals expansion's own truthful state —
  // a failed Wealth fetch is an error + Retry, never an unbounded "Loading…".
  const [wealthState, setWealthState] = useState<"idle" | "loading" | "error">("idle");
  const [goalBusy, setGoalBusy] = useState<number | null>(null); // goal id mid-link/unlink
  const [pickGoalId, setPickGoalId] = useState<Record<number, string>>({}); // per-vision picker selection

  const refresh = () =>
    getCognitiveResult()
      .then((r) => {
        if (r.ok) {
          setItems(r.items);
          setTotalItems(r.total ?? r.items.length);
          setLoadError(false);
        } else {
          // Keep whatever is already on screen; just flag the failure so the
          // render can say so (and offer Retry) instead of going silently empty.
          setLoadError(true);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  // IM-45: working memory / suggestions / events keep their last good data on
  // failure and flag it (error + Retry in the render) — never fail-soft to empty.
  const refreshThoughts = () =>
    getThoughtsResult()
      .then((r) => {
        if (r.ok) {
          setThoughts(r.thoughts);
          setThoughtsError(false);
        } else setThoughtsError(true);
      })
      .catch(() => setThoughtsError(true));
  const refreshSuggestions = () =>
    getPersonSuggestionsResult()
      .then((r) => {
        if (r.ok) {
          setSuggestions(r.suggestions);
          setSuggestionsError(false);
        } else setSuggestionsError(true);
      })
      .catch(() => setSuggestionsError(true));
  const refreshEvents = () =>
    getUpcomingEventsResult()
      .then((r) => {
        if (r.ok) {
          setEvents(Object.fromEntries(r.events.map((e) => [e.id, e])));
          setEventsError(false);
        } else setEventsError(true);
      })
      .catch(() => setEventsError(true));
  useEffect(() => {
    refresh();
    refreshThoughts();
    refreshSuggestions();
    refreshEvents();
    // Thoughts decay server-side; poll gently so the mind space stays live.
    const t = setInterval(refreshThoughts, 20_000);
    return () => clearInterval(t);
  }, []);

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      // Batch L (MIN-01, REG-132): a Life Vision target date is DATE-ONLY
      // (docs/specs/life-vision.md §9 — no time-of-day meaning). Pass the
      // picked YYYY-MM-DD straight through, never via new Date().toISOString()
      // (UTC midnight), which rendered one day early in America/New_York.
      // future_event keeps the instant conversion — its wall-clock semantics
      // are DB-8's open owner decision, untouched here.
      const iso =
        kind === "future_event" && eventDate
          ? new Date(eventDate).toISOString()
          : kind === "life_vision" && eventDate
            ? eventDate
            : undefined;
      const aliases = aliasText.split(",").map((t) => t.trim()).filter(Boolean);
      const r = await createCognitive(kind, label.trim(), content.trim() || undefined, iso, aliases.length ? aliases : undefined);
      if (r) {
        playSfx("achievement");
        pushToast(`${COGNITIVE_META[kind].icon} ${COGNITIVE_META[kind].label} added to your galaxy`, "🧠", 4500);
        setLabel("");
        setContent("");
        setAliasText("");
        setEventDate("");
        setAdding(false);
        await refresh();
        if (kind === "future_event") await refreshEvents();
        onChanged?.(); // reload the galaxy so the new body appears + is focusable
      } else {
        pushToast("Couldn't add that — try again.", "⚠️", 4000);
      }
    } finally {
      setBusy(false);
    }
  };

  const bumpProgress = async (it: CognitiveItem, delta: number) => {
    const prev = it.progress ?? 0;
    const next = Math.max(0, Math.min(1, prev + delta));
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, progress: next } : x)));
    // IM-50: honour the save result — the bar used to keep showing a value the
    // server never stored when the write failed. Roll back + say so.
    const ok = await setCognitiveProgress(it.id, next);
    if (!ok) {
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, progress: prev } : x)));
      pushToast("Couldn't save that progress — the bar is back where it was.", "⚠️", 3500);
    }
  };

  const startEdit = (it: CognitiveItem) => {
    setEditId(it.id);
    setEditLabel(it.label);
    setEditContent(it.content ?? "");
    setEditAliases((it.aliases ?? []).join(", "));
    // Target date editing only exists for life_vision (C3.2-locked) — future_event's
    // date stays creation-time only, so there's nothing to seed for any other kind.
    setEditDate(it.kind === "life_vision" && it.remindAt ? it.remindAt.slice(0, 10) : "");
  };
  const saveEdit = async () => {
    if (editId == null || !editLabel.trim()) return;
    const aliases = editAliases.split(",").map((t) => t.trim()).filter(Boolean);
    const editingVision = items.find((x) => x.id === editId)?.kind === "life_vision";
    const patch: { label: string; content: string; aliases: string[]; date?: string | null } = {
      label: editLabel.trim(),
      content: editContent.trim(),
      aliases,
    };
    // Batch L (MIN-01): the edit path keeps the date date-only too — the
    // picked YYYY-MM-DD goes straight through, never via a UTC-midnight
    // instant (see add() above). null clears a previously-set date.
    if (editingVision) patch.date = editDate ? editDate : null;
    const ok = await updateCognitive(editId, patch);
    setEditId(null);
    if (ok) {
      playSfx("tap");
      await refresh();
      onChanged?.(); // label/links changed → refresh the galaxy
    } else {
      pushToast("Couldn't save that edit — try again.", "⚠️", 3500);
    }
  };
  // Batch L (MIN-07): the Wealth summary behind the Financial Goals
  // expansion, fetched as a strict Result — a failed fetch is an error state
  // with Retry, never a null that reads as "still loading".
  const loadWealth = async () => {
    setWealthState("loading");
    const r = await getWealthSummaryResult();
    if (r.ok) {
      setWealth(r.summary);
      setWealthState("idle");
    } else {
      setWealthState("error");
    }
  };
  const toggleVisionGoals = async (it: CognitiveItem) => {
    if (visionGoalsOpen === it.id) {
      setVisionGoalsOpen(null);
      return;
    }
    setVisionGoalsOpen(it.id);
    if (!wealth) void loadWealth();
  };
  const linkGoal = async (visionId: number, goalId: number) => {
    setGoalBusy(goalId);
    const updated = await patchGoal(goalId, { visionNodeId: visionId });
    setGoalBusy(null);
    if (updated) {
      playSfx("tap");
      const w = await getWealthSummary();
      if (w) {
        setWealth(w);
        setWealthState("idle");
      }
      setPickGoalId((m) => ({ ...m, [visionId]: "" }));
    } else {
      pushToast("Couldn't link that Financial Goal — try again.", "⚠️", 3500);
    }
  };
  const unlinkGoal = async (visionId: number, goalId: number) => {
    setGoalBusy(goalId);
    const updated = await patchGoal(goalId, { visionNodeId: null });
    setGoalBusy(null);
    if (updated) {
      playSfx("tap");
      const w = await getWealthSummary();
      if (w) {
        setWealth(w);
        setWealthState("idle");
      }
    } else {
      pushToast("Couldn't unlink that Financial Goal — try again.", "⚠️", 3500);
    }
  };

  // ── Working memory (mind space) handlers ──────────────────────────────────
  const think = async () => {
    const text = thought.trim();
    if (!text) return;
    // CAP-09: the input used to be cleared BEFORE the save, so a failure
    // destroyed the words (Mind has no draft store). Clear only on a
    // verified save; on failure the words stay in the input.
    const r = await addThought(text);
    if (r) {
      setThought("");
      playSfx("tap");
      await refreshThoughts();
    } else if (text.length > 500) {
      // The 500-char case: "try again" with the same words can never
      // succeed — say what's actually wrong. (Working memory holds 500.)
      pushToast("That thought is too long to hold (500 characters max) — your words are still here; trim it and try again.", "⚠️", 4500);
    } else {
      pushToast("Couldn't hold that thought — your words are still here, try again.", "⚠️", 3500);
    }
  };
  const reinforce = async (t: Thought) => {
    const r = await reinforceThought(t.id);
    // Batch L (MIN-02): a null result is a FAILED Keep, not a silent refresh
    // — say so, and don't pretend the timer reset.
    if (!r) {
      pushToast("Couldn't keep that thought — try again.", "⚠️", 3500);
      return;
    }
    if (r.promotedNodeId != null) {
      playSfx("achievement");
      pushToast(`💭 A recurring thought settled into memory`, "🧠", 4500);
      onChanged?.();
      settleThenRefresh(t.id);
      return;
    }
    await refreshThoughts();
  };
  const promote = async (t: Thought) => {
    const r = await promoteThought(t.id);
    // Batch L (MIN-02): a null result is a FAILED promote, not a silent refresh.
    if (!r) {
      pushToast("Couldn't make that a memory — try again.", "⚠️", 3500);
      return;
    }
    playSfx("achievement");
    pushToast(`💭 Consolidated into your galaxy`, "🧠", 4000);
    onChanged?.();
    settleThenRefresh(t.id);
  };
  const dismiss = async (t: Thought) => {
    // Batch L (MIN-02): optimistic removal WITH rollback — the old code
    // removed the mote and ignored dismissThought's boolean, so a failed
    // dismiss read as done until the next poll resurrected the thought.
    const idx = thoughts.findIndex((x) => x.id === t.id);
    setThoughts((xs) => xs.filter((x) => x.id !== t.id));
    const ok = await dismissThought(t.id);
    if (!ok) {
      setThoughts((xs) => {
        if (xs.some((x) => x.id === t.id)) return xs;
        const next = [...xs];
        next.splice(Math.max(0, Math.min(idx, next.length)), 0, t);
        return next;
      });
      pushToast("Couldn't let go of that thought — it's still here.", "⚠️", 3500);
    }
  };
  const promoteToGoal = async (it: CognitiveItem) => {
    const ok = await promoteIdea(it.id);
    if (ok) {
      playSfx("achievement");
      pushToast(`💡→🎯 "${it.label}" is now a Goal you're committing to`, "🧠", 4500);
      await refresh();
      onChanged?.(); // kind/importance changed → refresh the galaxy
    } else {
      pushToast("Couldn't promote that — try again.", "⚠️", 3500);
    }
  };
  // Batch L (MIN-07): lazy Evidence/Profile fetches with truthful state —
  // loading, cached success, or error + Retry. The old code cached only on a
  // non-null result, so a failed fetch left an expanded header over blank
  // nothing (no spinner, error, or retry short of closing and reopening).
  const loadEvidence = async (it: CognitiveItem) => {
    setEvidenceStatus((m) => ({ ...m, [it.id]: "loading" }));
    const ev = await getCognitiveEvidence(it.id);
    if (ev) {
      setEvidence((m) => ({ ...m, [it.id]: ev }));
      setEvidenceStatus((m) => {
        const c = { ...m };
        delete c[it.id];
        return c;
      });
    } else {
      setEvidenceStatus((m) => ({ ...m, [it.id]: "error" }));
    }
  };
  const toggleEvidence = async (it: CognitiveItem) => {
    if (evidenceOpen === it.id) {
      setEvidenceOpen(null);
      return;
    }
    setEvidenceOpen(it.id);
    if (!evidence[it.id]) void loadEvidence(it);
  };
  const loadProfile = async (it: CognitiveItem) => {
    setProfileStatus((m) => ({ ...m, [it.id]: "loading" }));
    const p = await getPersonProfile(it.id);
    if (p) {
      setProfiles((m) => ({ ...m, [it.id]: p }));
      setProfileStatus((m) => {
        const c = { ...m };
        delete c[it.id];
        return c;
      });
    } else {
      setProfileStatus((m) => ({ ...m, [it.id]: "error" }));
    }
  };
  const toggleProfile = async (it: CognitiveItem) => {
    if (profileOpen === it.id) {
      setProfileOpen(null);
      return;
    }
    setProfileOpen(it.id);
    if (!profiles[it.id]) void loadProfile(it);
  };
  const unlinkOne = async (anchorId: number, memoryId: number) => {
    // Batch L (MIN-03): optimistic removal WITH rollback — the old code
    // removed the interaction, ignored unlinkCognitive's boolean, and fired
    // onChanged regardless, so a failed unlink read as done until the cached
    // profile was discarded.
    const prev = profiles[anchorId];
    if (!prev) return;
    setProfiles((m) => ({
      ...m,
      [anchorId]: { ...prev, interactions: prev.interactions.filter((i) => i.id !== memoryId), count: Math.max(0, prev.count - 1) },
    }));
    const ok = await unlinkCognitive(anchorId, memoryId);
    if (ok) {
      onChanged?.();
    } else {
      setProfiles((m) => ({ ...m, [anchorId]: prev }));
      pushToast("Couldn't unlink that memory — it's still linked.", "⚠️", 3500);
    }
  };
  const pruneLinks = async (it: CognitiveItem) => {
    // Batch L (MIN-03): pruneCognitive is a strict Result now — a failed
    // prune is { ok: false }, distinct from a verified zero. The old code
    // trusted a number the wrapper had already collapsed every failure into,
    // and certified a failed cleanup as "Nothing to clean".
    const r = await pruneCognitive(it.id);
    if (!r.ok) {
      pushToast("Couldn't check the links — try again.", "⚠️", 4000);
      return;
    }
    setProfiles((m) => {
      const c = { ...m };
      delete c[it.id];
      return c;
    }); // force re-fetch on next open
    pushToast(
      r.pruned > 0 ? `Cleaned up ${r.pruned} link${r.pruned === 1 ? "" : "s"} that didn't name ${it.label}.` : `Nothing to clean — every link names ${it.label}.`,
      "🧹",
      4000,
    );
    await refresh();
    onChanged?.();
  };
  // IM-50: deletion is confirmed via the shared ConfirmDialog (never the native
  // window.confirm) and the optimistic removal is ROLLED BACK when the delete
  // fails — deleteNode throws on failure, and the old code let that rejection
  // escape after already announcing "Removed".
  const confirmRemoveItem = async (it: CognitiveItem) => {
    setPendingDelete(null);
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    try {
      await deleteNode(it.id);
      pushToast(`Removed "${it.label}"`, "🗑️", 3000);
      onChanged?.();
    } catch {
      setItems((xs) => (xs.some((x) => x.id === it.id) ? xs : [...xs, it]));
      pushToast(`Couldn't remove "${it.label}" — it's still in your mind.`, "⚠️", 3500);
    }
  };
  // IM-136: idea split/merge (user-triggered; the server ops delete nothing —
  // split partitions support by nearness, merge unions links and folds the
  // dropped idea into an alias on the survivor, soft-deleted recoverably).
  const toggleMergeSelect = (it: CognitiveItem) => {
    setMergeSelection((sel) => {
      if (sel.includes(it.id)) return sel.filter((x) => x !== it.id);
      if (sel.length >= 2) {
        pushToast("Two ideas is a merge — deselect one first.", "💡", 3000);
        return sel;
      }
      return [...sel, it.id];
    });
  };
  const confirmSplit = async (it: CognitiveItem) => {
    setPendingSplit(null);
    const r = await splitIdea(it.id, splitLabel.trim(), splitContent.trim() || undefined);
    if (r) {
      playSfx("achievement");
      pushToast(
        `💡 "${it.label}" split — "${splitLabel.trim()}" branched off${r.moved > 0 ? ` with ${r.moved} supporting memor${r.moved === 1 ? "y" : "ies"}` : ""}. Nothing was deleted.`,
        "🧠",
        4500,
      );
      setSplitFor(null);
      setSplitLabel("");
      setSplitContent("");
      await refresh();
      onChanged?.();
    } else {
      pushToast("Couldn't split that idea — try again.", "⚠️", 3500);
    }
  };
  const confirmMerge = async () => {
    setPendingMerge(false);
    const [keepId, dropId] = mergeSelection;
    if (keepId == null || dropId == null) return;
    const keep = items.find((x) => x.id === keepId);
    const drop = items.find((x) => x.id === dropId);
    const ok = await mergeIdeas(keepId, dropId);
    if (ok) {
      playSfx("achievement");
      pushToast(`💡 "${drop?.label ?? "Idea"}" merged into "${keep?.label ?? "the other idea"}" — links unioned, nothing deleted.`, "🧠", 4500);
      setMergeSelection([]);
      await refresh();
      onChanged?.();
    } else {
      pushToast("Couldn't merge those ideas — try again.", "⚠️", 3500);
    }
  };
  const addPerson = async (name: string) => {
    const r = await createCognitive("person_entity", name);
    if (r) {
      playSfx("achievement");
      pushToast(`❤️ Added ${name} — their memories will orbit them`, "🧠", 4000);
      setSuggestions((xs) => xs.filter((s) => s.name !== name));
      await refresh();
      onChanged?.();
    } else {
      // Batch L (MIN-03): a null create used to pass in total silence.
      pushToast("Couldn't add that person — try again.", "⚠️", 3500);
    }
  };
  const notAPerson = async (name: string) => {
    // Batch L (MIN-03): the permanence promise toasts ONLY on a confirmed
    // dismiss. The old code removed the chip, ignored the boolean, and
    // promised "I won't suggest it again" before the server had agreed —
    // the next refresh could return the same name after the promise.
    const ok = await dismissPersonSuggestion(name);
    if (ok) {
      setSuggestions((xs) => xs.filter((s) => s.name !== name));
      pushToast(`Got it — "${name}" isn't a person. I won't suggest it again.`, "🚫", 3500);
    } else {
      pushToast("Couldn't dismiss that suggestion — try again.", "⚠️", 3500);
    }
  };
  const saveThoughtEdit = async () => {
    if (editThoughtId == null || !editThoughtText.trim()) return;
    const id = editThoughtId;
    const text = editThoughtText.trim();
    // Batch L (MIN-02): honour editThought's boolean — apply locally and
    // close ONLY on a confirmed save. The old code applied the text, closed
    // the editor, and ignored the result, displaying wording the server
    // never stored until the next poll silently reverted it. On failure the
    // editor stays open with the attempted words still in it.
    const ok = await editThought(id, text);
    if (ok) {
      setThoughts((xs) => xs.map((x) => (x.id === id ? { ...x, text } : x)));
      setEditThoughtId(null);
    } else {
      pushToast("Couldn't save that edit — your words are still here, try again.", "⚠️", 3500);
    }
  };

  // Life Vision (docs/specs/life-vision.md): a quiet, non-reminder read of the target
  // date for the card summary line — never "overdue" framing (that's reminder language).
  // Batch L (MIN-01, REG-132): the target date is a DATE, not an instant. The
  // stored value's written calendar date IS the target date (see
  // visionTargetDateKey in utils/localDay.ts) — rendering it through the
  // tolerant instant parser named the day before in America/New_York, and
  // the "passed" cue flipped at 20:00 ET the evening before the target day.
  // "Passed" compares calendar dates in the SPACE's timezone: the cue turns
  // only once the target date has passed; the target day itself is not passed.
  const visionDateLabel = (it: CognitiveItem): string | null => {
    if (!it.remindAt) return null;
    const key = visionTargetDateKey(it.remindAt);
    if (!key) return null;
    const passed = key < spaceLocalDay(new Date());
    const date = formatCalendarDate(key);
    return passed ? `target date passed · ${date}` : `target: ${date}`;
  };

  // IM-47: apply the search text + kind filter, then the chosen sort, before
  // grouping. Search matches label, content, and aliases (what the card shows).
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter((it) => {
      if (kindFilter !== "all" && it.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        it.label.toLowerCase().includes(q) ||
        (it.content ?? "").toLowerCase().includes(q) ||
        (it.aliases ?? []).some((a) => a.toLowerCase().includes(q))
      );
    });
    switch (sortBy) {
      case "name":
        out.sort((a, b) => a.label.localeCompare(b.label));
        break;
      case "progress":
        out.sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));
        break;
      case "links":
        out.sort((a, b) => b.degree - a.degree);
        break;
      default:
        out.sort((a, b) => b.id - a.id); // "recent" — the server's newest-first order
    }
    return out;
  }, [items, query, kindFilter, sortBy]);
  const filtersActive = query.trim() !== "" || kindFilter !== "all";

  // IM-48: capped lists (evidence 8/side, applied-to 10, interactions 12) used
  // to cut silently. `capped` returns the visible slice + the hidden count, and
  // the render pairs it with a "+N more" toggle so the overflow is reachable.
  const capped = <T,>(key: string, arr: T[], cap: number): { shown: T[]; overflow: number; expanded: boolean } => {
    const expanded = !!expandedLists[key];
    return { shown: expanded ? arr : arr.slice(0, cap), overflow: arr.length - cap, expanded };
  };
  const moreToggle = (key: string, overflow: number, expanded: boolean) =>
    overflow > 0 ? (
      <button
        className="mini ghost"
        onClick={() => setExpandedLists((m) => ({ ...m, [key]: !expanded }))}
      >
        {expanded ? "Show less" : `+${overflow} more`}
      </button>
    ) : null;

  // Group by kind, in the canonical order.
  const byKind = new Map<CognitiveKind, CognitiveItem[]>();
  for (const it of visibleItems) {
    const k = it.kind as CognitiveKind;
    if (!COGNITIVE_META[k]) continue;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(it);
  }
  const visionCount = items.filter((it) => it.kind === "life_vision").length;

  return (
    <div className="dock-body mind-panel">
      {/* ── Working memory: the ephemeral mind space (what you're thinking NOW) ── */}
      <section className="mind-ws">
        <div className="mind-ws-head">
          <h3>💭 Thinking now</h3>
          <button
            className={`mind-ws-toggle ${ambient ? "on" : ""}`}
            onClick={() => {
              const next = !ambient;
              setAmbient(next);
              setMindSpaceEnabled(next);
            }}
            title="Float these thoughts around the galaxy"
          >
            ✧ {ambient ? "In space" : "Show in space"}
          </button>
        </div>
        <p className="mind-ws-sub" style={{ textAlign: "left", marginBottom: 2 }}>
          A thought fades over a few days. Tap <b>↑ Keep</b> to reset its timer — keep returning to
          one (3×) and it becomes a permanent memory in your galaxy. <b>×</b> lets it go now.
          {/* REG-042: the 30-mote cap is stated where thoughts are captured —
              when the mind is full, the faintest thought fades to make room. */}
          {" "}Your mind holds up to 30 thoughts — when it&apos;s full, the faintest one fades to make room for the new one.
        </p>
        <div className="mind-ws-input">
          <input
            className="tag-input wide"
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void think();
            }}
            placeholder="Hold a thought in your mind…"
          />
          <button className="mini" onClick={() => void think()} disabled={!thought.trim()}>
            Hold
          </button>
        </div>
        {/* REG-040: the 500-character thought cap is visible before submit. */}
        <div className="mind-ws-count" aria-live="polite">
          {thought.length}/500
          {thought.length > 500 ? " — over the 500-character limit; trim it before holding" : ""}
        </div>
        {/* IM-49: legend for the mote source colours — the colour was the only
            encoding and it was explained nowhere in this tab. */}
        {thoughts.length > 0 && (
          <div className="mind-ws-legend" aria-label="Thought source colours">
            {Object.entries(THOUGHT_SOURCE_COLOR).map(([src, rgb]) => (
              <span key={src} className="mind-ws-legend-item">
                <span className="mind-mote-dot" style={{ background: `rgb(${rgb})` }} />
                {THOUGHT_SOURCE_LABEL[src] ?? src}
              </span>
            ))}
          </div>
        )}
        {thoughtsError && (
          <p className="empty small">
            ⚠️ Couldn't {thoughts.length > 0 ? "refresh" : "load"} your working memory —{" "}
            {thoughts.length > 0 ? "showing the last copy that loaded." : "your held thoughts aren't gone; they just didn't arrive."}{" "}
            <button className="mini" onClick={() => void refreshThoughts()}>Retry</button>
          </p>
        )}
        {thoughts.length === 0 && !thoughtsError ? (
          <p className="empty small">Your mind space is clear. Hold a thought and watch it glow — reinforce the ones that matter and Soumaya carries them into your galaxy.</p>
        ) : thoughts.length === 0 ? null : (
          <ul className="mind-ws-list">
            {thoughts.map((t) => (
              <li
                key={t.id}
                className={`mind-mote ${settlingIds.has(t.id) ? "settling" : ""}`}
                style={{ opacity: 0.4 + t.strength * 0.6 }}
                title={`Strength ${Math.round(t.strength * 100)}% · reinforced ${t.reinforceCount}×`}
              >
                <span
                  className="mind-mote-dot"
                  style={{
                    background: `rgb(${THOUGHT_SOURCE_COLOR[t.source] ?? THOUGHT_SOURCE_COLOR.manual})`,
                    boxShadow: `0 0 ${4 + t.strength * 10}px rgba(${THOUGHT_SOURCE_COLOR[t.source] ?? THOUGHT_SOURCE_COLOR.manual},${0.4 + t.strength * 0.5})`,
                  }}
                />
                {editThoughtId === t.id ? (
                  <input
                    className="tag-input wide"
                    autoFocus
                    value={editThoughtText}
                    onChange={(e) => setEditThoughtText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveThoughtEdit();
                      if (e.key === "Escape") setEditThoughtId(null);
                    }}
                    onBlur={() => void saveThoughtEdit()}
                  />
                ) : (
                  <span className="mind-mote-text">{t.text}</span>
                )}
                {editThoughtId !== t.id && (
                  <span className={`mind-mote-fade ${t.strength < 0.2 ? "low" : ""}`}>
                    {(() => {
                      const days = t.strength / (WORKING_MEMORY_DECAY_PER_HOUR * 24);
                      return days < 1 ? "fades today" : `~${Math.round(days)}d left`;
                    })()}
                  </span>
                )}
                <span className="mind-mote-actions">
                  {/* Batch L (MIN-08, REG-139): every lifecycle action carries
                      its name visibly — glyph-only + title-only names are
                      unreachable on a touch device with no hover — and the
                      targets meet the 46px standard (see index.css). */}
                  <button
                    className="mini ghost"
                    aria-label="Edit thought"
                    onClick={() => {
                      setEditThoughtId(t.id);
                      setEditThoughtText(t.text);
                    }}
                    title="Edit"
                  >
                    ✎ Edit
                  </button>
                  <button className="mini ghost" aria-label="Keep thought" onClick={() => void reinforce(t)} title="Keep it — resets the fade timer (3 keeps → becomes a memory)">↑ Keep</button>
                  <button className="mini ghost" aria-label="Make thought a memory" onClick={() => void promote(t)} title="Make it a permanent memory now">★ Promote</button>
                  <button className="mini ghost" aria-label="Let go of thought" onClick={() => void dismiss(t)} title="Let it go">× Let go</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="mind-explain-toggle" onClick={() => setShowHelp((v) => !v)}>
        {showHelp ? "▾" : "▸"} How does the Mind work?
      </button>
      {showHelp && (
        <div className="mind-explain">
          <p><b>The Mind is what you're pursuing and becoming</b> — separate from what you've just remembered.</p>
          <ul>
            <li><b>Add an entry</b> (a goal, a person, an idea, an identity…) and it becomes a body in your galaxy.</li>
            <li><b>Your memories connect to it automatically</b> — a memory that names a person, or is clearly about a goal, drifts into its orbit.</li>
            <li><b>Vague on purpose?</b> Add <b>aliases</b> (e.g. a person called "girlfriend, my girl") so memories that don't use the exact name still connect.</li>
            <li><b>She'll ask</b> when something seems related but she isn't sure — answer, connect it in one tap, or tell her it doesn't relate (she remembers).</li>
            <li><b>Goals</b> track progress · <b>skills</b> level up as you practice · <b>ideas</b> grow, merge or fade · <b>identities</b> brighten with evidence.</li>
          </ul>
        </div>
      )}
      <p className="companion-hint">
        Your mind, not just your memories: what you're <b>pursuing</b> and <b>becoming</b>. Add a
        goal, idea, skill, person, identity or mental model — Soumaya pulls related memories into its
        orbit over time.
      </p>

      {/* Phase M (docs/specs/soumaya-product-audit.md, "Life Vision discoverability") — a
          Life Vision is the top of the Life OS hierarchy (Vision -> Financial Goals -> Money)
          but was previously just the last of ten equal-weight options in the kind picker below,
          with no dedicated empty state. This card gives it a clear, contextual entry point
          without a new tab, route, or data source — it only sets the SAME `kind`/`adding` state
          the existing picker already uses, or scrolls to the SAME section already rendered below. */}
      <div className="mind-vision-entry">
        {visionCount > 0 ? (
          <button
            className="mind-vision-card"
            onClick={() => document.getElementById("mind-section-life_vision")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            <span className="mind-vision-icon">{COGNITIVE_META.life_vision.icon}</span>
            <span className="mind-vision-text">
              <b>Your Life Vision</b>
              <span>{visionCount === 1 ? "See it and its funding progress" : `${visionCount} visions — see them below`}</span>
            </span>
            <span className="mind-vision-go" aria-hidden="true">↓</span>
          </button>
        ) : (
          <button
            className="mind-vision-card"
            onClick={() => {
              setKind("life_vision");
              setAdding(true);
            }}
          >
            <span className="mind-vision-icon">{COGNITIVE_META.life_vision.icon}</span>
            <span className="mind-vision-text">
              <b>Set a Life Vision</b>
              <span>{COGNITIVE_META.life_vision.blurb}</span>
            </span>
            <span className="mind-vision-go" aria-hidden="true">＋</span>
          </button>
        )}
      </div>

      {suggestionsError && (
        <p className="empty small">
          ⚠️ Couldn't load people suggestions — Soumaya may be unreachable.{" "}
          <button className="mini" onClick={() => void refreshSuggestions()}>Retry</button>
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="mind-suggest">
          <span className="mind-suggest-label">People you mention — add them?</span>
          <div className="mind-suggest-chips">
            {suggestions.map((s) => (
              <span key={s.name} className="mind-suggest-pair">
                <button className="mind-suggest-chip" onClick={() => void addPerson(s.name)} title={`Mentioned in ${s.count} memories`}>
                  ❤️ {s.name} <span className="mind-suggest-n">{s.count}</span>
                </button>
                <button
                  className="mind-suggest-x"
                  onClick={() => void notAPerson(s.name)}
                  title={`"${s.name}" isn't a person — don't suggest it again`}
                  aria-label={`Dismiss ${s.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {adding ? (
        <div className="companion-new">
          <div className="mind-kind-row">
            {COGNITIVE_KINDS.map((k) => (
              <button
                key={k}
                className={`mind-kind ${kind === k ? "on" : ""}`}
                onClick={() => setKind(k)}
                title={COGNITIVE_META[k].blurb}
              >
                {COGNITIVE_META[k].icon} {COGNITIVE_META[k].label}
              </button>
            ))}
          </div>
          <input
            className="tag-input wide"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Name this ${COGNITIVE_META[kind].label.toLowerCase()}…`}
          />
          <textarea
            className="companion-textarea"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={COGNITIVE_META[kind].blurb}
          />
          {kind === "future_event" && (
            <label className="mind-date">
              <span>When?</span>
              <input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>
          )}
          {kind === "life_vision" && (
            <label className="mind-date">
              <span>Target date (optional)</span>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                aria-label="Target date for this Life Vision"
              />
            </label>
          )}
          <input
            className="tag-input wide"
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            placeholder="Also called… (comma-separated — e.g. girlfriend, my girl)"
          />
          <div className="row">
            <button onClick={add} disabled={busy || !label.trim()}>
              {busy ? "Adding…" : `Add ${COGNITIVE_META[kind].label}`}
            </button>
            <button className="mini" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="companion-add-btn" onClick={() => setAdding(true)}>+ Map something in your mind</button>
      )}

      {/* IM-47: search + kind filter + sort (the Browse→All discovery pattern),
          so up to 100 items in 10 kinds stay findable. */}
      {items.length > 0 && (
        <div className="mind-search">
          <input
            className="tag-input wide"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${totalItems} mapped item${totalItems === 1 ? "" : "s"}…`}
            aria-label="Search your mind"
          />
          <div className="mind-search-row">
            <select
              className="tag-input"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as CognitiveKind | "all")}
              aria-label="Filter by kind"
            >
              <option value="all">all kinds</option>
              {COGNITIVE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {COGNITIVE_META[k].icon} {COGNITIVE_META[k].label}
                </option>
              ))}
            </select>
            <select
              className="tag-input"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              aria-label="Sort by"
            >
              <option value="recent">most recent</option>
              <option value="name">name A–Z</option>
              <option value="progress">progress</option>
              <option value="links">most linked</option>
            </select>
            {filtersActive && (
              <button
                className="mini ghost"
                onClick={() => {
                  setQuery("");
                  setKindFilter("all");
                }}
              >
                Clear
              </button>
            )}
          </div>
          {filtersActive && (
            <p className="mind-search-count">
              Showing {visibleItems.length} of {items.length}
            </p>
          )}
        </div>
      )}

      {/* Batch L (MIN-06): the 100-row cap is stated, never silent — when the
          mapped total exceeds the loaded page, the oldest items are beyond
          this view and the tab says so instead of presenting the page as
          the whole mind. */}
      {totalItems > items.length && items.length > 0 && (
        <p className="mind-search-count">
          Showing {items.length} of {totalItems} mapped items — the oldest are beyond this view.
        </p>
      )}

      {eventsError && (
        <p className="empty small">
          ⚠️ Couldn't load event dates — future events show their stored date instead.{" "}
          <button className="mini" onClick={() => void refreshEvents()}>Retry</button>
        </p>
      )}

      {loading && items.length === 0 && !loadError && (
        <p className="empty small">Loading your mind…</p>
      )}

      {items.length === 0 && !adding && !loadError && !loading && (
        <p className="empty small">Nothing mapped yet. Start with a goal you're working toward.</p>
      )}

      {items.length > 0 && visibleItems.length === 0 && (
        <p className="empty small">No matches — loosen the search or filters.</p>
      )}

      {loadError && items.length === 0 && !adding && (
        <div className="mind-load-error">
          <p className="empty small">⚠️ Couldn't load your mind — Soumaya may be unreachable, or still waking up. Your mapped mind is not gone; it just didn't arrive.</p>
          <button className="mini" onClick={() => void refresh()}>Retry</button>
        </div>
      )}

      {loadError && items.length > 0 && (
        <p className="empty small">
          ⚠️ Couldn't refresh your mind — showing the last copy that loaded.{" "}
          <button className="mini" onClick={() => void refresh()}>Retry</button>
        </p>
      )}

      {COGNITIVE_KINDS.filter((k) => byKind.has(k)).map((k) => (
        <section key={k} id={`mind-section-${k}`} className="mind-section">
          <h3 style={{ color: COGNITIVE_META[k].color }}>
            {COGNITIVE_META[k].icon} {COGNITIVE_META[k].label}s
          </h3>
          <ul className="mind-list">
            {byKind.get(k)!.map((it) => (
              <li key={it.id} className="mind-card" style={{ borderLeftColor: COGNITIVE_META[k].color }}>
                {editId === it.id ? (
                  <div className="mind-edit">
                    <input
                      className="tag-input wide"
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Name"
                    />
                    <textarea
                      className="companion-textarea"
                      rows={2}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder={COGNITIVE_META[k].blurb}
                    />
                    <input
                      className="tag-input wide"
                      value={editAliases}
                      onChange={(e) => setEditAliases(e.target.value)}
                      placeholder="Also called… (comma-separated)"
                    />
                    {k === "life_vision" && (
                      <label className="mind-date">
                        <span>Target date (optional)</span>
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          aria-label="Target date for this Life Vision"
                        />
                      </label>
                    )}
                    <div className="row">
                      <button className="mini" onClick={() => void saveEdit()} disabled={!editLabel.trim()}>Save</button>
                      <button className="mini ghost" onClick={() => setEditId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mind-card-row">
                    <button className="mind-card-main" onClick={() => onFocus(it.id)} title="Fly to it">
                      <span className="mind-card-label">
                        {it.label}
                        {it.aliases && it.aliases.length > 0 && <span className="mind-card-aka"> · aka {it.aliases.join(", ")}</span>}
                      </span>
                      <span className="mind-card-sub">
                        {k === "future_event"
                          ? // IM-48: relative countdown AND the absolute local date —
                            // "in 3d" alone never said which day. Falls back to the
                            // item's own stored date when the events feed is missing.
                            (() => {
                              const ev = events[it.id];
                              const abs = fmtEventDate(ev?.date ?? it.remindAt);
                              const rel = ev
                                ? ev.inDays < 0
                                  ? `overdue ${-ev.inDays}d`
                                  : ev.inDays === 0
                                    ? "today"
                                    : `in ${ev.inDays}d`
                                : "";
                              return [rel, abs].filter(Boolean).join(" · ") || "date unavailable";
                            })()
                          : k === "life_vision"
                            ? (visionDateLabel(it) ?? "no target date")
                            : k === "idea"
                              // Batch L (MIN-05): the support count is shown
                              // distinctly from the total link count — "Ripe"
                              // is defined on the former, not the latter.
                              ? `${it.supportCount ?? 0} supporting · ${it.degree} linked`
                              : `${it.degree} linked`}
                      </span>
                    </button>
                    {/* Batch L (MIN-08): card Edit/Delete carry visible captions,
                        not glyph-only titles — and meet the 46px standard. */}
                    <button className="mini ghost" aria-label={`Edit ${it.label}`} onClick={() => startEdit(it)} title="Edit">✎ Edit</button>
                    <button className="mini ghost" aria-label={`Delete ${it.label}`} onClick={() => setPendingDelete(it)} title="Delete">🗑 Delete</button>
                  </div>
                )}
                {/* IM-46 + IM-48: the item's own words and when it was mapped —
                    both were fetched but never rendered on the card. The snippet
                    is skipped when content just repeats the label (the server's
                    create fallback stores the label as content). */}
                {editId !== it.id && it.content?.trim() && it.content.trim() !== it.label.trim() && (
                  <p className="mind-card-content">{it.content.trim()}</p>
                )}
                {editId !== it.id && fmtBrowseDate(it.createdAt) && (
                  <p className="mind-card-meta">Added {fmtBrowseDate(it.createdAt)}</p>
                )}
                {editId !== it.id && k === "goal" && it.completedAt && (
                  <div className="mind-achieved" title={`Achieved ${new Date(it.completedAt).toLocaleDateString()}`}>
                    ✓ Achieved
                  </div>
                )}
                {editId !== it.id && COGNITIVE_META[k].hasProgress && !(k === "goal" && it.completedAt) && (
                  <div className="mind-progress">
                    {k === "skill" && (
                      <span className="mind-tier" title="Level — nudges up gently as related memories accrue; set your real mastery with – / +">
                        {skillTier(it.progress ?? 0)}
                      </span>
                    )}
                    <button className="mini" onClick={() => void bumpProgress(it, -0.1)} title="Less">–</button>
                    <span className="mind-bar">
                      <span style={{ width: `${Math.round((it.progress ?? 0) * 100)}%`, background: COGNITIVE_META[k].color }} />
                    </span>
                    <button className="mini" onClick={() => void bumpProgress(it, 0.1)} title="More">+</button>
                    <span className="mind-pct">{Math.round((it.progress ?? 0) * 100)}%</span>
                  </div>
                )}
                {editId !== it.id && k === "idea" && (
                  <button
                    className={`mind-promote ${(it.supportCount ?? 0) >= IDEA_PROMOTE_SUPPORT ? "ripe" : ""}`}
                    onClick={() => void promoteToGoal(it)}
                    title="Commit to this — turn it into a goal your memories orbit"
                  >
                    {/* Batch L (MIN-05): "Ripe" is defined on incoming
                        `supports` (the server's ripeIdeaIds), never on total
                        degree — an idea with ≥4 links of any kind and <4
                        supporters is not ripe. */}
                    {(it.supportCount ?? 0) >= IDEA_PROMOTE_SUPPORT ? "✨ Ripe — promote to Goal" : "💡→🎯 Promote to Goal"}
                  </button>
                )}
                {/* IM-136: split / merge — the rest of the idea lifecycle. Split
                    branches this idea under a name you give it; merge folds two
                    ideas together (pick two, the FIRST picked survives). Both
                    are confirmed via ConfirmDialog and delete nothing. */}
                {editId !== it.id && k === "idea" && (
                  <div className="mind-idea-actions">
                    <button
                      className="mini ghost"
                      onClick={() => {
                        setSplitFor(splitFor === it.id ? null : it.id);
                        setSplitLabel("");
                        setSplitContent("");
                      }}
                      title="Branch this idea into two"
                    >
                      ✂ Split
                    </button>
                    <button
                      className={`mini ghost ${mergeSelection.includes(it.id) ? "on" : ""}`}
                      aria-pressed={mergeSelection.includes(it.id)}
                      onClick={() => toggleMergeSelect(it)}
                      title="Select two ideas to merge them"
                    >
                      {mergeSelection.includes(it.id) ? "✓ Selected for merge" : "⇄ Select for merge"}
                    </button>
                  </div>
                )}
                {editId !== it.id && k === "idea" && splitFor === it.id && (
                  <div className="mind-edit mind-split-form">
                    <input
                      className="tag-input wide"
                      autoFocus
                      value={splitLabel}
                      onChange={(e) => setSplitLabel(e.target.value)}
                      placeholder="Name the branch that splits off…"
                      aria-label="Name the branch that splits off"
                    />
                    <textarea
                      className="companion-textarea"
                      rows={2}
                      value={splitContent}
                      onChange={(e) => setSplitContent(e.target.value)}
                      placeholder="Its own words (optional — blank keeps the original's)"
                    />
                    <p className="mind-card-meta">
                      Supporting memories closest to the new branch move to it; the rest stay. Nothing is deleted.
                    </p>
                    <div className="row">
                      <button className="mini" disabled={!splitLabel.trim()} onClick={() => setPendingSplit(it)}>
                        Split…
                      </button>
                      <button className="mini ghost" onClick={() => setSplitFor(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {editId !== it.id && k === "identity" && (
                  <div className="mind-evidence">
                    <button className="mind-ev-toggle" onClick={() => void toggleEvidence(it)}>
                      {evidenceOpen === it.id ? "▾" : "▸"} Evidence
                      {evidence[it.id] && (
                        <span className="mind-ev-counts">
                          <span className="ev-for">▲ {evidence[it.id]!.for.length}</span>
                          <span className="ev-against">▼ {evidence[it.id]!.against.length}</span>
                        </span>
                      )}
                    </button>
                    {/* Batch L (MIN-07): a failed lazy fetch is a visible error
                        + Retry, never an expanded header over blank nothing. */}
                    {evidenceOpen === it.id && !evidence[it.id] && evidenceStatus[it.id] === "loading" && (
                      <p className="empty small">Loading evidence…</p>
                    )}
                    {evidenceOpen === it.id && !evidence[it.id] && evidenceStatus[it.id] === "error" && (
                      <p className="empty small">
                        ⚠️ Couldn't load the evidence —{" "}
                        <button className="mini" onClick={() => void loadEvidence(it)}>Retry</button>
                      </p>
                    )}
                    {evidenceOpen === it.id && evidence[it.id] && (
                      <div className="mind-ev-body">
                        <div className="mind-ev-bar" title="How affirmed this identity is">
                          <span style={{ width: `${Math.round(evidence[it.id]!.confidence * 100)}%` }} />
                        </div>
                        {evidence[it.id]!.for.length > 0 && (
                          <div className="mind-ev-group">
                            <span className="ev-for">▲ Affirming</span>
                            {capped(`ev-for-${it.id}`, evidence[it.id]!.for, 8).shown.map((n) => (
                              <button key={n.id} className="mind-ev-chip" onClick={() => onFocus(n.id)}>{n.label}</button>
                            ))}
                            {moreToggle(`ev-for-${it.id}`, evidence[it.id]!.for.length - 8, !!expandedLists[`ev-for-${it.id}`])}
                          </div>
                        )}
                        {evidence[it.id]!.against.length > 0 && (
                          <div className="mind-ev-group">
                            <span className="ev-against">▼ Contesting</span>
                            {capped(`ev-against-${it.id}`, evidence[it.id]!.against, 8).shown.map((n) => (
                              <button key={n.id} className="mind-ev-chip contra" onClick={() => onFocus(n.id)}>{n.label}</button>
                            ))}
                            {moreToggle(`ev-against-${it.id}`, evidence[it.id]!.against.length - 8, !!expandedLists[`ev-against-${it.id}`])}
                          </div>
                        )}
                        {evidence[it.id]!.for.length === 0 && evidence[it.id]!.against.length === 0 && (
                          <p className="empty small">No evidence yet — log memories that express (or challenge) who you are.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {editId !== it.id && (k === "mental_model" || k === "motivation") && it.degree > 0 && (
                  <div className="mind-evidence">
                    <button className="mind-ev-toggle" onClick={() => void toggleEvidence(it)}>
                      {evidenceOpen === it.id ? "▾" : "▸"} {k === "mental_model" ? "Applied to" : "Pulls on"}
                      {evidence[it.id] && <span className="mind-ev-counts"><span className="ev-for">{evidence[it.id]!.for.length}</span></span>}
                    </button>
                    {/* Batch L (MIN-07): same truthful failure state as the
                        identity Evidence block above. */}
                    {evidenceOpen === it.id && !evidence[it.id] && evidenceStatus[it.id] === "loading" && (
                      <p className="empty small">Loading…</p>
                    )}
                    {evidenceOpen === it.id && !evidence[it.id] && evidenceStatus[it.id] === "error" && (
                      <p className="empty small">
                        ⚠️ Couldn't load this —{" "}
                        <button className="mini" onClick={() => void loadEvidence(it)}>Retry</button>
                      </p>
                    )}
                    {evidenceOpen === it.id && evidence[it.id] && (
                      <div className="mind-ev-body">
                        <div className="mind-ev-group">
                          {capped(`ev-applied-${it.id}`, evidence[it.id]!.for, 10).shown.map((n) => (
                            <button key={n.id} className="mind-ev-chip" onClick={() => onFocus(n.id)}>{n.label}</button>
                          ))}
                          {moreToggle(`ev-applied-${it.id}`, evidence[it.id]!.for.length - 10, !!expandedLists[`ev-applied-${it.id}`])}
                          {evidence[it.id]!.for.length === 0 && <p className="empty small">Nothing linked yet.</p>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {editId !== it.id && k === "person_entity" && (
                  <div className="mind-evidence">
                    <button className="mind-ev-toggle" onClick={() => void toggleProfile(it)}>
                      {profileOpen === it.id ? "▾" : "▸"} Relationship
                      {profiles[it.id] && (
                        <span className="mind-ev-counts">
                          <span>{profiles[it.id]!.count} ×</span>
                          <span className={`person-tone tone-${profiles[it.id]!.tone}`}>{profiles[it.id]!.tone}</span>
                        </span>
                      )}
                    </button>
                    {/* Batch L (MIN-07): a failed lazy fetch is a visible error
                        + Retry, never an expanded header over blank nothing. */}
                    {profileOpen === it.id && !profiles[it.id] && profileStatus[it.id] === "loading" && (
                      <p className="empty small">Loading this profile…</p>
                    )}
                    {profileOpen === it.id && !profiles[it.id] && profileStatus[it.id] === "error" && (
                      <p className="empty small">
                        ⚠️ Couldn't load this profile —{" "}
                        <button className="mini" onClick={() => void loadProfile(it)}>Retry</button>
                      </p>
                    )}
                    {profileOpen === it.id && profiles[it.id] && (
                      <div className="mind-ev-body">
                        <p className="person-meta">
                          {profiles[it.id]!.count} interaction{profiles[it.id]!.count === 1 ? "" : "s"}
                          {profiles[it.id]!.lastAt && ` · last ${new Date(profiles[it.id]!.lastAt!).toLocaleDateString()}`}
                          {" · "}<span className={`person-tone tone-${profiles[it.id]!.tone}`}>{profiles[it.id]!.tone}</span>
                        </p>
                        {profiles[it.id]!.interactions.length > 0 ? (
                          <>
                            <div className="mind-ev-group">
                              {capped(`person-${it.id}`, profiles[it.id]!.interactions, 12).shown.map((n) => (
                                <span key={n.id} className="mind-ev-chip removable">
                                  <button className="mind-ev-chip-label" onClick={() => onFocus(n.id)}>{n.label}</button>
                                  {/* IM-49: each interaction's own date + emotional
                                      tone were fetched but never rendered. */}
                                  <span className="mind-ev-chip-meta">
                                    {fmtBrowseDate(n.createdAt)}
                                    {n.emotionalWeight != null && ` · ${BROWSE_EMOTION_LABEL[emotionBucketOf(n.emotionalWeight)]}`}
                                  </span>
                                  <button
                                    className="mind-ev-chip-x"
                                    title="Not related — unlink"
                                    aria-label={`Unlink ${n.label} from ${it.label}`}
                                    onClick={() => void unlinkOne(it.id, n.id)}
                                  >
                                    Unlink
                                  </button>
                                </span>
                              ))}
                              {moreToggle(`person-${it.id}`, profiles[it.id]!.interactions.length - 12, !!expandedLists[`person-${it.id}`])}
                              {/* Batch L (MIN-06): the profile page is 100 rows;
                                  when the true total runs past it, the cap is
                                  stated instead of silent. */}
                              {profiles[it.id]!.count > profiles[it.id]!.interactions.length && (
                                <p className="empty small">
                                  Showing {profiles[it.id]!.interactions.length} of {profiles[it.id]!.count} interactions — the oldest are beyond this view.
                                </p>
                              )}
                            </div>
                            <button className="mind-prune" onClick={() => void pruneLinks(it)} title="Sever every link that doesn't actually name this person">
                              🧹 Clean up links that don't name {it.label}
                            </button>
                          </>
                        ) : (
                          <p className="empty small">No interactions yet — memories that mention them (or an alias) will appear here.</p>
                        )}
                        {/* Profile photos for this person — tap a thumbnail to view full-screen. */}
                        <MemoryAttachments nodeId={it.id} label="📷 Photos" />
                      </div>
                    )}
                  </div>
                )}
                {editId !== it.id && k === "life_vision" && (
                  <>
                    <MemoryAttachments nodeId={it.id} label="📎 Attachments" />
                    <div className="mind-evidence">
                      <button className="mind-ev-toggle" onClick={() => void toggleVisionGoals(it)}>
                        {visionGoalsOpen === it.id ? "▾" : "▸"} Financial Goals
                        {wealth && (
                          <span className="mind-ev-counts">
                            <span className="ev-for">{wealth.goals.filter((g) => g.visionNodeId === it.id).length}</span>
                          </span>
                        )}
                      </button>
                      {visionGoalsOpen === it.id && (
                        <div className="mind-ev-body">
                          {/* Batch L (MIN-07): a failed Wealth fetch is an error
                              + Retry — the old code rendered "Loading…" whenever
                              wealth was null, so a failed fetch presented as a
                              load that never finishes. */}
                          {!wealth ? (
                            wealthState === "error" ? (
                              <p className="empty small">
                                ⚠️ Couldn't load your Financial Goals —{" "}
                                <button className="mini" onClick={() => void loadWealth()}>Retry</button>
                              </p>
                            ) : (
                              <p className="empty small">Loading…</p>
                            )
                          ) : (
                            (() => {
                              const linked = wealth.goals.filter((g) => g.visionNodeId === it.id);
                              const available = wealth.goals.filter((g) => g.visionNodeId == null);
                              const req = visionRequirementCents(linked);
                              return (
                                <>
                                  {!req.hasLinkedGoals ? (
                                    <p className="empty small">No Financial Goals linked — connect one below to see what funding this Vision will take.</p>
                                  ) : (
                                    <p className="mind-vision-requirement">
                                      Financial requirement:{" "}
                                      <b>
                                        {fmt(req.totalCents)}
                                        {req.openEndedGoals > 0 ? "+" : ""}
                                      </b>
                                      {req.openEndedGoals > 0 &&
                                        ` (+${req.openEndedGoals} open-ended Financial Goal${req.openEndedGoals === 1 ? "" : "s"})`}
                                    </p>
                                  )}
                                  {linked.length > 0 && (
                                    <div className="mind-ev-group">
                                      {linked.map((g) => (
                                        <span key={g.id} className="mind-ev-chip removable">
                                          <span className="mind-ev-chip-label">
                                            {g.name} —{" "}
                                            {g.targetCents != null
                                              ? `${fmt(g.totalCents)} / ${fmt(g.targetCents)}`
                                              : `${fmt(g.totalCents)} allocated (open-ended)`}
                                          </span>
                                          <button
                                            className="mind-ev-chip-x"
                                            title={`Unlink "${g.name}" from this Life Vision`}
                                            aria-label={`Unlink "${g.name}" from this Life Vision`}
                                            disabled={goalBusy === g.id}
                                            onClick={() => void unlinkGoal(it.id, g.id)}
                                          >
                                            Unlink
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {available.length > 0 ? (
                                    <div className="row">
                                      <select
                                        className="tag-input"
                                        aria-label="Choose a Financial Goal to link"
                                        value={pickGoalId[it.id] ?? ""}
                                        onChange={(e) => setPickGoalId((m) => ({ ...m, [it.id]: e.target.value }))}
                                      >
                                        <option value="">Link an existing Financial Goal…</option>
                                        {available.map((g) => (
                                          <option key={g.id} value={g.id}>
                                            {g.name}
                                            {g.targetCents != null ? ` (${fmt(g.targetCents)})` : ""}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        className="mini"
                                        disabled={!pickGoalId[it.id] || goalBusy != null}
                                        onClick={() => void linkGoal(it.id, Number(pickGoalId[it.id]))}
                                      >
                                        + Link
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="empty small">No unlinked Financial Goals available — create one in Money → Wealth first.</p>
                                  )}
                                </>
                              );
                            })()
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          {/* IM-136: the merge bar — appears in the Ideas section once two
              ideas are selected. The first selected survives; the second folds
              into it (label kept as an alias, links unioned, soft-deleted). */}
          {k === "idea" && mergeSelection.length === 2 && (
            <div className="mind-merge-bar">
              <span>
                Merge <b>{items.find((x) => x.id === mergeSelection[1])?.label}</b> into{" "}
                <b>{items.find((x) => x.id === mergeSelection[0])?.label}</b> (first selected survives; nothing is deleted)
              </span>
              <button className="mini" onClick={() => setPendingMerge(true)}>
                Merge…
              </button>
              <button className="mini ghost" onClick={() => setMergeSelection([])}>
                Clear
              </button>
            </div>
          )}
        </section>
      ))}

      {/* IM-50 / IM-136: every destructive or lifecycle action in this tab
          confirms through the shared dialog — no native window.confirm. */}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete this from your mind?"
          message={`Delete "${pendingDelete.label}"? It leaves your galaxy — your memories stay, they just stop orbiting it.`}
          confirmLabel="Delete"
          onConfirm={() => void confirmRemoveItem(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {pendingSplit && (
        <ConfirmDialog
          title="Split this idea?"
          message={`"${pendingSplit.label}" stays, and "${splitLabel.trim()}" branches off as its own idea. Supporting memories closest to the new branch move to it. Nothing is deleted.`}
          confirmLabel="Split"
          onConfirm={() => void confirmSplit(pendingSplit)}
          onCancel={() => setPendingSplit(null)}
        />
      )}
      {pendingMerge && mergeSelection.length === 2 && (
        <ConfirmDialog
          title="Merge these ideas?"
          message={`"${items.find((x) => x.id === mergeSelection[1])?.label}" folds into "${items.find((x) => x.id === mergeSelection[0])?.label}". Every link and piece of evidence is unioned onto the survivor, and the folded idea's name stays as an alias — nothing is deleted.`}
          confirmLabel="Merge"
          onConfirm={() => void confirmMerge()}
          onCancel={() => setPendingMerge(false)}
        />
      )}
    </div>
  );
}
