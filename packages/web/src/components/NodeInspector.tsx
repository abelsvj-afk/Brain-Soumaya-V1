import { useEffect, useMemo, useRef, useState } from "react";
import { type GraphData, type GraphNode, CELESTIAL_ICON, CELESTIAL_LABEL, CELESTIAL_CLASSES, NODE_TYPE_LABEL, normalizeNodeType } from "@brain/shared";
import { deleteNode, archiveNode, setImportance, synthesizeNode, answerResearch, requestMaintenance } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { colorForType } from "../graph/theme.js";
import { loreFor } from "../graph/lore.js";
import { MarkdownView } from "./MarkdownView.js";
import { Chronicle } from "./Chronicle.js";
import { MemoryAttachments } from "./MemoryAttachments.js";
import { playSfx } from "../graph/sfx.js";
import type { Journey } from "@brain/shared";
import { getJourneys, journeysForNode, linkToJourney, unlinkFromJourney } from "../api/journeys.js";

interface Props {
  node: GraphNode | null;
  graph: GraphData;
  onFocus: (id: number) => void;
  /** Called after a node's weight is changed so the galaxy can re-render. */
  onChanged?: (id: number) => void;
  /** Called after a node is deleted. */
  onDeleted?: () => void;
  /** Show only this memory + the bodies orbiting it. */
  onIsolate?: (id: number) => void;
  onTagClick?: (tag: string) => void;
}

const end = (v: number | { id: number }): number => (typeof v === "object" ? v.id : v);

/** Friendly absolute date + relative hint, tolerant of SQLite "YYYY-MM-DD HH:MM:SS". */
function fmtWhen(raw: string): string {
  const iso = raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return raw;
  const abs = new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const days = Math.round((t - Date.now()) / 8.64e7);
  let rel = "";
  if (days === 0) rel = "today";
  else if (days === -1) rel = "yesterday";
  else if (days === 1) rel = "tomorrow";
  else if (days < 0) rel = `${-days}d ago`;
  else rel = `in ${days}d`;
  return `${abs} · ${rel}`;
}

/** Plain-language "why is it this size" from the node's real mass signals —
 *  turns an abstract weight% into understanding you learn by seeing it. */
function sizeReason(n: GraphNode): string {
  const bits: string[] = [];
  if ((n.importance ?? 0) >= 0.66) bits.push("it matters to you");
  else if ((n.importance ?? 0) <= 0.3) bits.push("it's a lighter note");
  if ((n.degree ?? 0) >= 6) bits.push("it's richly connected");
  else if ((n.degree ?? 0) >= 2) bits.push(`${n.degree} connections`);
  else bits.push("few connections yet");
  if (Math.abs(n.emotionalWeight ?? 0) >= 0.5) bits.push("it carries real feeling");
  const created = n.createdAt ? Date.parse(n.createdAt.replace(" ", "T") + "Z") : NaN;
  if (!Number.isNaN(created) && Date.now() - created > 60 * 8.64e7) bits.push("you've kept it a while");
  return bits.slice(0, 3).join(", ");
}

export function NodeInspector({ node, graph, onFocus, onChanged, onDeleted, onIsolate, onTagClick }: Props) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 720);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [weight, setWeight] = useState<number>(node?.importance ?? 0.4);
  const [insight, setInsight] = useState<string>("");
  const [synthBusy, setSynthBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [researchSubmitting, setResearchSubmitting] = useState(false);
  const [researchError, setResearchError] = useState("");

  // Clear any shown insight when switching memories.
  useEffect(() => {
    setInsight("");
    setAnswers({});
    setResearchError("");
    setRequested(false);
  }, [node?.id]);

  const runSynthesis = () => {
    if (!node) return;
    setSynthBusy(true);
    setInsight("");
    synthesizeNode(node.id)
      .then((r) => setInsight(r.text))
      .catch((e) => setInsight(`(couldn't synthesize: ${(e as Error).message})`))
      .finally(() => setSynthBusy(false));
  };

  // Keep the slider in sync when a different node is selected.
  useEffect(() => {
    setWeight(node?.importance ?? 0.4);
  }, [node?.id, node?.importance]);

  // Debounced persist so dragging the slider doesn't spam the API.
  const commitWeight = (value: number | null) => {
    if (!node) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setImportance(node.id, value)
        .then(() => onChanged?.(node.id))
        .catch(() => {});
    }, 350);
  };

  // Direct connections, computed from the in-memory graph (no API round-trip).
  // Fixes "N links but 0 connections".
  const neighbors = useMemo(() => {
    if (!node) return [];
    const ids = new Set<number>();
    for (const l of graph.links) {
      const s = end(l.source as never);
      const t = end(l.target as never);
      if (s === node.id) ids.add(t);
      else if (t === node.id) ids.add(s);
    }
    return graph.nodes.filter((n) => ids.has(n.id));
  }, [node, graph]);

  if (!node) {
    return <p className="empty">Click a star to inspect a memory and its connections.</p>;
  }

  return (
    <div className="dock-body">
      {/* Special-body cue first, so beliefs/constellations read distinctly. */}
      {node.kind === "belief" ? (
        <span className="chip belief-chip" title="A belief Soumaya consolidated about you (dream cycles)">
          🖤 Belief she formed
        </span>
      ) : node.kind === "moc" ? (
        <span className="chip" style={{ background: "#ffe9a8", color: "#1a1400" }} title="A constellation hub — a Map of Content">
          🌌 Constellation
        </span>
      ) : (
        <span className="chip" style={{ background: colorForType(node.type) }}>
          {NODE_TYPE_LABEL[normalizeNodeType(node.type)]}
        </span>
      )}
      {node.origin === "agent" && node.kind !== "belief" && node.kind !== "moc" && (
        <span className="chip provenance-chip" title="Soumaya authored this — a constellation hub she charted">
          ✦ Charted by Soumaya
        </span>
      )}
      {node.celestial && node.kind !== "belief" && node.kind !== "moc" && (
        <>
          <span className="meta">
            {CELESTIAL_ICON[node.celestial]} {CELESTIAL_LABEL[node.celestial]} · weight{" "}
            {Math.round((node.mass ?? 0) * 100)}%
            {node.degree ? ` · ${node.degree} link${node.degree === 1 ? "" : "s"}` : ""}
          </span>
          {/* Why it's this size — the legend, applied in context so it sticks. */}
          <span className="size-reason" title="What gives this memory its gravitational mass">
            {CELESTIAL_ICON[node.celestial]} A {CELESTIAL_LABEL[node.celestial]} because {sizeReason(node)}.
          </span>
        </>
      )}
      <h2>{node.label}</h2>
      {node.celestialTitle && (
        <p className="celestial-title" style={{ fontStyle: "italic", opacity: 0.8, marginTop: "-0.5rem", marginBottom: "1rem" }}>
          "{node.celestialTitle}"
        </p>
      )}
      {(() => {
        // Structured content (Soumaya's research reports) gets the report card treatment;
        // a plain short memory just renders as clean text.
        const isReport = /(^|\n)#{1,4}\s|(^|\n)\s*[-*]\s|(^|\n)\s*\d+\.\s/.test(node.content || "");
        return <MarkdownView text={node.content} className={`content md${isReport ? " md-report" : ""}`} />;
      })()}

      {node.researchQuestions && node.researchQuestions.length > 0 && (
        <details
          className="dock-section research-questions-details"
          open={!isMobile}
          style={{
            marginTop: "1.25rem",
            marginBottom: "1.25rem",
            borderRadius: "8px",
            background: "rgba(255, 171, 0, 0.08)",
            border: "1px solid rgba(255, 171, 0, 0.25)",
          }}
        >
          <summary style={{
            padding: "1rem",
            cursor: "pointer",
            fontWeight: "bold",
            color: "#ffab00",
            fontSize: "0.95rem",
            listStyle: "none"
          }}>
            🛸 Clarifying Research Questions
          </summary>
          <div style={{ padding: "0 1rem 1rem 1rem" }}>
            <p style={{ fontSize: "0.82rem", opacity: 0.85, margin: "0 0 1rem 0" }}>
              Soumaya needs more context to finalize the deep-dive research for this memory.
            </p>
            {researchError && (
              <p style={{ color: "#ff5252", fontSize: "0.82rem", margin: "0 0 0.75rem 0" }}>
                {researchError}
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {node.researchQuestions.map((q) => (
                <div key={q} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <label style={{ fontSize: "0.82rem", fontWeight: 500, color: "#eaf2ff" }}>{q}</label>
                  <textarea
                    style={{
                      width: "100%",
                      background: "rgba(10, 12, 28, 0.6)",
                      border: "1px solid rgba(122, 200, 255, 0.25)",
                      borderRadius: "4px",
                      color: "#fff",
                      padding: "0.5rem",
                      fontSize: "0.86rem",
                      fontFamily: "inherit",
                      resize: "vertical",
                      minHeight: "50px",
                    }}
                    value={answers[q] ?? ""}
                    onChange={(e) => {
                      setAnswers((prev) => ({ ...prev, [q]: e.target.value }));
                    }}
                    placeholder="Type your response..."
                  />
                </div>
              ))}
            </div>
            <button
              className="synth-btn"
              style={{
                marginTop: "1rem",
                background: "linear-gradient(135deg, #ffab00 0%, #ff8f00 100%)",
                color: "#0a0c1c",
                fontWeight: "bold",
                borderColor: "transparent",
              }}
              disabled={researchSubmitting || node.researchQuestions.some(q => !(answers[q] ?? "").trim())}
              onClick={() => {
                setResearchSubmitting(true);
                setResearchError("");
                answerResearch(node.id, answers)
                  .then(() => {
                    onChanged?.(node.id);
                  })
                  .catch((e) => {
                    setResearchError((e as Error).message);
                  })
                  .finally(() => {
                    setResearchSubmitting(false);
                  });
              }}
            >
              {researchSubmitting ? "Submitting Context..." : "Submit Clarification"}
            </button>
          </div>
        </details>
      )}

      {(node.tags?.length || node.occurredAt || node.remindAt) && (
        <div className="node-meta">
          {node.tags && node.tags.length > 0 && (
            <div className="node-tags">
              {node.tags.map((t) => (
                <button
                  key={t}
                  className="tag-chip clickable"
                  onClick={() => onTagClick?.(t)}
                  title={`Filter by tag #${t}`}
                  style={{
                    background: "rgba(122, 162, 255, 0.08)",
                    border: "1px solid rgba(122, 162, 255, 0.25)",
                    cursor: "pointer",
                  }}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
          {node.occurredAt && (
            <p className="node-when">🕰️ Happened {fmtWhen(node.occurredAt)}</p>
          )}
          {node.remindAt && <p className="node-when">⏰ Reminder {fmtWhen(node.remindAt)}</p>}
        </div>
      )}

      {node.kind !== "action" && <JourneyChips nodeId={node.id} />}

      {node.kind === "action" ? (
        <div className="action-due">
          <span>
            ⏰{" "}
            {(() => {
              const rawDate = node.expiresAt ?? "";
              const isoDate = rawDate.includes("Z") ? rawDate : rawDate.replace(" ", "T") + "Z";
              const exp = Date.parse(isoDate);
              const now = Date.now();
              return exp > now
                ? `due in ~${Math.max(1, Math.round((exp - now) / 3.6e6))}h`
                : "overdue — will clear soon";
            })()}
          </span>
          {onDeleted && (
            <button
              className="mini"
              onClick={() => {
                deleteNode(node.id)
                  .then(() => onDeleted())
                  .catch(() => {});
              }}
            >
              ✓ Done
            </button>
          )}
        </div>
      ) : (
        <p className="lore">✦ {loreFor(node)}</p>
      )}

      {node.kind !== "action" && (
        <details className="dock-section" open={!isMobile}>
          <summary>📜 Chronicle / History</summary>
          <div style={{ padding: "10px" }}>
            <Chronicle subjectType="memory" subjectId={String(node.id)} />
          </div>
        </details>
      )}

      {node.kind !== "action" && (
        <details className="dock-section" open={!isMobile}>
          <summary>📎 Attachments</summary>
          <div style={{ padding: "10px" }}>
            <MemoryAttachments nodeId={node.id} />
          </div>
        </details>
      )}

      <div className="weight">
        <div className="weight-head">
          <h3>Weight (gravity)</h3>
          <button
            className="link-btn"
            title="Reset to the automatic rating (offline, no API)"
            onClick={() => {
              commitWeight(null);
            }}
          >
            auto
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(weight * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setWeight(v);
            commitWeight(v);
          }}
        />
        <span className="weight-val">{Math.round(weight * 100)}%</span>
        <div className="tier-legend" aria-hidden="true">
          {CELESTIAL_CLASSES.map((c) => (
            <span
              key={c}
              className={`tier-step ${node.celestial === c ? "on" : ""}`}
              title={CELESTIAL_LABEL[c]}
            >
              {CELESTIAL_ICON[c]}
            </span>
          ))}
        </div>
        <div className="tier-current">{node.celestial ? CELESTIAL_LABEL[node.celestial] : ""}</div>
      </div>

      {onDeleted && (node.kind == null || node.kind === "memory") && (
        <button
          className="archive-btn"
          title="Rest this memory — it leaves the galaxy and stops surfacing in chat, but is kept and can be restored anytime from Browse → Archived."
          onClick={() => {
            void archiveNode(node.id, true).then((ok) => {
              if (ok) onDeleted();
            });
          }}
        >
          📥 Archive (rest it)
        </button>
      )}

      {onDeleted && (
        <button
          className="delete-btn"
          onClick={() => {
            if (!confirm(`Delete "${node.label}"? This can't be undone.`)) return;
            playSfx("delete");
            deleteNode(node.id)
              .then(() => onDeleted())
              .catch(() => {});
          }}
        >
          🗑 Delete memory
        </button>
      )}

      <button className="synth-btn" onClick={runSynthesis} disabled={synthBusy}>
        {synthBusy ? "Connecting…" : "✨ Connect the dots"}
      </button>
      {insight && <p className="insight-text">{insight}</p>}

      {node.kind !== "action" && (
        <button
          className="synth-btn"
          disabled={requested}
          onClick={async () => {
            const ok = await requestMaintenance(node.id);
            if (ok) {
              setRequested(true);
              pushToast(`Soumaya will tend "${node.label.slice(0, 30)}" on her next round.`, "🛰️", 6000);
            }
          }}
          title="She'll prioritize this memory on her next round. With Research Mode on (and fuel in the tank) she deep-dives it — that spends 2 ⛽; otherwise it's a free recalibration."
        >
          {requested ? "🛰️ Queued for Soumaya" : "🛰️ Ask Soumaya to tend this · up to 2 ⛽"}
        </button>
      )}

      {onIsolate && (
        <button className="synth-btn" onClick={() => onIsolate(node.id)}>
          🔭 Isolate this system
        </button>
      )}

      <h3>Connected ({neighbors.length})</h3>
      <ul className="neighbors">
        {neighbors.map((n) => (
          <li key={n.id}>
            <button onClick={() => onFocus(n.id)}>
              <span className="dot" style={{ background: colorForType(n.type) }} />
              {n.label}
            </button>
          </li>
        ))}
        {neighbors.length === 0 && <li className="empty">No connections yet.</li>}
      </ul>
    </div>
  );
}

/**
 * Which Journeys this memory belongs to + add/remove (Vision 2.0: everything belongs to a
 * Journey). Links only — the memory itself is untouched. Offline-safe (guards on null).
 */
function JourneyChips({ nodeId }: { nodeId: number }) {
  const [mine, setMine] = useState<Journey[]>([]);
  const [all, setAll] = useState<Journey[]>([]);
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    const [m, a] = await Promise.all([journeysForNode(nodeId), getJourneys()]);
    setMine(m ?? []);
    setAll(a ?? []);
  };
  useEffect(() => { void refresh(); }, [nodeId]);

  const mineIds = new Set(mine.map((j) => j.id));
  const addable = all.filter((j) => !mineIds.has(j.id) && j.status !== "done");

  return (
    <div className="ni-journeys">
      <div className="ni-journeys-label">🧭 Journeys</div>
      <div className="ni-journeys-row">
        {mine.map((j) => (
          <span key={j.id} className="jn-chip on">
            {j.icon ?? "🧭"} {j.title}
            <button className="jn-chip-x" aria-label={`Remove from ${j.title}`}
              onClick={async () => { await unlinkFromJourney(j.id, "node", nodeId); await refresh(); }}>×</button>
          </span>
        ))}
        {mine.length === 0 && !adding && <span className="ni-journeys-empty">Not part of a journey yet.</span>}
        {!adding && (all.length === 0
          ? <span className="ni-journeys-empty">Create a journey in the 🧭 tab first.</span>
          : addable.length > 0 && <button className="jn-chip add" onClick={() => setAdding(true)}>＋ Add</button>)}
      </div>
      {adding && (
        <div className="ni-journeys-add">
          {addable.map((j) => (
            <button key={j.id} className="jn-chip" onClick={async () => { await linkToJourney(j.id, "node", nodeId); setAdding(false); await refresh(); }}>
              {j.icon ?? "🧭"} {j.title}
            </button>
          ))}
          <button className="jn-chip" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
