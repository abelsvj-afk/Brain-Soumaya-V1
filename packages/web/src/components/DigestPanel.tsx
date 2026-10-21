import { useEffect, useMemo, useState } from "react";
import type { Constellation, DailyDigest, DormantItem, EmotionalTrajectory, EvolutionLink, Insight, LifeAreaCount, SelfReviewItem } from "@brain/shared";
import { getConstellations, getDailyDigest, getDailyLog, getDigest, getDormant, getEmotionalTrajectory, getEvolutionLinks, getLifeAreas, getSelfReview, getBeliefs, ingestText, getSpaceId, promoteConstellation, resolveInsight, runDigest, runContradictions, type DailyLog, type Belief } from "../api/client.js";
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

/** Dependency-free valence sparkline (−1..1). Green above the midline, red below. */
function MoodSparkline({ points }: { points: EmotionalTrajectory["points"] }) {
  if (points.length < 2) return null;
  const W = 240;
  const H = 44;
  const n = points.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H / 2 - (v * (H / 2 - 3)); // +1 → top, −1 → bottom
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.valence).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} aria-label="Mood over time">
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      <path d={line} fill="none" stroke="#7af9ff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.valence)} r={2} fill={p.valence >= 0 ? "#5ee6a0" : "#ff7a59"} />
      ))}
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
  const rankedInsights = useMemo(
    () => [...items].sort((a, b) => (a.tier ?? 3) - (b.tier ?? 3) || b.id - a.id),
    [items],
  );
  const shownInsights = showAllInsights ? rankedInsights : rankedInsights.slice(0, INSIGHT_CAP);
  const TIER_LABEL: Record<number, string> = { 1: "identity", 2: "pattern", 3: "situational" };
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
    Promise.all([
      getDigest().catch(() => [] as Insight[]),
      getDailyDigest().catch(() => null as DailyDigest | null),
      getConstellations().catch(() => [] as Constellation[]),
      getEmotionalTrajectory().catch(() => null as EmotionalTrajectory | null),
      getDormant().catch(() => [] as DormantItem[]),
      getEvolutionLinks().catch(() => [] as EvolutionLink[]),
      getLifeAreas().catch(() => [] as LifeAreaCount[]),
      getSelfReview().catch(() => [] as SelfReviewItem[]),
      getDailyLog().catch(() => null as DailyLog | null),
      getBeliefs().catch(() => [] as Belief[]),
    ])
      .then(([
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
      ]) => {
        if (cancelled) return;
        setItems(itemsRes);
        setDaily(dailyRes);
        setConstellations(constellationsRes);
        setEmotional(emotionalRes);
        setDormant(dormantRes);
        setEvolution(evolutionRes);
        setLifeAreas(lifeAreasRes);
        setSelfReview(selfReviewRes);
        if (dailyLogRes) setDailyLog(dailyLogRes);
        setBeliefs(beliefsRes);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    setBusy(true);
    try {
      // Used to give NO feedback either way — a failed scan and a successful one
      // that found nothing looked identical, and a successful one that found
      // several announced nothing. scanContradictions (right below this) already
      // toasts both outcomes; this button behaved completely differently.
      const found = await runDigest();
      const [freshItems, freshDaily, freshConstellations] = await Promise.all([
        getDigest(),
        getDailyDigest(),
        getConstellations(),
      ]);
      setItems(freshItems);
      setDaily(freshDaily);
      setConstellations(freshConstellations);
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
      setItems(await getDigest());
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

  return (
    <div className="dock-body">
      {/* What she believes about you — consolidated from clusters (dream cycles). */}
      {beliefs.length > 0 && (
        <section className="beliefs-section" style={{ marginBottom: "16px" }}>
          <h3>🖤 What she believes about you</h3>
          <p className="empty small" style={{ marginTop: "-4px" }}>
            Durable understanding she's distilled from clusters of your memories — it deepens as you grow.
          </p>
          <ul className="beliefs-list">
            {beliefs.map((b) => (
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
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Captain's Log — her once-a-day narrative entry (autonomous daily_log job). */}
      {dailyLog && (
        <div className="daily-log" style={{ marginBottom: "16px", padding: "1rem", backgroundColor: "rgba(100, 200, 255, 0.05)", borderLeft: "3px solid rgba(100, 200, 255, 0.5)", borderRadius: "0 4px 4px 0" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", color: "rgba(100, 200, 255, 0.9)", fontSize: "13px" }}>
            Captain's Log ({dailyLog.date})
          </h4>
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
        </div>
      )}

      {/* Soumaya's daily digest — her read on the day, with links + her take. */}
      {/* Used to check only fresh/expiredActions/greeting — a day with ONLY cooling
          memories or ONLY due reminders (both real, actionable lists rendered below)
          would silently render nothing at all. */}
      {daily &&
        (daily.fresh.length > 0 ||
          (daily.connections?.length ?? 0) > 0 ||
          daily.expiredActions.length > 0 ||
          daily.cooling.length > 0 ||
          (daily.reminders?.length ?? 0) > 0 ||
          daily.greeting) && (
        <section className="daily-digest">
          <h3>🛰️ Soumaya&apos;s daily digest</h3>
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
        </section>
      )}

      {/* ML constellations — unsupervised k-means groupings of the memories. */}
      {constellations.length > 0 && (
        <section className="constellations">
          <h3>🌌 Constellations</h3>
          <p className="constellations-sub">
            Memories the model grouped by meaning — your galaxy&apos;s natural regions.
          </p>
          <ul className="constellation-list">
            {constellations.map((c) => (
              <li key={c.id}>
                <div className="constellation-head">
                  <strong>{c.name}</strong>
                  <span className="constellation-meta">
                    {c.nodes.length} · {Math.round(c.cohesion * 100)}% tight
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
                {promotingId === c.id ? (
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
            ))}
          </ul>
        </section>
      )}

      {/* Soumaya's self-check — read-only coverage report (#12). */}
      {selfReview.length > 0 && (
        <section className="self-check" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>🔍 Soumaya&apos;s self-check</h3>
          </div>
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
        </section>
      )}

      {/* Life-area lens — optional overlay grouping memories by area of life (#6). */}
      {lifeAreas.length > 0 && (() => {
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
              <span style={{ fontSize: "0.72rem", opacity: 0.6 }}>where your attention goes</span>
            </div>
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
          </section>
        );
      })()}

      {/* Emotional weather — mood trajectory + detected patterns (offline, free). */}
      {emotional && emotional.sampleSize >= 3 && (
        <section className="emotional-weather" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>🌡️ Emotional weather</h3>
            <span style={{ fontSize: "0.72rem", opacity: 0.7 }}>
              {emotional.trend === "rising" ? "↗ brightening" : emotional.trend === "falling" ? "↘ cooling" : "→ steady"}
            </span>
          </div>
          <MoodSparkline points={emotional.points} />
          <p style={{ fontSize: "0.74rem", opacity: 0.7, margin: "0.35rem 0 0.6rem 0" }}>
            Across {emotional.sampleSize} memories · avg mood {emotional.average >= 0 ? "+" : ""}
            {emotional.average.toFixed(2)} · {emotional.volatility >= 0.5 ? "high swings" : "stable"}
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
                      <button
                        className="mini ghost"
                        style={{ marginTop: "0.3rem", fontSize: "0.66rem", padding: "1px 8px" }}
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
        </section>
      )}

      {/* How your thinking evolved — same-theme memories across time (offline, free). */}
      {evolution.length > 0 && (
        <section className="evolution" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>🔗 How your thinking evolved</h3>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {evolution.map((e) => (
              <li key={`${e.fromId}-${e.toId}`} style={{ borderLeft: "3px solid #5ee6a0", paddingLeft: "0.6rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                  <button className="pill" onClick={() => onFocus(e.fromId)} title="Fly to the earlier memory">{e.fromLabel}</button>
                  <span style={{ opacity: 0.6 }}>→</span>
                  <button className="pill" onClick={() => onFocus(e.toId)} title="Fly to the later memory">{e.toLabel}</button>
                  <span style={{ fontSize: "0.68rem", opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.03em" }}>{e.strength}</span>
                </div>
                <div style={{ fontSize: "0.74rem", opacity: 0.8, marginTop: "0.2rem" }}>{e.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Dormant & worth reviving — once-active skills/goals gone quiet (offline, free). */}
      {dormant.length > 0 && (
        <section className="dormant" style={{ marginBottom: "1rem" }}>
          <div className="dock-head">
            <h3>💤 Dormant &amp; worth reviving</h3>
          </div>
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
              </li>
            ))}
          </ul>
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
      </div>
      {items.length === 0 && (
        <p className="empty">
          No insights yet. Dump a few related thoughts, then hit "🔍 Find new links" above to surface
          connections you haven&apos;t drawn.
        </p>
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
                {isConflict && (
                  <button
                    className="mini"
                    style={{ fontSize: "0.66rem", padding: "1px 8px" }}
                    title="Mark reconciled — clears this and warms both memories"
                    onClick={() => {
                      void resolveInsight(it.id).then((ok) => {
                        if (ok) {
                          setItems((prev) => prev.filter((x) => x.id !== it.id));
                          pushToast("Reconciled — both memories warmed ✓", "⚡", 4500);
                        } else {
                          pushToast("Couldn't reconcile that — try again.", "⚠️", 3500);
                        }
                      });
                    }}
                  >
                    ✓ Reconciled
                  </button>
                )}
                <span
                  style={{ fontSize: "0.62rem", opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.04em" }}
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
      {rankedInsights.length > INSIGHT_CAP && (
        <button className="mini" style={{ marginTop: "0.4rem" }} onClick={() => setShowAllInsights((v) => !v)}>
          {showAllInsights ? "Show fewer" : `Show all ${rankedInsights.length}`}
        </button>
      )}
    </div>
  );
}
