import { useEffect, useMemo, useState } from "react";
import type { Constellation, DailyDigest, DormantItem, EmotionalTrajectory, EvolutionLink, Insight, LifeAreaCount, SelfReviewItem } from "@brain/shared";
import { getConstellationsResult, getDailyDigestResult, getDailyLogResult, getDigestResult, getDormantResult, getEmotionalTrajectoryResult, getEvolutionLinksResult, getLifeAreasResult, getSelfReviewResult, getBeliefsResult, ingestText, getSpaceId, promoteConstellation, resolveInsight, runDigest, runContradictions, type DailyLog, type Belief } from "../api/client.js";
import { colorForType } from "../graph/theme.js";
import { parseTolerantMs } from "../utils/dueReminders.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";

/**
 * A stored timestamp as the viewer's local calendar date ("Oct 20, 2026").
 * Parsed via the shared tolerant parser (naive SQLite strings read as UTC,
 * the same rule the other panels use) and rendered with toLocaleDateString,
 * so an evening-ET insight shows its ET date, not the UTC one. Unparseable
 * values render nothing — never the raw stored string.
 */
export function fmtLocalDate(raw?: string): string {
  if (!raw) return "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Short local date for a sparkline axis label ("Aug 28") — same tolerant
 * parsing rule as fmtLocalDate, without the year so both ends fit.
 */
export function fmtAxisDate(raw?: string): string {
  if (!raw) return "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * IM-59: an evolution link's time gap as its own human phrase ("3 months
 * later") instead of a number buried inside the reason string.
 */
export function evolutionGapLabel(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "the same day";
  if (days === 1) return "1 day later";
  if (days < 30) return `${Math.round(days)} days later`;
  if (days < 365) {
    const months = Math.round(days / 30.44);
    return months <= 1 ? "1 month later" : `${months} months later`;
  }
  const years = Math.round((days / 365.25) * 10) / 10;
  return years === 1 ? "1 year later" : `${years} years later`;
}

/**
 * IM-63: evolution strength as a human label + bar proportion, matching the
 * bars/percentages sibling sections use — not the bare uppercase enum.
 */
export const EVOLUTION_STRENGTH: Record<EvolutionLink["strength"], { label: string; pct: number }> = {
  weak: { label: "Faint echo", pct: 33 },
  medium: { label: "Clear thread", pct: 67 },
  strong: { label: "Strong thread", pct: 100 },
};

/**
 * REG-149 / INS-02 (IM-124, Observatory-style): the ten sources this panel
 * loads, with the human label the error card names when one of them fails.
 * A failed source is a loading problem, never an empty brain — each source
 * keeps its last-good data and is named in the error state with a Retry.
 */
type InsightSourceKey =
  | "insights"
  | "daily"
  | "constellations"
  | "emotional"
  | "dormant"
  | "evolution"
  | "lifeAreas"
  | "selfReview"
  | "dailyLog"
  | "beliefs";
const SOURCE_LABEL: Record<InsightSourceKey, string> = {
  insights: "Latent connections",
  daily: "Daily digest",
  constellations: "Constellations",
  emotional: "Emotional weather",
  dormant: "Dormant & worth reviving",
  evolution: "How your thinking evolved",
  lifeAreas: "Life-area lens",
  selfReview: "Self-check",
  dailyLog: "Captain's Log",
  beliefs: "What she believes about you",
};

/** REG-158 / INS-12: per-section collapse toggle, rendered in each section's
 *  header row. The round-3 standard requires every control to carry its name
 *  visibly — the toggle shows Collapse/Expand as text, not just a glyph (the
 *  aria-label/title already named it for screen readers and hover). It keeps
 *  the shared .mini sizing: no inline shrink below the panel's norm. */
function SectionToggle({
  name,
  open,
  onToggle,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="mini ghost section-toggle"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
      title={`${open ? "Collapse" : "Expand"} ${name}`}
      onClick={onToggle}
      style={{ marginLeft: "auto" }}
    >
      {open ? "▾ Collapse" : "▸ Expand"}
    </button>
  );
}

/** Dependency-free valence sparkline (−1..1). Green above the midline, red below. */
function MoodSparkline({ points }: { points: EmotionalTrajectory["points"] }) {
  if (points.length < 2) return null;
  const W = 240;
  const H = 44;
  const LABEL_H = 12;
  const n = points.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H / 2 - (v * (H / 2 - 3)); // +1 → top, −1 → bottom
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.valence).toFixed(1)}`).join(" ");
  // IM-60: the sparkline had no axis at all — label the window's first and
  // last bucket dates so the curve is anchored in time.
  const firstPoint = points.at(0);
  const lastPoint = points.at(-1);
  const firstDate = firstPoint ? fmtAxisDate(firstPoint.date) : "";
  const lastDate = lastPoint ? fmtAxisDate(lastPoint.date) : "";
  return (
    <svg width={W} height={H + LABEL_H} style={{ display: "block", maxWidth: "100%" }} aria-label="Mood over time">
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      <path d={line} fill="none" stroke="#7af9ff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.valence)} r={2} fill={p.valence >= 0 ? "#5ee6a0" : "#ff7a59"} />
      ))}
      {firstDate && (
        <text x={0} y={H + 10} fontSize={8} fill="rgba(255,255,255,0.55)">
          {firstDate}
        </text>
      )}
      {lastDate && (
        <text x={W} y={H + 10} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.55)">
          {lastDate}
        </text>
      )}
    </svg>
  );
}

export function DigestPanel({
  onFocus,
  onPromoted,
}: {
  onFocus: (id: number) => void;
  /** Called after a cluster is promoted to a constellation hub, so the galaxy refreshes. */
  onPromoted?: () => void;
}) {
  const [items, setItems] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<DailyDigest | null>(null);
  const [constellations, setConstellations] = useState<Constellation[]>([]);
  const [emotional, setEmotional] = useState<EmotionalTrajectory | null>(null);
  const [dormant, setDormant] = useState<DormantItem[]>([]);
  const [evolution, setEvolution] = useState<EvolutionLink[]>([]);
  const [lifeAreas, setLifeAreas] = useState<LifeAreaCount[]>([]);
  const [selfReview, setSelfReview] = useState<SelfReviewItem[]>([]);
  // Captain's Log lives here (moved from the Soumaya tab): it's her narrative
  // read on the day — the same job as the daily digest, so they read together.
  const [dailyLog, setDailyLog] = useState<DailyLog | null>(null);
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAllInsights, setShowAllInsights] = useState(false);
  // Captain's Log used to be a dead-end static paragraph — no way to keep it or
  // ask about it. savingLog/logSaved mirror ChatDock's save-once-per-message
  // pattern, keyed by date so re-mounting the panel doesn't re-offer a save.
  const [savingLog, setSavingLog] = useState(false);
  const [logSaved, setLogSaved] = useState(false);
  // Emotional-weather patterns had no accept/snooze/done either — a "noted,
  // stop showing me this" per pattern, persisted so it stays dismissed.
  const [dismissedPatterns, setDismissedPatterns] = useState<Set<string>>(new Set());
  // IM-60: ten stacked sections with no way to find anything — a search box
  // (filters sections + the insight list) and per-section collapse.
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // REG-149 / INS-02: which sources failed their last load. A failed source
  // keeps its last-good data (never cleared to empty) and is named in the
  // error state with a Retry — a dead server must never render as an empty
  // brain. Empty while loading; set on every load, mount and Retry alike.
  const [failedSources, setFailedSources] = useState<ReadonlySet<InsightSourceKey>>(new Set());

  /**
   * Load all ten sources through the strict Result variants (IM-124): each
   * result is applied ONLY when it reports ok, so a failed source keeps its
   * previous (last-good) data instead of being wiped to its empty value.
   * `isCancelled` is the mount effect's guard; Retry calls this unguarded.
   */
  async function loadSources(isCancelled: () => boolean = () => false) {
    const [
      itemsRes,
      dailyRes,
      constellationsRes,
      emotionalRes,
      dormantRes,
      evolutionRes,
      lifeAreasRes,
      selfReviewRes,
      dailyLogRes,
      beliefsRes,
    ] = await Promise.all([
      getDigestResult(),
      getDailyDigestResult(),
      getConstellationsResult(),
      getEmotionalTrajectoryResult(),
      getDormantResult(),
      getEvolutionLinksResult(),
      getLifeAreasResult(),
      getSelfReviewResult(),
      getDailyLogResult(),
      getBeliefsResult(),
    ]);
    if (isCancelled()) return;
    const failed = new Set<InsightSourceKey>();
    if (itemsRes.ok) setItems(itemsRes.insights);
    else failed.add("insights");
    if (dailyRes.ok) setDaily(dailyRes.digest);
    else failed.add("daily");
    if (constellationsRes.ok) setConstellations(constellationsRes.constellations);
    else failed.add("constellations");
    if (emotionalRes.ok) setEmotional(emotionalRes.trajectory);
    else failed.add("emotional");
    if (dormantRes.ok) setDormant(dormantRes.dormant);
    else failed.add("dormant");
    if (evolutionRes.ok) setEvolution(evolutionRes.evolution);
    else failed.add("evolution");
    if (lifeAreasRes.ok) setLifeAreas(lifeAreasRes.lifeAreas);
    else failed.add("lifeAreas");
    if (selfReviewRes.ok) setSelfReview(selfReviewRes.selfReview);
    else failed.add("selfReview");
    if (dailyLogRes.ok) {
      if (dailyLogRes.log) setDailyLog(dailyLogRes.log);
    } else failed.add("dailyLog");
    if (beliefsRes.ok) setBeliefs(beliefsRes.beliefs);
    else failed.add("beliefs");
    setFailedSources(failed);
  }

  /** Mark one source's refresh outcome in the failure set (scan refreshes). */
  function noteSource(key: InsightSourceKey, ok: boolean) {
    setFailedSources((prev) => {
      const next = new Set(prev);
      if (ok) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    const spaceId = getSpaceId() ?? "legacy";
    if (dailyLog) {
      try {
        setLogSaved(localStorage.getItem(`brain.logsaved.${spaceId}.${dailyLog.date}`) === "1");
      } catch {
        /* storage unavailable */
      }
    }
    try {
      const raw = localStorage.getItem(`brain.patterns.dismissed.${spaceId}`);
      if (raw) setDismissedPatterns(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* storage unavailable or corrupt — start fresh */
    }
  }, [dailyLog?.date]);

  async function saveLogAsMemory() {
    if (!dailyLog || savingLog || logSaved) return;
    setSavingLog(true);
    try {
      await ingestText(`Captain's Log (${dailyLog.date}): ${dailyLog.content}`);
      setLogSaved(true);
      try {
        localStorage.setItem(`brain.logsaved.${getSpaceId() ?? "legacy"}.${dailyLog.date}`, "1");
      } catch {
        /* storage unavailable */
      }
      playSfx("chime");
      pushToast("Captain's Log saved as a memory ✦", "🛰️", 4000);
    } catch (err) {
      pushToast((err as Error).message || "Couldn't save that.", "⚠️", 4000);
    } finally {
      setSavingLog(false);
    }
  }

  function dismissPattern(key: string) {
    setDismissedPatterns((prev) => {
      const next = new Set(prev);
      next.add(key);
      try {
        localStorage.setItem(`brain.patterns.dismissed.${getSpaceId() ?? "legacy"}`, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
    pushToast("Got it — noted.", "✓", 2500);
  }

  // #10 tiers + #7 compression: surface the most significant insights first
  // (identity → behavioral → situational, then most recent) and cap the list by
  // default so the digest stays scannable.
  const INSIGHT_CAP = 6;
  // REG-157 / INS-11: the server's insight working set is itself capped —
  // InsightsRepo.recent() defaults to 30 — so the list below states the cap
  // where it truncates instead of letting an insight past position 30 be
  // silently unreachable.
  const INSIGHT_SERVER_CAP = 30;
  const rankedInsights = useMemo(
    () => [...items].sort((a, b) => (a.tier ?? 3) - (b.tier ?? 3) || b.id - a.id),
    [items],
  );
  // IM-60 search plumbing: while a query is active it decides which sections
  // render at all (a section shows only if its own content matches) and
  // filters the insight list; sections also force open so a match is never
  // hidden behind a collapse the user set earlier.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const hit = (...texts: (string | null | undefined)[]): boolean =>
    !searching || texts.some((t) => !!t && t.toLowerCase().includes(q));
  const sectionOpen = (id: string): boolean => searching || !collapsed.has(id);
  const toggleSection = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const filteredInsights = searching
    ? rankedInsights.filter((it) => hit(it.text, ...it.nodes.map((n) => n.label)))
    : rankedInsights;
  const shownInsights = showAllInsights ? filteredInsights : filteredInsights.slice(0, INSIGHT_CAP);
  // IM-63: the tier used to render as the raw category word ("identity") with
  // its meaning stranded in a tooltip. The visible label now says what the
  // tier means; the tooltip keeps only the surfacing-order detail.
  const TIER_LABEL: Record<number, string> = {
    1: "About your identity",
    2: "A recurring pattern",
    3: "Situational",
  };
  // Inline "save as constellation" — which cluster is being named, the draft name, and save-in-flight.
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  async function savePromotion(c: Constellation) {
    const name = draftName.trim();
    if (!name) return;
    setSavingId(c.id);
    try {
      const { hub, error } = await promoteConstellation(name, c.nodes.map((n) => n.id));
      if (hub) {
        playSfx("achievement");
        pushToast(`Constellation "${name}" charted ✦`, "🌌", 5500);
        setPromotingId(null);
        setDraftName("");
        // Fly-to-isolate the new constellation with a burst once it lands in the galaxy.
        if (hub.id != null) window.dispatchEvent(new CustomEvent("brain-constellation-formed", { detail: { id: hub.id } }));
        onPromoted?.();
      } else {
        // The real server reason (e.g. "at least 2 memories required") used to be
        // built and thrown, then caught right there and discarded — only this
        // generic fallback ever reached the user.
        pushToast(error ?? "Couldn't chart that constellation — try again.", "⚠️", 4500);
      }
    } finally {
      setSavingId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadSources(() => cancelled).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: loadSources is stable by construction (setters only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setBusy(true);
    try {
      // Used to give NO feedback either way — a failed scan and a successful one
      // that found nothing looked identical, and a successful one that found
      // several announced nothing. scanContradictions (right below this) already
      // toasts both outcomes; this button behaved completely differently.
      const found = await runDigest();
      // REG-149 / INS-02: refresh through the Result variants and apply only
      // what answered — a failed refresh used to resolve [] through the
      // fail-soft getters and WIPE the list it had just scanned.
      const [freshItems, freshDaily, freshConstellations] = await Promise.all([
        getDigestResult(),
        getDailyDigestResult(),
        getConstellationsResult(),
      ]);
      if (freshItems.ok) setItems(freshItems.insights);
      noteSource("insights", freshItems.ok);
      if (freshDaily.ok) setDaily(freshDaily.digest);
      noteSource("daily", freshDaily.ok);
      if (freshConstellations.ok) setConstellations(freshConstellations.constellations);
      noteSource("constellations", freshConstellations.ok);
      pushToast(
        found.length > 0
          ? `Found ${found.length} new connection${found.length === 1 ? "" : "s"} ✨`
          : "No new connections yet — add a few more related thoughts and try again.",
        found.length > 0 ? "✨" : "🔍",
        5000,
      );
    } catch {
      // IM-61: the scan itself failed — say so, distinctly from a successful
      // scan that found nothing. Never toast the empty-result copy here.
      pushToast("Couldn't run the connection scan — it didn't complete. Check your connection and try again.", "⚠️", 5000);
    } finally {
      setBusy(false);
    }
  }

  async function scanContradictions() {
    setBusy(true);
    try {
      const found = await runContradictions();
      // REG-149 / INS-02: same last-good rule as run() — only apply a
      // refresh that actually answered.
      const fresh = await getDigestResult();
      if (fresh.ok) setItems(fresh.insights);
      noteSource("insights", fresh.ok);
      pushToast(
        found.length > 0
          ? `Found ${found.length} contradiction${found.length === 1 ? "" : "s"} to reconcile ⚡`
          : "No contradictions found — your memories are consistent ✓",
        found.length > 0 ? "⚡" : "✓",
        5000,
      );
    } catch {
      // IM-61: a failed scan must never read as "your memories are
      // consistent" — the scan didn't run, so consistency is unknown.
      pushToast("Couldn't run the contradiction scan — it didn't complete. Check your connection and try again.", "⚠️", 5000);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="dock-body loading-shimmer" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div className="skeleton-section" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="skeleton-title" style={{ width: "60%", height: "16px", background: "rgba(255,255,255,0.06)", borderRadius: "4px" }} />
          <div className="skeleton-line" style={{ width: "90%", height: "10px", background: "rgba(255,255,255,0.04)", borderRadius: "4px" }} />
          <div className="skeleton-grid" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ height: "45px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }} />
            <div style={{ height: "45px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }} />
          </div>
        </div>
        <div className="skeleton-section" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="skeleton-title" style={{ width: "40%", height: "16px", background: "rgba(255,255,255,0.06)", borderRadius: "4px" }} />
          <div className="skeleton-line" style={{ width: "80%", height: "10px", background: "rgba(255,255,255,0.04)", borderRadius: "4px" }} />
          <div style={{ height: "80px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }} />
        </div>
        <div className="skeleton-section" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="skeleton-title" style={{ width: "50%", height: "16px", background: "rgba(255,255,255,0.06)", borderRadius: "4px" }} />
          <div style={{ height: "55px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }} />
        </div>
      </div>
    );
  }

  // REG-149 / INS-02: when the PRIMARY sources (the insight list + the daily
  // digest) both failed and there is no last-good data for either, the panel
  // says so outright instead of rendering the empty-brain copy. Partial
  // failures render the normal panel with the error card below.
  const primaryFailed =
    failedSources.has("insights") && failedSources.has("daily") && items.length === 0 && !daily;
  if (primaryFailed) {
    return (
      <div className="dock-body" role="alert">
        <h3>⚠️ Couldn&apos;t load Insights</h3>
        <p style={{ fontSize: "0.85rem", lineHeight: 1.5, opacity: 0.9 }}>
          The server didn&apos;t answer, so there&apos;s nothing to show yet — that&apos;s a loading problem, not an
          empty brain. Your memories are still there; try again.
        </p>
        <button className="mini" onClick={() => void loadSources()}>
          Retry
        </button>
      </div>
    );
  }

  // IM-60: section visibility under search (data presence AND a content hit).
  const showBeliefs = beliefs.length > 0 && hit(...beliefs.map((b) => b.content));
  const showDailyLog = !!dailyLog && hit(dailyLog.content);
  const dailyHasContent =
    !!daily &&
    (daily.fresh.length > 0 ||
      (daily.connections?.length ?? 0) > 0 ||
      daily.expiredActions.length > 0 ||
      daily.cooling.length > 0 ||
      (daily.reminders?.length ?? 0) > 0 ||
      !!daily.greeting);
  const showDaily =
    dailyHasContent &&
    hit(
      daily?.greeting,
      daily?.closing,
      ...(daily?.fresh ?? []).flatMap((e) => [e.node.label, e.snippet, e.take]),
      ...(daily?.connections ?? []).map((c) => c.text),
      ...(daily?.expiredActions ?? []).map((a) => a.label),
      ...(daily?.cooling ?? []).map((c) => c.node.label),
      ...(daily?.reminders ?? []).map((r) => r.node.label),
    );
  const showConstellations =
    constellations.length > 0 &&
    hit(...constellations.flatMap((c) => [c.name, ...c.nodes.map((n) => n.label)]));
  const showSelfReview =
    selfReview.length > 0 && hit(...selfReview.flatMap((s) => [s.title, s.detail]));
  const showLifeAreas = lifeAreas.length > 0 && hit(...lifeAreas.map((a) => a.area));
  const showEmotional =
    !!emotional &&
    emotional.sampleSize >= 3 &&
    hit(...emotional.patterns.flatMap((p) => [p.type, p.trigger, p.intervention, p.basis]));
  const showEvolution =
    evolution.length > 0 &&
    hit(...evolution.flatMap((e) => [e.fromLabel, e.toLabel, e.reason]));
  const showDormant =
    dormant.length > 0 && hit(...dormant.flatMap((d) => [d.label, d.hypothesis, d.prompt]));
  const anySectionMatch =
    showBeliefs ||
    showDailyLog ||
    showDaily ||
    showConstellations ||
    showSelfReview ||
    showLifeAreas ||
    showEmotional ||
    showEvolution ||
    showDormant ||
    filteredInsights.length > 0;

  return (
    <div className="dock-body">
      {/* REG-149 / INS-02: Observatory-style (IM-124) error card — a failed
          source is named here with a Retry, and its section keeps its
          last-good data instead of rendering as empty. */}
      {failedSources.size > 0 && (
        <div
          className="insights-error"
          role="alert"
          style={{ marginBottom: "14px", padding: "0.75rem", backgroundColor: "rgba(255, 122, 89, 0.08)", borderLeft: "3px solid rgba(255, 122, 89, 0.6)", borderRadius: "0 4px 4px 0" }}
        >
          <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>⚠️ Couldn&apos;t load everything</div>
          <div style={{ fontSize: "0.78rem", opacity: 0.85, marginTop: "0.2rem" }}>
            {[...failedSources].map((k) => SOURCE_LABEL[k]).join(", ")} didn&apos;t answer — that&apos;s a loading
            problem, not an empty brain.
          </div>
          <button className="mini" style={{ marginTop: "0.5rem" }} onClick={() => void loadSources()}>
            Retry
          </button>
        </div>
      )}
      {/* IM-60: search across every section below + the insight list. */}
      <input
        className="list-filter"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Insights…"
        aria-label="Search the Insights tab"
        style={{ marginBottom: "14px" }}
      />
      {/* What she believes about you — consolidated from clusters (dream cycles). */}
      {showBeliefs && (
        <section className="beliefs-section" style={{ marginBottom: "16px" }}>
          <div className="dock-head">
            <h3>🖤 What she believes about you</h3>
            <SectionToggle name="What she believes about you" open={sectionOpen("beliefs")} onToggle={() => toggleSection("beliefs")} />
          </div>
          {sectionOpen("beliefs") && (
            <>
              <p className="empty small" style={{ marginTop: "-4px" }}>
                Durable understanding she's distilled from clusters of your memories — it deepens as you grow.
              </p>
              <ul className="beliefs-list">
                {beliefs.map((b) => {
                  // IM-59: when she formed the belief was fetched and never shown.
                  const formedLabel = fmtLocalDate(b.createdAt);
                  return (
                    <li
                      key={b.id}
                      className="belief-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => onFocus(b.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onFocus(b.id);
                        }
                      }}
                      title="Fly to this belief and its evidence"
                    >
                      <span className="belief-text">{b.content}</span>
                      <span className="belief-evi">from {b.evidence} {b.evidence === 1 ? "memory" : "memories"}</span>
                      {formedLabel && (
                        <span className="belief-date" style={{ fontSize: "0.66rem", opacity: 0.6 }}>
                          formed {formedLabel}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {/* Captain's Log — her once-a-day narrative entry (autonomous daily_log job). */}
      {showDailyLog && dailyLog && (
        <div className="daily-log" style={{ marginBottom: "16px", padding: "1rem", backgroundColor: "rgba(100, 200, 255, 0.05)", borderLeft: "3px solid rgba(100, 200, 255, 0.5)", borderRadius: "0 4px 4px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {/* IM-63: this date rendered as the raw stored YYYY-MM-DD while
                the same panel localises every other date. */}
            <h4 style={{ margin: "0 0 0.5rem 0", color: "rgba(100, 200, 255, 0.9)", fontSize: "13px" }}>
              Captain&apos;s Log{fmtLocalDate(dailyLog.date) ? ` (${fmtLocalDate(dailyLog.date)})` : ""}
            </h4>
            <SectionToggle name="Captain's Log" open={sectionOpen("daily-log")} onToggle={() => toggleSection("daily-log")} />
          </div>
          {sectionOpen("daily-log") && (
          <>
          <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.4, opacity: 0.9 }}>{dailyLog.content}</p>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.6rem" }}>
            <button className="mini" disabled={savingLog || logSaved} onClick={() => void saveLogAsMemory()}>
              {logSaved ? "✓ Saved" : savingLog ? "Saving…" : "★ Save as memory"}
            </button>
            <button
              className="mini ghost"
              onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "chat" } }))}
              title="Open chat to ask Soumaya about today's log"
            >
              💬 Ask about this
            </button>
          </div>
          </>
          )}
        </div>
      )}

      {/* Soumaya's daily digest — her read on the day, with links + her take. */}
      {/* Used to check only fresh/expiredActions/greeting — a day with ONLY cooling
          memories or ONLY due reminders (both real, actionable lists rendered below)
          would silently render nothing at all. */}
      {showDaily && daily && (
        <section className="daily-digest">
          <div className="dock-head">
            <h3>🛰️ Soumaya&apos;s daily digest</h3>
            <SectionToggle name="Soumaya's daily digest" open={sectionOpen("daily")} onToggle={() => toggleSection("daily")} />
          </div>
          {sectionOpen("daily") && (
          <>
          {daily.greeting && <p className="digest-greeting">{daily.greeting}</p>}

          {daily.fresh.length > 0 && (
            <ul className="digest-entries">
              {daily.fresh.map((e) => (
                <li key={e.node.id}>
                  <button
                    className="digest-link"
                    style={{ borderColor: colorForType(e.node.type) }}
                    onClick={() => onFocus(e.node.id)}
                  >
                    {e.node.label}
                  </button>
                  <p className="digest-snippet">{e.snippet}</p>
                  <p className="digest-take">— {e.take}</p>
                </li>
              ))}
            </ul>
          )}

          {/* IM-56: the day's surfaced latent connections were fetched and
              populated server-side but never rendered — the digest's own
              connections were invisible in the digest. Rendered like the
              sibling digest fields, with fly-to pills for the linked nodes. */}
          {daily.connections && daily.connections.length > 0 && (
            <div className="digest-connections">
              <h4>🔗 Connections she surfaced today</h4>
              <ul className="digest-entries">
                {daily.connections.map((c) => (
                  <li key={c.id}>
                    <p className="digest-snippet">{c.text}</p>
                    <div className="pills">
                      {c.nodes.map((n) => (
                        <button
                          key={n.id}
                          className="pill"
                          style={{ borderColor: colorForType(n.type) }}
                          onClick={() => onFocus(n.id)}
                          title="Fly to this memory"
                        >
                          {n.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {daily.expiredActions.length > 0 && (
            <div className="digest-actions">
              <h4>⏰ Action items that cleared</h4>
              <ul>
                {daily.expiredActions.map((a, i) => (
                  <li key={`${a.label}-${i}`}>{a.label}</li>
                ))}
              </ul>
            </div>
          )}

          {daily.cooling.length > 0 && (
            <div className="digest-cooling">
              <h4>❄️ Going cold — tap one to warm it back up</h4>
              <div className="pills">
                {daily.cooling.map((c) => (
                  <button
                    key={c.node.id}
                    className="pill"
                    style={{ borderColor: colorForType(c.node.type) }}
                    onClick={() => onFocus(c.node.id)}
                    title="Fly to this memory and warm it back up"
                  >
                    {c.node.label} · {Math.round(c.entropy * 100)}% cold
                  </button>
                ))}
              </div>
            </div>
          )}

          {daily.reminders && daily.reminders.length > 0 && (
            <div className="digest-reminders">
              <h4>⏰ Reminders due</h4>
              <div className="pills">
                {daily.reminders.map((r) => (
                  <button
                    key={r.node.id}
                    className="pill"
                    style={{ borderColor: colorForType(r.node.type) }}
                    onClick={() => onFocus(r.node.id)}
                    title="You asked to be reminded of this"
                  >
                    {r.node.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {daily.closing && <p className="digest-closing">{daily.closing}</p>}
          </>
          )}
        </section>
      )}

      {/* ML constellations — unsupervised k-means groupings of the memories. */}
      {showConstellations && (
        <section className="constellations">
          <div className="dock-head">
            <h3>🌌 Constellations</h3>
            <SectionToggle name="Constellations" open={sectionOpen("constellations")} onToggle={() => toggleSection("constellations")} />
          </div>
          {sectionOpen("constellations") && (
          <>
          <p className="constellations-sub">
            Memories grouped by similarity — your galaxy&apos;s natural regions.
          </p>
          <ul className="constellation-list">
            {constellations.map((c) => {
              // REG-156 / INS-10: a 1-member bucket is not a constellation — its
              // cohesion is 1.0 by construction, so it renders with no cohesion
              // figure and no Save button (the server drops singletons; this
              // guard holds even if one ever arrives). The section copy above
              // says "similarity", not "meaning", so it survives the
              // hash-embeddings fallback, where the grouping is lexical
              // bag-of-words rather than a meaning model.
              const degenerate = c.nodes.length < 2;
              return (
              <li key={c.id}>
                <div className="constellation-head">
                  <strong>{c.name}</strong>
                  <span className="constellation-meta">
                    {degenerate ? `${c.nodes.length} memory` : `${c.nodes.length} · ${Math.round(c.cohesion * 100)}% tight`}
                  </span>
                </div>
                <div className="pills">
                  {c.nodes.slice(0, 8).map((n) => (
                    <button
                      key={n.id}
                      className="pill"
                      style={{ borderColor: colorForType(n.type) }}
                      onClick={() => onFocus(n.id)}
                    >
                      {n.label}
                    </button>
                  ))}
                  {c.nodes.length > 8 && <span className="pill-more">+{c.nodes.length - 8}</span>}
                </div>
                {degenerate ? null : promotingId === c.id ? (
                  <div className="constellation-promote">
                    <input
                      className="list-filter"
                      value={draftName}
                      autoFocus
                      maxLength={60}
                      placeholder="Name this constellation…"
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && savePromotion(c)}
                    />
                    <button className="mini" disabled={savingId === c.id || !draftName.trim()} onClick={() => savePromotion(c)}>
                      {savingId === c.id ? "Charting…" : "✦ Save"}
                    </button>
                    <button className="mini ghost" onClick={() => setPromotingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="mini constellation-make"
                    title="Make this a permanent, named constellation hub in your galaxy"
                    onClick={() => {
                      setPromotingId(c.id);
                      setDraftName(c.name);
                    }}
                  >
                    ✦ Save as constellation
                  </button>
                )}
              </li>
              );
            })}
          </ul>
          </>
          )}
        </section>
      )}

      {/* Soumaya's self-check — read-only coverage report (#12). */}
      {showSelfReview && (
        <section className="self-check" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>🔍 Soumaya&apos;s self-check</h3>
            <SectionToggle name="Soumaya's self-check" open={sectionOpen("self-check")} onToggle={() => toggleSection("self-check")} />
          </div>
          {sectionOpen("self-check") && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {selfReview.map((s) => (
              <li key={s.title} style={{ borderLeft: "3px solid #c9a0ff", paddingLeft: "0.6rem" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                  {s.title} <span style={{ opacity: 0.6, fontWeight: 400 }}>· {s.count}</span>
                </div>
                <div style={{ fontSize: "0.76rem", opacity: 0.85 }}>{s.detail}</div>
              </li>
            ))}
          </ul>
          )}
        </section>
      )}

      {/* Life-area lens — optional overlay grouping memories by area of life (#6). */}
      {showLifeAreas && (() => {
        const total = lifeAreas.reduce((s, a) => s + a.count, 0) || 1;
        const AREA_COLOR: Record<string, string> = {
          "Identity & Growth": "#9a7aff",
          Relationships: "#ff8fb0",
          "Work & Projects": "#7af9ff",
          Health: "#5ee6a0",
          Money: "#ffd36e",
          Other: "#9aa7c7",
        };
        return (
          <section className="life-areas" style={{ marginBottom: "1rem" }}>
            <div className="dock-head">
              <h3>🪟 Life-area lens</h3>
              {/* REG-155 / INS-08: the bars are an automatic keyword guess about
                  themes — the builder has no attention/engagement signal at
                  all, so the header must not claim "where your attention goes". */}
              <span style={{ fontSize: "0.72rem", opacity: 0.6 }}>automatically sorted by keywords — a rough guess at themes</span>
              <SectionToggle name="Life-area lens" open={sectionOpen("life-areas")} onToggle={() => toggleSection("life-areas")} />
            </div>
            {sectionOpen("life-areas") && (
            <>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {lifeAreas.map((a) => (
                <li key={a.area} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.76rem", width: "8.5rem", flexShrink: 0 }}>{a.area}</span>
                  <span style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.08)", borderRadius: "4px", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.round((a.count / total) * 100)}%`, background: AREA_COLOR[a.area] ?? "#9aa7c7" }} />
                  </span>
                  <span style={{ fontSize: "0.72rem", opacity: 0.7, width: "2rem", textAlign: "right" }}>{a.count}</span>
                </li>
              ))}
            </ul>
            <p className="empty small" style={{ marginTop: "0.5rem" }}>
              Automatic keyword sort of your memory counts — not measured attention. One thought can count more than
              once when it splits into several memories; her own belief summaries aren&apos;t counted.
            </p>
            </>
            )}
          </section>
        );
      })()}

      {/* Emotional weather — mood trajectory + detected patterns (offline, free). */}
      {showEmotional && emotional && (
        <section className="emotional-weather" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>🌡️ Emotional weather</h3>
            <span
              style={{ fontSize: "0.72rem", opacity: 0.7 }}
              title={`Trend over the last ${emotional.points.length} day-buckets — the sparkline's window, not all of history`}
            >
              {emotional.trend === "rising" ? "↗ brightening" : emotional.trend === "falling" ? "↘ cooling" : "→ steady"}
            </span>
            <SectionToggle name="Emotional weather" open={sectionOpen("emotional")} onToggle={() => toggleSection("emotional")} />
          </div>
          {sectionOpen("emotional") && (
          <>
          <MoodSparkline points={emotional.points} />
          {/* REG-154 / INS-07: the headline used to mix two windows in one
              statement — trend/volatility from the last 40 day-buckets beside
              an all-history average/sample size, implying one window none of
              them used. Each number now names its window. */}
          <p style={{ fontSize: "0.74rem", opacity: 0.7, margin: "0.35rem 0 0.6rem 0" }}>
            Avg mood {emotional.average >= 0 ? "+" : ""}
            {emotional.average.toFixed(2)} across all {emotional.sampleSize} memories (all time) · trend + swings
            from the last {emotional.points.length} day-buckets
            {emotional.points.length > 0
              ? ` (${fmtAxisDate(emotional.points[0]!.date)}–${fmtAxisDate(emotional.points[emotional.points.length - 1]!.date)})`
              : ""}{" "}
            · {emotional.volatility >= 0.5 ? "high swings" : "stable"}
          </p>
          {/* REG-153 / INS-06: the chat renderer hedges these patterns to the
              syllable ("a recurring SIGNAL, never a settled fact") — the panel
              carries the same framing, and each pattern below shows its basis. */}
          <p style={{ fontSize: "0.74rem", opacity: 0.7, margin: "0 0 0.6rem 0" }}>
            These patterns are a recurring signal from a simple heuristic over your mood notes — a signal, never a
            settled fact.
          </p>
          {emotional.patterns.filter((p) => !dismissedPatterns.has(`${p.type}|${p.trigger ?? ""}`)).length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {emotional.patterns
                .filter((p) => !dismissedPatterns.has(`${p.type}|${p.trigger ?? ""}`))
                .map((p, i) => {
                  const key = `${p.type}|${p.trigger ?? ""}`;
                  return (
                    <li key={i} style={{ borderLeft: "3px solid #9a7aff", paddingLeft: "0.6rem" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span>
                          {p.type}
                          {p.trigger ? <span style={{ opacity: 0.7, fontWeight: 400 }}> · often around “{p.trigger}”</span> : null}
                          {p.repeats > 1 ? <span style={{ opacity: 0.7, fontWeight: 400 }}> · ×{p.repeats}</span> : null}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.76rem", opacity: 0.85 }}>{p.intervention}</div>
                      {/* REG-153 / INS-06: the pattern's basis (days counted,
                          window) — a health-flavored label never stands
                          without its evidence. */}
                      {p.basis && (
                        <div style={{ fontSize: "0.72rem", opacity: 0.7, marginTop: "0.15rem" }}>{p.basis}</div>
                      )}
                      <button
                        className="mini ghost"
                        style={{ marginTop: "0.3rem" }}
                        title="Noted — stop showing me this pattern"
                        onClick={() => dismissPattern(key)}
                      >
                        ✓ Got it
                      </button>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p style={{ fontSize: "0.76rem", opacity: 0.7, margin: 0 }}>
              {emotional.patterns.length > 0
                ? "You've noted every pattern Soumaya's spotted so far."
                : "No strong patterns yet — your mood reads as steady."}
            </p>
          )}
          </>
          )}
        </section>
      )}

      {/* How your thinking evolved — same-theme memories across time (offline, free). */}
      {showEvolution && (
        <section className="evolution" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>🔗 How your thinking evolved</h3>
            <SectionToggle name="How your thinking evolved" open={sectionOpen("evolution")} onToggle={() => toggleSection("evolution")} />
          </div>
          {sectionOpen("evolution") && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {evolution.map((e) => {
              const strength = EVOLUTION_STRENGTH[e.strength] ?? EVOLUTION_STRENGTH.medium;
              return (
              <li key={`${e.fromId}-${e.toId}`} style={{ borderLeft: "3px solid #5ee6a0", paddingLeft: "0.6rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                  <button className="pill" onClick={() => onFocus(e.fromId)} title="Fly to the earlier memory">{e.fromLabel}</button>
                  <span style={{ opacity: 0.6 }}>→</span>
                  <button className="pill" onClick={() => onFocus(e.toId)} title="Fly to the later memory">{e.toLabel}</button>
                  {/* IM-59: the time gap was only ever inside the reason
                      string — render it as its own element. */}
                  <span className="evolution-gap" style={{ fontSize: "0.68rem", opacity: 0.75 }}>
                    {evolutionGapLabel(e.temporalDistanceDays)}
                  </span>
                  {/* IM-63: strength was the bare uppercase enum while
                      siblings show bars — human label + bar here too. */}
                  <span
                    className="evolution-strength"
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.66rem", opacity: 0.85 }}
                    title={`How strongly the two memories connect: ${e.strength}`}
                  >
                    <span style={{ width: "36px", height: "5px", background: "rgba(255,255,255,0.12)", borderRadius: "3px", overflow: "hidden", display: "inline-block" }}>
                      <span style={{ display: "block", height: "100%", width: `${strength.pct}%`, background: "#5ee6a0" }} />
                    </span>
                    {strength.label}
                  </span>
                </div>
                <div style={{ fontSize: "0.74rem", opacity: 0.8, marginTop: "0.2rem" }}>{e.reason}</div>
              </li>
              );
            })}
          </ul>
          )}
        </section>
      )}

      {/* Dormant & worth reviving — once-active skills/goals gone quiet (offline, free). */}
      {showDormant && (
        <section className="dormant" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>💤 Dormant &amp; worth reviving</h3>
            <SectionToggle name="Dormant & worth reviving" open={sectionOpen("dormant")} onToggle={() => toggleSection("dormant")} />
          </div>
          {sectionOpen("dormant") && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {dormant.map((d) => (
              <li key={d.nodeId} style={{ borderLeft: "3px solid #6fb6ff", paddingLeft: "0.6rem" }}>
                <button
                  className="pill"
                  style={{ borderColor: colorForType(d.type), fontWeight: 600 }}
                  onClick={() => onFocus(d.nodeId)}
                  title="Fly to this memory and revive it"
                >
                  {d.label}
                </button>
                <span style={{ fontSize: "0.72rem", opacity: 0.6, marginLeft: "0.4rem" }}>· quiet {d.dormantDays}d</span>
                <div style={{ fontSize: "0.76rem", opacity: 0.85, marginTop: "0.2rem" }}>{d.hypothesis}</div>
                {/* IM-59: the reactivation nudge the server writes for each
                    dormant item was fetched and never rendered. */}
                {d.prompt && (
                  <div className="dormant-prompt" style={{ fontSize: "0.76rem", opacity: 0.95, marginTop: "0.25rem" }}>
                    💡 {d.prompt}
                  </div>
                )}
              </li>
            ))}
          </ul>
          )}
        </section>
      )}

      <div className="dock-head">
        <h3>Latent connections</h3>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button className="mini" onClick={run} disabled={busy}>
            {busy ? "Scanning…" : "🔍 Find new links"}
          </button>
          <button className="mini" onClick={scanContradictions} disabled={busy} title="Scan same-topic memories for conflicting beliefs, reversed goals, or shifting identity">
            ⚡ Find contradictions
          </button>
        </div>
        <SectionToggle name="Latent connections" open={sectionOpen("insights")} onToggle={() => toggleSection("insights")} />
      </div>
      {sectionOpen("insights") && (
      <>
      {/* REG-149 / INS-02: when the insights source failed and there is no
          last-good list, say the load failed — never "No insights yet". */}
      {failedSources.has("insights") && items.length === 0 && (
        <p className="empty" role="alert">
          Couldn&apos;t load insights — the server didn&apos;t answer. Use Retry above to try again.
        </p>
      )}
      {!(failedSources.has("insights") && items.length === 0) && items.length === 0 && (
        <p className="empty">
          No insights yet. Dump a few related thoughts, then hit "🔍 Find new links" above to surface
          connections you haven&apos;t drawn.
        </p>
      )}
      {items.length > 0 && searching && filteredInsights.length === 0 && (
        <p className="empty">No insights match your search.</p>
      )}
      <ul className="insights">
        {shownInsights.map((it) => {
          const isConflict = it.kind === "contradiction";
          // IM-57: the insight's own strength + age were fetched but never
          // shown — a months-old weak hunch read identically to today's
          // strongest connection.
          const scorePct =
            typeof it.score === "number" && Number.isFinite(it.score)
              ? Math.round(Math.min(1, Math.max(0, it.score)) * 100)
              : null;
          const createdLabel = fmtLocalDate(it.createdAt);
          return (
            <li
              key={it.id}
              style={isConflict ? { borderLeft: "3px solid #ff7a59", paddingLeft: "0.6rem" } : undefined}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
                {isConflict && (
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#ff7a59", letterSpacing: "0.04em" }}>
                    ⚡ CONTRADICTION
                  </span>
                )}
                {/* IM-58: the resolve affordance used to render ONLY for
                    contradictions, though the server resolves (deletes +
                    tends both memories) for ANY insight kind — a wrong
                    synthesis insight could never be dismissed. Every kind
                    now gets the button; contradictions keep their
                    "Reconciled" wording, the rest read as Dismiss. */}
                <button
                  className="mini"
                  title={
                    isConflict
                      ? "Mark reconciled — clears this and warms both memories"
                      : "Dismiss this insight — clears it and warms both memories"
                  }
                  onClick={() => {
                    void resolveInsight(it.id).then((ok) => {
                      if (ok) {
                        setItems((prev) => prev.filter((x) => x.id !== it.id));
                        if (isConflict) {
                          pushToast("Reconciled — both memories warmed ✓", "⚡", 4500);
                        } else {
                          pushToast("Insight dismissed — both memories warmed ✓", "✓", 4500);
                        }
                      } else {
                        pushToast(
                          isConflict ? "Couldn't reconcile that — try again." : "Couldn't dismiss that — try again.",
                          "⚠️",
                          3500,
                        );
                      }
                    });
                  }}
                >
                  {isConflict ? "✓ Reconciled" : "Dismiss"}
                </button>
                <span
                  style={{ fontSize: "0.66rem", opacity: 0.7 }}
                  title={`Tier ${it.tier ?? 3} — surfaced ${it.tier === 1 ? "first" : it.tier === 2 ? "after identity-level" : "last"}`}
                >
                  {TIER_LABEL[it.tier ?? 3]}
                </span>
                {scorePct !== null && (
                  <span
                    className="insight-strength"
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.66rem", opacity: 0.85 }}
                    title={`Strength ${scorePct}% — how strong or surprising this connection is`}
                  >
                    <span style={{ width: "44px", height: "5px", background: "rgba(255,255,255,0.12)", borderRadius: "3px", overflow: "hidden", display: "inline-block" }}>
                      <span style={{ display: "block", height: "100%", width: `${scorePct}%`, background: "#7af9ff" }} />
                    </span>
                    {scorePct}%
                  </span>
                )}
                {createdLabel && (
                  <span className="insight-date" style={{ fontSize: "0.66rem", opacity: 0.6 }}>
                    {createdLabel}
                  </span>
                )}
              </div>
              <p className="insight-text">{it.text}</p>
              <div className="pills">
                {it.nodes.map((n) => (
                  <button
                    key={n.id}
                    className="pill"
                    style={{ borderColor: colorForType(n.type) }}
                    onClick={() => onFocus(n.id)}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {filteredInsights.length > INSIGHT_CAP && (
        <button className="mini" style={{ marginTop: "0.4rem" }} onClick={() => setShowAllInsights((v) => !v)}>
          {showAllInsights ? "Show fewer" : `Show all ${filteredInsights.length}`}
        </button>
      )}
      {/* REG-157 / INS-11: the working set is capped server-side — state it
          where the list truncates. */}
      {items.length >= INSIGHT_SERVER_CAP && (
        <p className="empty small" style={{ marginTop: "0.4rem" }}>
          Showing the {INSIGHT_SERVER_CAP} most recent insights — older ones surface here as these are resolved or
          dismissed.
        </p>
      )}
      </>
      )}
      {searching && !anySectionMatch && (
        <p className="empty" style={{ marginTop: "0.6rem" }}>
          Nothing in this tab matches “{query.trim()}”.
        </p>
      )}
    </div>
  );
}
