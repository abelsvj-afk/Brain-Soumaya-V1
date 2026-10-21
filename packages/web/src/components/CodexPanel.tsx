import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@brain/shared";
import { buildCodex, codexProgress, CODEX_CATEGORIES, fieldNoteEntries, type CodexEntry, type CodexCategory } from "./codex.js";
import { claimCodexReward, getCodexDiscoveries, type AgentDiscovery } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";

/**
 * The Codex — a gamified, living atlas of the galaxy. Entries start locked, unlock as
 * the brain grows (with a completion %), and level up with engagement. Newly-discovered
 * entries fire a toast + claim a small fuel reward once each (server-tracked).
 */
export function CodexPanel({
  graph,
  onFocus,
  spaceId = "",
  onReward,
}: {
  graph: GraphData;
  onFocus: (id: number) => void;
  spaceId?: string;
  onReward?: () => void;
}) {
  // Soumaya's autonomously-charted field notes (server), merged into the atlas.
  const [discoveries, setDiscoveries] = useState<AgentDiscovery[]>([]);
  useEffect(() => {
    getCodexDiscoveries().then(setDiscoveries).catch(() => {});
  }, [spaceId]);

  const entries = useMemo(() => {
    const nodes = graph.nodes as GraphNode[];
    return [
      ...buildCodex({
        memories: nodes.filter((n) => n.kind !== "action" && n.kind !== "moc"),
        constellations: nodes.filter((n) => n.kind === "moc"),
        links: graph.links.length,
      }),
      ...fieldNoteEntries(discoveries),
    ];
  }, [graph, discoveries]);
  const progress = useMemo(() => codexProgress(entries), [entries]);
  const [tab, setTab] = useState<CodexCategory>("sectors");
  const seenRef = useRef<Set<string>>(new Set());

  const claimingRef = useRef<Set<string>>(new Set());

  // Fire a discovery toast + claim the reward once per newly-discovered entry.
  // IM-93: an entry is marked seen ONLY once its claim has settled successfully —
  // a failed claim (server rejection, offline) leaves it fresh so the fuel can
  // still be claimed on a later visit, and the failure surfaces as a toast
  // instead of being swallowed.
  useEffect(() => {
    if (!spaceId) return;
    const key = `codex.seen.${spaceId}`;
    let seen: Set<string>;
    try {
      seen = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      seen = new Set();
    }
    seenRef.current = seen;
    const fresh = entries.filter((e) => e.discovered && !seen.has(e.id) && !claimingRef.current.has(e.id));
    if (fresh.length === 0) return;
    for (const e of fresh) claimingRef.current.add(e.id);
    for (const e of fresh.slice(0, 4)) {
      pushToast(`Codex: discovered “${e.title}”`, "📖", 6000, "high");
    }
    let cancelled = false;
    void (async () => {
      let failed = 0;
      for (const e of fresh) {
        try {
          const r = await claimCodexReward(e.id);
          if (r?.failed) {
            failed++;
          } else {
            seen.add(e.id);
            // `claimCodexReward` is async, so the chime has to fire from inside
            // this callback — checking a flag synchronously after the loop (as
            // before) always read it as false.
            if (r?.awarded) {
              onReward?.();
              playSfx("achievement");
            }
          }
        } catch {
          failed++;
        } finally {
          claimingRef.current.delete(e.id);
        }
      }
      try {
        localStorage.setItem(key, JSON.stringify([...seen]));
      } catch {
        /* ignore */
      }
      if (!cancelled && failed > 0) {
        pushToast(
          `Codex: ${failed} reward claim${failed === 1 ? "" : "s"} didn't go through — will retry on your next visit`,
          "⛽",
          6000,
          "high",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, spaceId]);

  const shown = entries.filter((e) => e.category === tab);

  return (
    <div className="dock-body" style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <div className="dock-head">
        <h3>📖 Codex</h3>
        <span style={{ fontSize: "0.76rem", opacity: 0.75 }}>
          {progress.discovered}/{progress.total} · {progress.pct}%
        </span>
      </div>
      <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden", marginBottom: "0.9rem" }}>
        <div style={{ height: "100%", width: `${progress.pct}%`, background: "linear-gradient(90deg,#7af9ff,#c9a0ff)" }} />
      </div>

      {/* Category chips */}
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
        {CODEX_CATEGORIES.map((c) => {
          const p = progress.byCategory[c.id];
          const on = tab === c.id;
          return (
            <button
              key={c.id}
              className="mini"
              onClick={() => setTab(c.id)}
              style={{
                borderColor: on ? "var(--accent)" : "rgba(255,255,255,0.14)",
                background: on ? "rgba(122,249,255,0.12)" : "transparent",
                fontSize: "0.74rem",
              }}
            >
              {c.icon} {c.title} <span style={{ opacity: 0.6 }}>{p.discovered}/{p.total}</span>
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: "0.76rem", opacity: 0.65, margin: "0 0 0.8rem 0" }}>
        {CODEX_CATEGORIES.find((c) => c.id === tab)?.blurb}
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {shown.map((e) => (
          <CodexRow key={e.id} entry={e} onFocus={onFocus} isNew={e.discovered && !seenRef.current.has(e.id)} />
        ))}
      </ul>
    </div>
  );
}

function CodexRow({ entry: e, onFocus, isNew }: { entry: CodexEntry; onFocus: (id: number) => void; isNew: boolean }) {
  const locked = !e.discovered;
  return (
    <li
      style={{
        border: "1px solid " + (locked ? "rgba(255,255,255,0.06)" : "rgba(122,200,255,0.2)"),
        borderRadius: 10,
        padding: "0.7rem 0.8rem",
        opacity: locked ? 0.55 : 1,
        background: locked ? "rgba(255,255,255,0.015)" : "rgba(122,249,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "1.1rem", filter: locked ? "grayscale(1)" : "none" }}>{locked ? "🔒" : e.icon}</span>
        <span style={{ fontWeight: 600, fontSize: "0.9rem", flex: 1 }}>{locked ? "??? — undiscovered" : e.title}</span>
        {isNew && !locked && (
          <span style={{ fontSize: "0.6rem", fontWeight: 700, background: "#ff7af9", color: "#fff", padding: "1px 5px", borderRadius: 4 }}>NEW</span>
        )}
        {e.focusId != null && !locked && (
          <button className="mini" style={{ padding: "0.1rem 0.4rem", fontSize: "0.7rem" }} onClick={() => onFocus(e.focusId!)} title="Fly to it">
            ✦
          </button>
        )}
      </div>
      <p style={{ fontSize: "0.78rem", opacity: 0.85, margin: "0.4rem 0 0.35rem 0", lineHeight: 1.4 }}>
        {locked ? e.lockedHint : e.lore}
      </p>
      {!locked && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {e.maxLevel > 1 && (
            <span style={{ display: "flex", gap: 2 }} title={`Level ${e.level} of ${e.maxLevel}`}>
              {Array.from({ length: e.maxLevel }).map((_, i) => (
                <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i < e.level ? "#7af9ff" : "rgba(255,255,255,0.15)" }} />
              ))}
            </span>
          )}
          <span style={{ fontSize: "0.7rem", opacity: 0.65 }}>{e.levelLabel}</span>
          {e.progressToNext && (
            <span style={{ fontSize: "0.68rem", opacity: 0.5, marginLeft: "auto" }}>
              {e.progressToNext.cur}/{e.progressToNext.target} to next
            </span>
          )}
        </div>
      )}
    </li>
  );
}
