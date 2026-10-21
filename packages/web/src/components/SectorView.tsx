import { useEffect, useMemo, useRef, useState } from "react";
import { type GraphData, type GraphNode, CELESTIAL_ICON, SECTOR_MASS, NODE_TYPE_LABEL, normalizeNodeType } from "@brain/shared";
import { colorForType } from "../graph/theme.js";
import { parseTolerantMs as msOf } from "../utils/dueReminders.js";
import { fmtBrowseDate } from "../utils/browseFormat.js";
import { playSfx } from "../graph/sfx.js";
import { pushToast } from "./Toasts.js";

interface Props {
  graph: GraphData;
  onFocus: (id: number) => void;
  onIsolate: (id: number) => void;
}

const end = (v: number | { id: number }): number => (typeof v === "object" ? v.id : v);
function toneOf(avg: number): { label: string; color: string } {
  if (avg > 0.2) return { label: "warm", color: "#ffcf6b" };
  if (avg < -0.2) return { label: "heavy", color: "#6bb7ff" };
  return { label: "even", color: "#9b96c4" };
}

/**
 * High-level index of the galaxy's "Hubs" (Sectors). Each card now also explains
 * WHY its memories belong together — shared tags, shared people, the time window
 * they span, and the cluster's emotional tone — so a cluster is legible, not just
 * a blob.
 */
export function SectorView({ graph, onFocus, onIsolate }: Props) {
  // IM-41: hubs had no search. IM-39: cards announced "N memories orbiting"
  // but never listed them — the member set was computed and discarded.
  const [q, setQ] = useState("");
  const [expandedHubs, setExpandedHubs] = useState<Set<number>>(new Set());
  const toggleHub = (id: number) =>
    setExpandedHubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Adjacency once, for system membership + context aggregation.
  const adj = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const l of graph.links) {
      // Matches NodeInspector.tsx's identical `end()` call site — `as never` (not
      // `as any`) so a real shape mismatch still surfaces at compile time.
      const s = end(l.source as never);
      const t = end(l.target as never);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [graph.links]);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const sectors = useMemo(
    () =>
      graph.nodes
        // A transient action item never coheres a "system" the way a real memory
        // hub does — without this, a heavy-enough action could show up as a sector.
        .filter((n) => n.kind !== "action" && (n.mass ?? 0) >= SECTOR_MASS)
        .sort((a, b) => (b.mass ?? 0) - (a.mass ?? 0)),
    [graph.nodes],
  );

  // A memory crossing SECTOR_MASS and becoming a new hub was completely unmarked —
  // no toast, no sound, it just quietly appeared in this list next time you opened
  // it. Celebrate the actual transition, never the initial mount's existing set.
  const prevSectorIds = useRef<Set<number> | null>(null);
  useEffect(() => {
    const ids = new Set(sectors.map((s) => s.id));
    if (prevSectorIds.current) {
      const newOnes = sectors.filter((s) => !prevSectorIds.current!.has(s.id));
      if (newOnes.length === 1) {
        playSfx("milestone");
        pushToast(`A new sector has formed: "${newOnes[0]!.label}" ✦`, "🌌", 5000);
      } else if (newOnes.length > 1) {
        playSfx("milestone");
        pushToast(`${newOnes.length} new sectors have formed ✦`, "🌌", 5000);
      }
    }
    prevSectorIds.current = ids;
  }, [sectors]);

  /** Why this hub's system coheres: shared tags/people/time/tone. */
  const contextForHub = (hub: GraphNode) => {
    const members: GraphNode[] = [hub];
    for (const id of adj.get(hub.id) ?? []) {
      const n = byId.get(id);
      if (n) members.push(n);
    }
    // Shared tags (appear in ≥2 members).
    const tagFreq = new Map<string, number>();
    for (const m of members) for (const t of m.tags ?? []) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
    const tags = [...tagFreq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);
    // People in the system.
    const people = members
      .filter((m) => m.type === "person" && m.id !== hub.id)
      .map((m) => m.label)
      .slice(0, 3);
    // Time span.
    const times = members.map((m) => msOf(m.occurredAt ?? m.createdAt)).filter((t) => !Number.isNaN(t));
    let span = "";
    if (times.length > 1) {
      const days = Math.round((Math.max(...times) - Math.min(...times)) / 8.64e7);
      span = days > 365 ? `~${Math.round(days / 365)}y` : days > 45 ? `~${Math.round(days / 30)}mo` : days > 0 ? `~${days}d` : "same day";
    }
    // Emotional tone.
    const ews = members.map((m) => m.emotionalWeight).filter((x): x is number => typeof x === "number");
    const tone = toneOf(ews.length ? ews.reduce((s, x) => s + x, 0) / ews.length : 0);
    // IM-41: absolute local dates alongside the relative span — the earliest
    // and latest member dates in the viewer's own calendar.
    const validTimes = times.filter((t) => !Number.isNaN(t));
    const spanDates =
      validTimes.length > 0
        ? {
            from: fmtBrowseDate(new Date(Math.min(...validTimes)).toISOString()),
            to: fmtBrowseDate(new Date(Math.max(...validTimes)).toISOString()),
          }
        : null;
    // IM-39: keep the member set — the card lists it on expand instead of
    // announcing a count it never shows.
    return { count: members.length, tags, people, span, tone, members, spanDates };
  };

  // contextFor() used to be re-derived for every sector on every render (it was
  // called straight from inside the .map()) even when neither the graph nor the
  // sector list had changed. Memoized into a lookup, keyed by hub id.
  const contextByHubId = useMemo(() => {
    const m = new Map<number, ReturnType<typeof contextForHub>>();
    for (const s of sectors) m.set(s.id, contextForHub(s));
    return m;
  }, [sectors, adj, byId]);

  if (sectors.length === 0) {
    // The goal (reach SECTOR_MASS) was stated with no sense of how close you
    // actually are — the nearest candidate's mass is trivial to compute.
    const closest = graph.nodes
      .filter((n) => n.kind !== "action")
      .reduce((best, n) => Math.max(best, n.mass ?? 0), 0);
    const pct = Math.round(Math.min(1, closest / SECTOR_MASS) * 100);
    return (
      <div className="dock-body">
        <p className="empty">
          Your galaxy hasn't formed any major sectors yet. Keep adding thoughts and linking
          them to create gravitational hubs.
        </p>
        {closest > 0 && (
          <p className="empty small">Your heaviest memory is {pct}% of the way to forming one.</p>
        )}
      </div>
    );
  }

  // IM-41: search over hub labels AND their members' labels/tags — a hub is
  // findable by the memories orbiting it, not just its own name.
  const needle = q.trim().toLowerCase();
  const visibleSectors = needle
    ? sectors.filter((s) => {
        if (s.label.toLowerCase().includes(needle)) return true;
        const ctx = contextByHubId.get(s.id);
        return (
          ctx?.members.some(
            (m) => m.label.toLowerCase().includes(needle) || (m.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
          ) ?? false
        );
      })
    : sectors;

  return (
    <div className="dock-body">
      <p className="sector-intro">
        The galaxy is divided into <strong>{sectors.length} major sectors</strong>. Focus on a
        hub to explore its connected memories.
      </p>
      <input
        className="list-filter"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${sectors.length} hubs…`}
        aria-label="Search hubs"
      />
      {needle && visibleSectors.length === 0 && (
        <div className="empty" style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", padding: "0.8rem" }}>
          <span>No hubs match “{q.trim()}”.</span>
          <button className="mini" onClick={() => setQ("")}>
            Clear search
          </button>
        </div>
      )}
      <ul className="neighbors sector-list">
        {visibleSectors.map((s) => {
          const ctx = contextByHubId.get(s.id)!;
          // The server's own `degree` is enriched from the full edge set; the
          // locally-recomputed member count silently drops any neighbor whose
          // node object isn't present client-side (e.g. archived/filtered out),
          // which used to under-report "N memories orbiting" in that case.
          const orbiting = s.degree ?? Math.max(ctx.count - 1, 0);
          const expanded = expandedHubs.has(s.id);
          const hubDate = fmtBrowseDate(s.occurredAt ?? s.createdAt);
          const orbiters = ctx.members.filter((m) => m.id !== s.id);
          return (
            <li key={s.id} className="sector-card">
              <div className="sector-header">
                <span className="dot" style={{ background: colorForType(s.type) }} title={NODE_TYPE_LABEL[normalizeNodeType(s.type)]} />
                <span className="sector-name">{s.label}</span>
                <em className="sector-meta">
                  {CELESTIAL_ICON[s.celestial ?? "star"]} {Math.round((s.mass ?? 0) * 100)}% mass
                </em>
              </div>
              {s.celestialTitle && <p className="sector-title">"{s.celestialTitle}"</p>}
              <div className="sector-stats">
                <span>{orbiting} memories orbiting</span>
                {/* IM-41: the hub's own local date was never shown. */}
                {hubDate && <span title="when this hub's memory is from"> · since {hubDate}</span>}
              </div>
              <div className="sector-context">
                <span className="sector-ctx" title="emotional tone">
                  <span className="nl-emodot" style={{ background: ctx.tone.color }} /> {ctx.tone.label}
                </span>
                {ctx.span && (
                  <span className="sector-ctx" title="time span">
                    🗓 {ctx.span}
                    {ctx.spanDates ? ` · ${ctx.spanDates.from} – ${ctx.spanDates.to}` : ""}
                  </span>
                )}
                {ctx.people.length > 0 && (
                  <span className="sector-ctx" title="shared people">
                    👥 {ctx.people.join(", ")}
                  </span>
                )}
                {ctx.tags.map((t) => (
                  <span key={t} className="sector-ctx tag" title="shared tag">
                    #{t}
                  </span>
                ))}
              </div>
              {/* IM-39: the orbiting memories themselves, listable in place —
                  each one flies to its memory. */}
              {orbiters.length > 0 && (
                <button
                  className="mini ghost"
                  aria-expanded={expanded}
                  onClick={() => toggleHub(s.id)}
                  title={expanded ? "Hide the orbiting memories" : "List the orbiting memories"}
                >
                  {expanded ? "▾ Hide members" : `▸ Show ${orbiters.length} orbiting ${orbiters.length === 1 ? "memory" : "memories"}`}
                </button>
              )}
              {expanded && orbiters.length > 0 && (
                <ul className="sector-members" style={{ listStyle: "none", margin: "0.35rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {orbiters.map((m) => (
                    <li key={m.id}>
                      <button
                        className="pill"
                        style={{ borderColor: colorForType(m.type), width: "100%", textAlign: "left" }}
                        onClick={() => onFocus(m.id)}
                        title="Fly to this memory in the galaxy"
                      >
                        <span className="dot" style={{ background: colorForType(m.type) }} /> {m.label}
                        {fmtBrowseDate(m.occurredAt ?? m.createdAt) && (
                          <span style={{ opacity: 0.6, fontSize: "0.85em" }}> · {fmtBrowseDate(m.occurredAt ?? m.createdAt)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="sector-actions">
                <button className="mini" onClick={() => onFocus(s.id)}>
                  ⊙ Focus
                </button>
                <button className="mini primary" onClick={() => onIsolate(s.id)}>
                  🔭 Enter System
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
