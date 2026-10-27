import { useEffect, useMemo, useRef, useState } from "react";
import { type GraphData, type GraphEdge, type GraphNode, type CognitiveKind, CELESTIAL_ICON, CELESTIAL_LABEL, CELESTIAL_CLASSES, NODE_TYPE_LABEL, normalizeNodeType, FUEL_JOB_COST, COGNITIVE_META, skillTier } from "@brain/shared";
import { deleteNode, archiveNode, setImportance, synthesizeNode, answerResearch, requestMaintenance, ingestText, updateNodeDetails, getNeighbors } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { colorForType } from "../graph/theme.js";
import { loreFor } from "../graph/lore.js";
import { MarkdownView } from "./MarkdownView.js";
import { Chronicle } from "./Chronicle.js";
import { MemoryAttachments } from "./MemoryAttachments.js";
import { JourneyChips } from "./JourneyChips.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { DeepDive } from "./DeepDive.js";
import { parseTolerantMs } from "../utils/dueReminders.js";
import { visionTargetDateKey, formatCalendarDate } from "../utils/localDay.js";

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
const NEIGHBORS_SHOWN_CAP = 40;

/** Friendly absolute date + relative hint, tolerant of SQLite "YYYY-MM-DD HH:MM:SS".
 *  An unparseable stored value falls back to a human placeholder (IM-33) —
 *  the raw storage format must never leak into the UI. */
export function fmtWhen(raw: string): string {
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "date unavailable";
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
  // The synthesis insight used to be a dead-end paragraph with no way to keep
  // it. savingInsight/insightSaved reset whenever a fresh insight replaces it.
  const [savingInsight, setSavingInsight] = useState(false);
  const [insightSaved, setInsightSaved] = useState(false);
  const [requested, setRequested] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [researchSubmitting, setResearchSubmitting] = useState(false);
  const [researchError, setResearchError] = useState("");

  // IM-32: synthesis failure gets its OWN error surface — it must never be
  // written into the insight body, where it would read as Soumaya's voice.
  const [synthError, setSynthError] = useState("");

  // IM-26: inline edit of label + body (mirrors the Mind tab's inline edit),
  // persisted through the node PATCH route.
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  // IM-30: neighbour overflow is expandable, not a dead-end "+N more" line.
  const [showAllNeighbors, setShowAllNeighbors] = useState(false);
  // IM-28: edge semantics from GET /nodes/:id/neighbors (relationship + weight
  // for this node's direct links); null until it answers — the in-memory graph
  // already carries the same fields, so the list renders either way and the
  // endpoint's answer replaces/merges when it lands.
  const [endpointLinks, setEndpointLinks] = useState<GraphEdge[] | null>(null);

  // IM-34: node delete confirms through the app dialog, not window.confirm.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Clear any shown insight when switching memories.
  useEffect(() => {
    setInsight("");
    setSynthError("");
    setAnswers({});
    setResearchError("");
    setRequested(false);
    setEditing(false);
    setEditError("");
    setShowAllNeighbors(false);
    setEndpointLinks(null);
    setConfirmingDelete(false);
  }, [node?.id]);

  // IM-28: actually call the neighbors endpoint this tab used to ignore.
  useEffect(() => {
    if (!node) return;
    let alive = true;
    getNeighbors(node.id, 1)
      .then((d) => {
        if (alive) setEndpointLinks(d.links);
      })
      .catch(() => {
        /* getNeighbors is fail-soft; the graph-derived edges below still render */
      });
    return () => {
      alive = false;
    };
  }, [node?.id]);

  // A memory visibly leveling up (moon → planet → ... → supergiant) is the core
  // visual metaphor of this app, but growing into a new tier was never actually
  // marked as a moment — celebrate the real crossing, not just re-detect the same
  // tier every time this memory happens to be reopened.
  const seenTierRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    if (!node?.celestial) return;
    const tierIdx = CELESTIAL_CLASSES.indexOf(node.celestial);
    if (tierIdx < 0) return;
    const prev = seenTierRef.current.get(node.id);
    if (prev !== undefined && tierIdx > prev) {
      playSfx("milestone");
      pushToast(`"${node.label.slice(0, 30)}" grew into a ${CELESTIAL_LABEL[node.celestial]} ${CELESTIAL_ICON[node.celestial]}`, "✨", 5000);
    }
    seenTierRef.current.set(node.id, tierIdx);
  }, [node?.id, node?.celestial, node?.label]);

  const runSynthesis = () => {
    if (!node) return;
    setSynthBusy(true);
    setInsight("");
    setSynthError("");
    setInsightSaved(false);
    synthesizeNode(node.id)
      .then((r) => {
        setInsight(r.text);
        // The server may have mutated the node itself here — either it stored
        // fresh clarifying `questions` (researchQuestions) when there wasn't
        // enough context, or it directly expanded the node's content/importance
        // when there was. Neither used to reach the UI: `r.connected` and
        // `r.questions` were read straight off a response the client type
        // didn't even declare, and the node was never told to refresh.
        onChanged?.(node.id);
      })
      // IM-32: failures go to the error surface beside the button, NOT into
      // the insight body (previously the raw server error rendered as if it
      // were the insight itself, in Soumaya's voice).
      .catch((e) => setSynthError((e as Error).message || "Synthesis failed — try again."))
      .finally(() => setSynthBusy(false));
  };

  // IM-26: inline edit, mirroring MindPanel's startEdit/saveEdit shape.
  const startEdit = () => {
    if (!node) return;
    setEditLabel(node.label);
    setEditContent(node.content ?? "");
    setEditError("");
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!node || editBusy || !editLabel.trim()) return;
    setEditBusy(true);
    setEditError("");
    try {
      await updateNodeDetails(node.id, { label: editLabel.trim(), content: editContent });
      setEditing(false);
      playSfx("tap");
      pushToast("Saved ✎", "✏️", 3000);
      onChanged?.(node.id);
    } catch (e) {
      // Honour the save result: stay in the editor with the error visible —
      // never close as if it saved.
      setEditError((e as Error).message || "Couldn't save that edit — try again.");
    } finally {
      setEditBusy(false);
    }
  };

  async function saveInsightAsMemory() {
    if (!node || !insight || savingInsight || insightSaved) return;
    setSavingInsight(true);
    try {
      await ingestText(`Insight on "${node.label}": ${insight}`);
      setInsightSaved(true);
      playSfx("chime");
      pushToast("Insight saved as a memory ✦", "🛰️", 4000);
    } catch (err) {
      pushToast((err as Error).message || "Couldn't save that.", "⚠️", 4000);
    } finally {
      setSavingInsight(false);
    }
  }

  // Keep the slider in sync when a different node is selected — but not while a
  // weight save is still in flight, or an unrelated refresh (another tab, an
  // autonomous job) landing mid-drag would silently snap the slider back to the
  // pre-drag value out from under the user.
  useEffect(() => {
    if (saveTimer.current) return;
    setWeight(node?.importance ?? 0.4);
  }, [node?.id, node?.importance]);

  // Debounced persist so dragging the slider doesn't spam the API.
  const commitWeight = (value: number | null) => {
    if (!node) return;
    const reverted = node.importance ?? 0.4;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      setImportance(node.id, value)
        .then(() => onChanged?.(node.id))
        .catch(() => {
          // setImportance() throws on failure — without this the slider silently
          // kept showing the value the user dragged to, even though it was never
          // saved (the sync effect above only fires when node.importance actually
          // changes, which it won't have here).
          setWeight(reverted);
          pushToast("Couldn't save that weight — try again.", "⚠️", 3500);
        });
    }, 350);
  };

  // The debounce timer outlives a single render — without this, navigating away
  // mid-drag left a pending setImportance() call that could fire (and call
  // onChanged on an unmounted inspector) well after the user moved on.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // Direct connections WITH their edge semantics (IM-28): every neighbour
  // carries the link's relationship + weight, so a `contradicts` connection
  // never looks like a `builds_on` one. Seed from the in-memory graph (which
  // already carries GraphEdge fields), then merge the GET /nodes/:id/neighbors
  // answer when it lands (endpoint links win per neighbour id).
  const neighborEntries = useMemo(() => {
    if (!node) return [];
    const byId = new Map<number, { node: GraphNode; relationship: string; weight: number; outgoing: boolean }>();
    const consider = (links: GraphEdge[]) => {
      for (const l of links) {
        const s = end(l.source as never);
        const t = end(l.target as never);
        let other: number | null = null;
        let outgoing = false;
        if (s === node.id) {
          other = t;
          outgoing = true;
        } else if (t === node.id) {
          other = s;
        }
        if (other === null || other === node.id) continue;
        const found = graph.nodes.find((n) => n.id === other);
        if (found) {
          byId.set(other, { node: found, relationship: l.relationship, weight: l.weight ?? 0, outgoing });
        }
      }
    };
    consider(graph.links);
    // The endpoint's links win per neighbour (it is the dedicated source for
    // this node's neighbourhood), and can add neighbours the in-memory
    // graph's link list didn't carry.
    if (endpointLinks) consider(endpointLinks);
    // Strongest connections first — order used to be raw graph-array order.
    return [...byId.values()].sort((a, b) => b.weight - a.weight);
  }, [node, graph, endpointLinks]);

  const neighbors = neighborEntries.map((e) => e.node);

  // IM-29: `summarizes` edges OUT of this node are its drill-in set — a hub's
  // members, or a belief's evidence. The count header prefers the server's
  // memberCount when present; the list is the members themselves.
  const summarized = useMemo(
    () => neighborEntries.filter((e) => e.outgoing && e.relationship === "summarizes"),
    [neighborEntries],
  );

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
      ) : node.kind && node.kind in COGNITIVE_META ? (
        // Cognitive layer (Mind tab) kinds carry their own identity in COGNITIVE_META — the
        // SAME single source of truth the galaxy renderer, Legend, and Mind panel already use —
        // reused here rather than falling through to the generic "Concept" type chip every
        // cognitive kind previously shared (Phase L finding: NodeInspector flattened all ten
        // kinds to one indistinguishable label despite this metadata already existing).
        <span className="chip" style={{ background: COGNITIVE_META[node.kind as CognitiveKind].color }} title={COGNITIVE_META[node.kind as CognitiveKind].blurb}>
          {COGNITIVE_META[node.kind as CognitiveKind].icon} {COGNITIVE_META[node.kind as CognitiveKind].label}
        </span>
      ) : (
        <span className="chip" style={{ background: colorForType(node.type) }}>
          {NODE_TYPE_LABEL[normalizeNodeType(node.type)]}
        </span>
      )}
      {node.kind && node.kind in COGNITIVE_META && COGNITIVE_META[node.kind as CognitiveKind].hasProgress && (
        <div className="mind-progress" title="Progress on this Mind item — edit it from the Mind tab">
          {node.kind === "skill" && <span className="mind-tier">{skillTier(node.progress ?? 0)}</span>}
          <span className="mind-bar">
            <span style={{ width: `${Math.round((node.progress ?? 0) * 100)}%`, background: COGNITIVE_META[node.kind as CognitiveKind].color }} />
          </span>
          <span className="mind-pct">{Math.round((node.progress ?? 0) * 100)}%</span>
        </div>
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
      {editing ? (
        <div className="node-edit">
          <label className="node-edit-label">
            Title
            <input
              className="node-edit-input"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="Give it a title"
            />
          </label>
          <label className="node-edit-label">
            Body
            <textarea
              className="node-edit-body"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={8}
              placeholder="What should this say?"
            />
          </label>
          {editError && (
            <p className="node-edit-error" role="alert">
              {editError}
            </p>
          )}
          <div className="node-edit-actions">
            <button className="mini" onClick={() => void saveEdit()} disabled={editBusy || !editLabel.trim()}>
              {editBusy ? "Saving…" : "Save"}
            </button>
            <button className="mini ghost" onClick={() => setEditing(false)} disabled={editBusy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
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
          <button className="mini node-edit-btn" onClick={startEdit} title="Edit this memory's title and body">
            ✎ Edit
          </button>
        </>
      )}

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
                    // Success used to be silent (only onChanged, no toast/sound) and
                    // left every answered field filled in on screen even though the
                    // questions themselves were already resolved server-side.
                    setAnswers({});
                    playSfx("achievement");
                    pushToast("Thanks — she's weaving that in.", "🛰️", 4000);
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

      {/* IM-29: answered research questions used to vanish the moment
          researchQuestions cleared server-side — the answers the user gave
          (researchAnswers) are re-shown here so the exchange stays readable. */}
      {node.researchAnswers && Object.keys(node.researchAnswers).length > 0 && (
        <div className="dock-section research-answers">
          <h3>🛸 Your earlier answers</h3>
          {Object.entries(node.researchAnswers).map(([q, a]) => (
            <div key={q} className="research-answer">
              <p className="research-answer-q">{q}</p>
              <p className="research-answer-a">{a}</p>
            </div>
          ))}
        </div>
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
          {node.remindAt && (
            // A Life Vision's remindAt is a target date, not a reminder
            // (docs/specs/life-vision.md) — it never fires anything, but the passive
            // "⏰ Reminder" label would still misleadingly imply it does.
            // Batch L (MIN-01): the target date is DATE-ONLY, so it renders
            // through the date-key helper, never fmtWhen's instant math — a
            // date-only value through fmtWhen would print a bogus midnight
            // time and the one-day-early date. Other kinds keep fmtWhen.
            <p className="node-when">
              {node.kind === "life_vision"
                ? (() => {
                    const key = visionTargetDateKey(node.remindAt);
                    return `🌅 Target date ${key ? formatCalendarDate(key) : "date unavailable"}`;
                  })()
                : `⏰ Reminder ${fmtWhen(node.remindAt)}`}
            </p>
          )}
        </div>
      )}

      {/* IM-27: the object's own dates/state — previously only NodeList showed
          any of this; Details showed none of createdAt/lastTendedAt/entropy/
          reviewStrength for the very object it inspects. Local time via fmtWhen. */}
      <div className="node-facts">
        <p className="node-when">📥 Logged {fmtWhen(node.createdAt)}</p>
        {node.lastTendedAt && <p className="node-when">🌱 Last tended {fmtWhen(node.lastTendedAt)}</p>}
        {typeof node.entropy === "number" && (
          <p className="node-when">
            {node.entropy >= 0.66 ? "❄️ Cooling" : node.entropy >= 0.33 ? "🌗 Fading" : "🔥 Warm"} · entropy {Math.round(node.entropy * 100)}%
          </p>
        )}
        {typeof node.reviewStrength === "number" && (
          <p className="node-when">🧠 Review strength {Math.round(node.reviewStrength * 100)}%</p>
        )}
        {node.kind === "moc" && typeof node.memberCount === "number" && (
          <p className="node-when">🌌 {node.memberCount} member{node.memberCount === 1 ? "" : "s"} in this constellation</p>
        )}
      </div>

      {/* IM-29: hub members / belief evidence drill-in — the `summarizes`
          edges out of this node, listed and fly-to-able instead of a bare
          count (or, for beliefs, nothing at all). */}
      {(node.kind === "moc" || node.kind === "belief") && summarized.length > 0 && (
        <div className="node-members">
          <h3>
            {node.kind === "moc"
              ? `🌌 Members (${node.memberCount ?? summarized.length})`
              : `🖤 Evidence she drew on (${summarized.length})`}
          </h3>
          <ul className="neighbors">
            {summarized.map((e) => (
              <li key={e.node.id}>
                <button onClick={() => onFocus(e.node.id)}>
                  <span className="dot" style={{ background: colorForType(e.node.type) }} title={NODE_TYPE_LABEL[normalizeNodeType(e.node.type)]} />
                  {e.node.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <JourneyChips kind="node" refId={node.id} />

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
                // IM-140a: completed task becomes a satellite (before the delete).
                window.dispatchEvent(new CustomEvent("brain-task-completed", { detail: { id: node.id } }));
                deleteNode(node.id)
                  .then(() => onDeleted())
                  .catch(() => pushToast("Couldn't clear that — try again.", "⚠️", 3500));
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

      {/* IM-37: the Investigator's face — a cited deep-dive over this memory. */}
      {node.kind !== "action" && (
        <details className="dock-section" open={!isMobile}>
          <summary>🔍 Deep-dive</summary>
          <div style={{ padding: "10px" }}>
            <DeepDive nodeId={node.id} nodeLabel={node.label} onFocus={onFocus} />
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

      {onDeleted && (node.kind == null || node.kind === "memory" || node.kind === "life_vision") && (
        <button
          className="archive-btn"
          title={
            node.kind === "life_vision"
              ? "Archive this Life Vision — it leaves the galaxy and stops surfacing in chat, but is kept and can be restored anytime from Browse → Archived. Its linked Financial Goals are never affected."
              : "Rest this memory — it leaves the galaxy and stops surfacing in chat, but is kept and can be restored anytime from Browse → Archived."
          }
          onClick={() => {
            void archiveNode(node.id, true).then((ok) => {
              if (ok) onDeleted();
              else pushToast("Couldn't archive that — try again.", "⚠️", 3500);
            });
          }}
        >
          {node.kind === "life_vision" ? "📥 Archive Life Vision" : "📥 Archive (rest it)"}
        </button>
      )}

      {onDeleted && (
        <button className="delete-btn" onClick={() => setConfirmingDelete(true)}>
          🗑 Delete memory
        </button>
      )}
      {confirmingDelete && onDeleted && (
        <ConfirmDialog
          title="Delete this memory?"
          message={`"${node.label}" will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            playSfx("delete");
            deleteNode(node.id)
              .then(() => onDeleted())
              .catch(() => pushToast("Couldn't delete that — try again.", "⚠️", 3500));
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      <button className="synth-btn" onClick={runSynthesis} disabled={synthBusy}>
        {synthBusy ? "Connecting…" : "✨ Connect the dots"}
      </button>
      {synthError && (
        <div className="synth-error" role="alert">
          <p>Couldn’t connect the dots just now. {synthError}</p>
          <button className="mini" onClick={runSynthesis} disabled={synthBusy}>
            Retry
          </button>
        </div>
      )}
      {insight && (
        <>
          <p className="insight-text">{insight}</p>
          <button className="mini" disabled={savingInsight || insightSaved} onClick={() => void saveInsightAsMemory()}>
            {insightSaved ? "✓ Saved" : savingInsight ? "Saving…" : "★ Save as memory"}
          </button>
        </>
      )}

      {node.kind !== "action" && (
        <button
          className="synth-btn"
          disabled={requested}
          onClick={async () => {
            const ok = await requestMaintenance(node.id);
            if (ok) {
              setRequested(true);
              playSfx("chime");
              pushToast(`Soumaya will tend "${node.label.slice(0, 30)}" on her next round.`, "🛰️", 6000);
            } else {
              pushToast("Couldn't queue that — try again.", "⚠️", 3500);
            }
          }}
          title="She'll prioritize this memory on her next round. With Research Mode on (and fuel in the tank) she deep-dives it — that spends 2 ⛽; otherwise it's a free recalibration."
        >
          {requested ? "🛰️ Queued for Soumaya" : `🛰️ Ask Soumaya to tend this · up to ${FUEL_JOB_COST} ⛽`}
        </button>
      )}

      {onIsolate && (
        <button className="synth-btn" onClick={() => onIsolate(node.id)}>
          🔭 Isolate this system
        </button>
      )}

      <h3>Connected ({neighbors.length})</h3>
      <ul className="neighbors">
        {/* A richly-connected hub can carry dozens/hundreds of direct links —
            the first screen caps at NEIGHBORS_SHOWN_CAP, but the overflow is
            EXPANDABLE (IM-30): everything past the cap stays reachable here,
            not stranded behind a plain "+N more" line. Each row shows its
            edge's relationship + weight (IM-28). */}
        {(showAllNeighbors ? neighborEntries : neighborEntries.slice(0, NEIGHBORS_SHOWN_CAP)).map((e) => (
          <li key={e.node.id}>
            <button onClick={() => onFocus(e.node.id)}>
              <span className="dot" style={{ background: colorForType(e.node.type) }} title={NODE_TYPE_LABEL[normalizeNodeType(e.node.type)]} />
              <span className="neighbor-label">{e.node.label}</span>
              <span className="neighbor-rel" title={`Link strength ${Math.round(e.weight * 100)}%`}>
                {e.relationship.replace(/_/g, " ")} · {Math.round(e.weight * 100)}%
              </span>
            </button>
          </li>
        ))}
        {neighbors.length === 0 && <li className="empty">No connections yet.</li>}
        {neighbors.length > NEIGHBORS_SHOWN_CAP && (
          <li>
            <button className="chronicle-toggle neighbors-more" onClick={() => setShowAllNeighbors((v) => !v)}>
              {showAllNeighbors
                ? "Show fewer connections"
                : `+${neighbors.length - NEIGHBORS_SHOWN_CAP} more — show all ${neighbors.length}`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
