import { useMemo, useState } from "react";
import type { GraphData, GraphNode, Fuel, Streak } from "@brain/shared";
import {
  ACHIEVEMENTS,
  loadEarnedAt,
  loadUnlocked,
  unlockedIds,
  type Achievement,
  type AchievementCtx,
} from "./achievements.js";
import { pilotRank } from "./rank.js";

/**
 * The Awards tab — a persistent trophy case. Toasts announce an unlock in the
 * moment; this is where you go to actually *see* what you've earned and what's
 * still locked (with a progress hint), plus your memory-count milestones. Live:
 * recomputes from the current galaxy + fuel each render, unioned with the
 * per-brain persisted set so an earned award never flickers back to locked.
 */
export function AchievementsPanel({
  graph,
  fuel,
  streak,
  spaceId,
}: {
  graph: GraphData;
  fuel: Fuel | null;
  streak: Streak | null;
  spaceId: string;
}) {
  const memories = (graph.nodes as GraphNode[]).filter((n) => n.kind !== "action");
  // IM-94: pass the FULL context — without `linkObjects` the Pathfinder Quest
  // predicate always returns false in this panel, so the award could never
  // show as earned here even when the galaxy satisfies it.
  const ctx: AchievementCtx = { memories, links: graph.links.length, fuel, streak, linkObjects: graph.links };
  // Earned = persisted (sticky) ∪ currently-satisfied, so the case matches the toasts.
  const earned = new Set<string>([...loadUnlocked(spaceId), ...unlockedIds(ctx)]);
  // IM-92: recorded unlock times. Ids earned before timestamps were stored
  // are absent here — they render NO date rather than an invented one.
  const earnedAt = useMemo(() => loadEarnedAt(spaceId), [spaceId]);
  const count = earned.size;
  // Pilot rank — driven by real memories (excludes constellation hubs), matching
  // the same progression that speeds Soumaya up.
  const realCount = memories.filter((n) => n.kind !== "moc").length;
  const rank = pilotRank(realCount);

  // IM-92: grouping/filtering + "closest to unlocking" sort + detail drill-in.
  const [filter, setFilter] = useState<"all" | "earned" | "locked">("all");
  const [closestFirst, setClosestFirst] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const ratioOf = (a: Achievement): number => {
    if (earned.has(a.id)) return 1;
    if (!a.progress) return 0;
    try {
      const p = a.progress(ctx);
      return p.target > 0 ? Math.min(1, p.cur / p.target) : 0;
    } catch {
      return 0;
    }
  };

  const visible = ACHIEVEMENTS.filter((a) =>
    filter === "all" ? true : filter === "earned" ? earned.has(a.id) : !earned.has(a.id),
  );
  const ordered = closestFirst
    ? [...visible].sort((x, y) => {
        const gx = earned.has(x.id) ? 1 : 0;
        const gy = earned.has(y.id) ? 1 : 0;
        if (gx !== gy) return gx - gy; // still-locked first — they're the ones with a distance to close
        return ratioOf(y) - ratioOf(x);
      })
    : visible;
  // Grouped sections only in the default browse mode (All + catalog order).
  const grouped = filter === "all" && !closestFirst;

  const renderCard = (a: Achievement) => {
    const got = earned.has(a.id);
    const p = !got && a.progress ? a.progress(ctx) : null;
    const expanded = expandedId === a.id;
    const at = got ? earnedAt[a.id] : undefined;
    return (
      <li key={a.id} className={`award-card ${got ? "got" : "locked"}`}>
        <span className="award-ic">{got ? a.icon : "🔒"}</span>
        <span className="award-body">
          <button
            type="button"
            className="award-name award-drill"
            aria-expanded={expanded}
            onClick={() => setExpandedId(expanded ? null : a.id)}
            title={expanded ? "Hide details" : "See details"}
          >
            {a.name} <span className="award-drill-caret">{expanded ? "▾" : "▸"}</span>
          </button>
          <span className="award-desc">{a.desc}</span>
          {p && (
            <span className="award-prog">
              <span className="award-prog-bar">
                <span style={{ width: `${Math.min(100, (p.cur / p.target) * 100)}%` }} />
              </span>
              <span className="award-prog-num">
                {p.cur}/{p.target}
              </span>
            </span>
          )}
          {expanded && (
            <span className="award-detail">
              {got ? (
                at ? (
                  <>🏆 Earned on {formatEarnedDate(at)}</>
                ) : (
                  <>🏆 Earned — the date wasn&apos;t recorded for this one.</>
                )
              ) : p ? (
                <>
                  {p.cur} of {p.target} — {Math.max(0, p.target - p.cur)} to go.
                </>
              ) : (
                <>No progress meter for this feat — it unlocks the moment it happens.</>
              )}
            </span>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="dock-body awards">
      <div className="rank-banner">
        <span className="rank-badge">★ Lv {rank.level}</span>
        <span className="rank-body">
          <span className="rank-title">{rank.title}</span>
          <span className="rank-bar">
            <span style={{ width: `${rank.progress * 100}%` }} />
          </span>
          <span className="rank-sub">
            {rank.nextAt != null
              ? `${rank.cur}/${rank.nextAt} memories to next rank`
              : `${rank.cur} memories · top rank`}
          </span>
        </span>
      </div>
      {streak && (
        <div className={`streak-banner ${streak.current > 0 ? "on" : "cold"}`}>
          <span className="streak-flame">🔥</span>
          <span className="streak-text">
            {streak.current > 0 ? (
              <>
                <b>{streak.current}-day</b> tending streak
                {streak.best > streak.current ? ` · best ${streak.best}` : ""}
                {streak.today ? " · fed today ✓" : " · feed a memory today to keep it"}
              </>
            ) : (
              <>
                No active streak — log a memory to start one
                {streak.best > 0 ? ` (best ${streak.best})` : ""}
              </>
            )}
          </span>
        </div>
      )}
      {/* IM-95: the fuel economy belongs in Progress too — until now the fuel
          balance was invisible here and fuel appeared only inside achievement
          predicates. */}
      {fuel && (
        <div className="fuel-banner">
          <span className="fuel-ic">⛽</span>
          <span className="fuel-body">
            <span className="fuel-line">
              <b>{Math.round(fuel.fuel)}</b> / {fuel.capacity} fuel
            </span>
            <span className="fuel-bar">
              <span style={{ width: `${Math.max(0, Math.min(100, (fuel.fuel / fuel.capacity) * 100))}%` }} />
            </span>
            <span className="fuel-sub">
              Fuel powers Soumaya&apos;s autonomous tending — each job she runs costs {fuel.jobCost}. Earn it by
              discovering Codex entries and tending your galaxy.
            </span>
          </span>
        </div>
      )}
      <div className="awards-head">
        <h3 className="awards-title">🏆 Awards</h3>
        <span className="awards-tally">
          {count}/{ACHIEVEMENTS.length}
        </span>
      </div>
      <div className="awards-bar">
        <span style={{ width: `${(count / ACHIEVEMENTS.length) * 100}%` }} />
      </div>

      <div className="awards-controls">
        <span className="awards-filters" role="group" aria-label="Filter awards">
          <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            All
          </button>
          <button type="button" className={filter === "earned" ? "on" : ""} onClick={() => setFilter("earned")}>
            Earned
          </button>
          <button type="button" className={filter === "locked" ? "on" : ""} onClick={() => setFilter("locked")}>
            Locked
          </button>
        </span>
        <button
          type="button"
          className={`awards-sort ${closestFirst ? "on" : ""}`}
          aria-pressed={closestFirst}
          onClick={() => setClosestFirst((v) => !v)}
          title="Sort locked awards by how close they are to unlocking"
        >
          🎯 Closest first
        </button>
      </div>

      {grouped ? (
        <>
          {ordered.some((a) => earned.has(a.id)) && (
            <>
              <h4 className="awards-section-h">Earned ({ordered.filter((a) => earned.has(a.id)).length})</h4>
              <ul className="awards-grid">{ordered.filter((a) => earned.has(a.id)).map(renderCard)}</ul>
            </>
          )}
          {ordered.some((a) => !earned.has(a.id)) && (
            <>
              <h4 className="awards-section-h">Locked ({ordered.filter((a) => !earned.has(a.id)).length})</h4>
              <ul className="awards-grid">{ordered.filter((a) => !earned.has(a.id)).map(renderCard)}</ul>
            </>
          )}
        </>
      ) : (
        <ul className="awards-grid">{ordered.map(renderCard)}</ul>
      )}

      {/* (The milestone pip row is gone — the Pilot Rank banner above IS the
          memory-count ladder now; three parallel count trackers double-celebrated
          the same growth.) */}
    </div>
  );
}

function formatEarnedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
