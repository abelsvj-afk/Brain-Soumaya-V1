import { useEffect, useMemo, useState } from "react";
import { EARN_MIND, EARN_MIND_DAILY_CAP } from "@brain/shared";
import type { GraphData, GraphNode } from "@brain/shared";
import { search, type SearchHit } from "../api/client.js";
import { tendGardenPlot, type TendMode, type TendResult } from "../api/garden.js";

/**
 * Verb 1 — Tend a plot: the sheet that opens when the owner taps a plot
 * in the Growing Place. Four modes, each a real brain action:
 * - line: add a line to the memory (a new node, linked to the old one).
 * - link: link it to another memory (a new edge).
 * - affirm: still true, or changed since (a recorded judgment).
 * - visit: simply sit with it — warming only, no edit, no fuel.
 *
 * Fuel is stated honestly before the tend and after it: tending with an
 * edit or a link earns +6 fuel as Mind work, up to 10 paid tends a day;
 * a visit earns nothing; past the cap — or when the link already
 * existed — the tend still counts and the plot is still warm, it pays 0.
 * Nothing here can fail the owner: a failed save keeps the sheet open
 * with the words intact.
 */

const MODES: { id: TendMode; label: string; hint: string }[] = [
  { id: "line", label: "✍️ Add a line", hint: "Write a line onto this memory — it becomes a new note, linked to the old one." },
  { id: "link", label: "🔗 Link a memory", hint: "Tie this memory to another one — the path between the two plots lights up." },
  { id: "affirm", label: "✓ Still true?", hint: "Say whether this still holds, or has changed since." },
  { id: "visit", label: "🌿 Just visit", hint: "Sit with it a while. No edit, no fuel — just warmth." },
];

export function GardenTendSheet({
  node,
  graph,
  onClose,
  onTended,
}: {
  node: GraphNode;
  graph: GraphData;
  onClose: () => void;
  onTended: (result: TendResult) => void;
}) {
  const [mode, setMode] = useState<TendMode>("line");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [target, setTarget] = useState<SearchHit | null>(null);
  const [changed, setChanged] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<TendResult | null>(null);

  // Memories already linked to this plot — the picker never offers them
  // (linking what's already linked would pay nothing; say so by hiding it).
  const linkedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const e of graph.links) {
      if (e.source === node.id) ids.add(e.target);
      if (e.target === node.id) ids.add(e.source);
    }
    return ids;
  }, [graph, node.id]);

  useEffect(() => {
    if (mode !== "link" || query.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      search(query.trim())
        .then((results) => {
          if (cancelled) return;
          setHits(
            results.filter(
              (h) => h.id !== node.id && !linkedIds.has(h.id) && h.status !== "archived",
            ).slice(0, 8),
          );
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, query, node.id, linkedIds]);

  const canSave =
    !saving &&
    (mode === "line"
      ? text.trim().length > 0
      : mode === "link"
        ? target !== null
        : mode === "affirm"
          ? changed !== null
          : true);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const result = await tendGardenPlot({
        nodeId: node.id,
        mode,
        text: mode === "line" ? text.trim() : undefined,
        targetId: mode === "link" && target ? target.id : undefined,
        changed: mode === "affirm" ? (changed ?? undefined) : undefined,
      });
      setDone(result);
      onTended(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The tend didn't save. Your words are still here — try again.");
    } finally {
      setSaving(false);
    }
  }

  const fuelLine =
    mode === "visit"
      ? "A visit earns no fuel — just warmth."
      : `Tending with an edit or a link earns +${EARN_MIND} fuel as Mind work (up to ${EARN_MIND_DAILY_CAP} paid tends a day).`;

  return (
    <div
      role="dialog"
      aria-label={`Tend ${node.label}`}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(480px, 92vw)",
        maxHeight: "86vh",
        overflowY: "auto",
        background: "rgba(10, 16, 12, 0.97)",
        border: "1px solid rgba(255, 210, 122, 0.45)",
        borderRadius: "14px",
        padding: "18px",
        color: "#e8e4d8",
        zIndex: 30,
        boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
      }}
    >
      {done ? (
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: "17px" }}>🌱 Tended</h3>
          <p style={{ margin: "0 0 6px", lineHeight: 1.5 }}>
            {done.fuelEarned > 0
              ? `+${done.fuelEarned} fuel — Soumaya noted the tend, and the plot is warm.`
              : done.alreadyLinked
                ? "Those two were already linked — the plot is warm again, and no fuel for a link that was already there."
                : done.tend.kind === "visit"
                  ? "Sat with it. The plot is warm."
                  : "The Mind fuel for today is used up — the tend still counted, and the plot is warm."}
          </p>
          <p style={{ margin: "0 0 14px", opacity: 0.75, fontSize: "13px" }}>Fuel now: {done.fuel}</p>
          <button className="mini" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: "17px" }}>🌱 Tend this plot</h3>
              <p style={{ margin: 0, opacity: 0.85, fontSize: "14px", lineHeight: 1.4 }}>{node.label}</p>
            </div>
            <button className="mini" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "14px 0 4px" }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                className="mini"
                onClick={() => {
                  setMode(m.id);
                  setError(null);
                }}
                aria-pressed={mode === m.id}
                style={
                  mode === m.id
                    ? { background: "rgba(255, 210, 122, 0.25)", borderColor: "rgba(255, 210, 122, 0.8)" }
                    : undefined
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          <p style={{ margin: "0 0 12px", opacity: 0.75, fontSize: "13px", lineHeight: 1.4 }}>
            {MODES.find((m) => m.id === mode)!.hint}
          </p>

          {mode === "line" && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="A line to add to this memory…"
              autoFocus
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "8px",
                color: "#e8e4d8",
                padding: "10px",
                fontSize: "14px",
                resize: "vertical",
              }}
            />
          )}

          {mode === "link" && (
            <div>
              {target ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px",
                    background: "rgba(255, 210, 122, 0.12)",
                    border: "1px solid rgba(255, 210, 122, 0.4)",
                    borderRadius: "8px",
                    padding: "10px",
                  }}
                >
                  <span style={{ fontSize: "14px" }}>{target.label}</span>
                  <button className="mini" onClick={() => setTarget(null)}>
                    Change
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search a memory to link to…"
                    autoFocus
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "8px",
                      color: "#e8e4d8",
                      padding: "10px",
                      fontSize: "14px",
                    }}
                  />
                  {hits.length > 0 && (
                    <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      {hits.map((h) => (
                        <button
                          key={h.id}
                          className="mini"
                          onClick={() => setTarget(h)}
                          style={{ textAlign: "left", padding: "8px 10px" }}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {query.trim().length >= 2 && hits.length === 0 && (
                    <p style={{ margin: "8px 0 0", opacity: 0.7, fontSize: "13px" }}>
                      No unlinked memories match — try different words.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "affirm" && (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="mini"
                onClick={() => setChanged(false)}
                aria-pressed={changed === false}
                style={
                  changed === false
                    ? { background: "rgba(255, 210, 122, 0.25)", borderColor: "rgba(255, 210, 122, 0.8)" }
                    : undefined
                }
              >
                Still true
              </button>
              <button
                className="mini"
                onClick={() => setChanged(true)}
                aria-pressed={changed === true}
                style={
                  changed === true
                    ? { background: "rgba(255, 210, 122, 0.25)", borderColor: "rgba(255, 210, 122, 0.8)" }
                    : undefined
                }
              >
                Changed since
              </button>
            </div>
          )}

          {mode === "visit" && (
            <p style={{ margin: "0 0 4px", opacity: 0.85, fontSize: "14px", lineHeight: 1.5 }}>
              No words needed. Tending it marks the plot warm — Soumaya notes the visit, and the glow stays for a
              week.
            </p>
          )}

          <p style={{ margin: "14px 0", opacity: 0.7, fontSize: "13px", lineHeight: 1.4 }}>{fuelLine}</p>
          {error && (
            <p role="alert" style={{ margin: "0 0 12px", color: "#ff9d8a", fontSize: "13px" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button className="mini" onClick={onClose}>
              Not now
            </button>
            <button className="mini" onClick={save} disabled={!canSave}>
              {saving ? "Tending…" : mode === "visit" ? "Sit with it" : "Tend it"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
