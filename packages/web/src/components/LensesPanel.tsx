import { useEffect, useRef, useState, useCallback } from "react";
import type { Lens, LensQuery } from "@brain/shared";
import { getLenses, createLens, deleteLens, updateLens, lensNodes, previewLens } from "../api/lenses.js";
import { NODE_TYPES, NODE_TYPE_LABEL, SUGGESTED_TAGS } from "@brain/shared";
import { pushToast } from "./Toasts.js";

/**
 * Smart Lenses (the "self-updating view" pattern). A lens is a saved query the galaxy
 * renders as a live constellation: open one and the galaxy isolates to just its matches,
 * staying current as you add memories. This panel lists your lenses (with live counts),
 * opens them, and has a small dropdown builder — no query language, offline, space-scoped.
 *
 * `presetLinkedTo` (a focused node) turns the builder into a one-tap "everything linked to
 * this" lens — the way a hand-made view becomes reusable.
 */
export function LensesPanel({
  onClose,
  onOpen,
  presetLinkedTo,
}: {
  onClose: () => void;
  /** Isolate the galaxy to these ids under this lens name. */
  onOpen: (ids: number[], name: string) => void;
  presetLinkedTo?: { id: number; label: string } | null;
}) {
  const [lenses, setLenses] = useState<Lens[]>([]);
  // IM-118: a truthful initial loading state — "No lenses yet" used to flash
  // for every user on every open while getLenses was still in flight.
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [emotion, setEmotion] = useState<"" | "positive" | "heavy" | "neutral">("");
  const [state, setState] = useState<"" | "active" | "archived" | "due" | "orphan">("");
  const [importance, setImportance] = useState<"" | "0.3" | "0.5" | "0.7">("");
  const [within, setWithin] = useState<"" | "7" | "30" | "90">("");
  const [busy, setBusy] = useState(false);
  // IM-118: the builder could not express kinds/tags even though LensQuery
  // supports them and desc() renders them — and there was no edit flow at all.
  const [kinds, setKinds] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  // IM-118: live preview count for the unsaved query (save is no longer blind).
  const [preview, setPreview] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  // Per-lens in-flight guard for delete/pin — busy above only ever gated the
  // builder's own Save button, so rapid double-clicking a row's 🗑/📌 while its
  // own request was still in flight could fire a duplicate.
  const [rowBusy, setRowBusy] = useState<Set<number>>(new Set());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(
    () => getLenses().then((ls) => { if (mounted.current) { setLenses(ls); setLoading(false); } }).catch(() => { if (mounted.current) setLoading(false); }),
    [],
  );
  // Let the on-galaxy pinned-lens chips re-sync when lenses change here.
  const broadcast = () => window.dispatchEvent(new Event("brain-lenses-changed"));
  useEffect(() => {
    refresh();
    // A lens's count is live — re-fetch when a memory is added.
    const on = () => refresh();
    window.addEventListener("brain-memory-added", on);
    return () => window.removeEventListener("brain-memory-added", on);
  }, [refresh]);

  const buildQuery = (): LensQuery => {
    const q: LensQuery = {};
    if (text.trim()) q.text = text.trim();
    if (kinds.length) q.kinds = kinds;
    if (tags.length) q.tags = tags;
    if (emotion) q.emotion = emotion;
    if (state) q.state = state;
    if (importance) q.minImportance = Number(importance);
    if (within) q.withinDays = Number(within);
    if (presetLinkedTo && editingId == null) q.linkedTo = presetLinkedTo.id;
    return q;
  };

  // Debounced live preview while building/editing.
  const queryKey = JSON.stringify(buildQuery());
  useEffect(() => {
    if (!building) return;
    const t = setTimeout(() => {
      void previewLens(JSON.parse(queryKey) as LensQuery).then((n) => {
        if (!mounted.current) return;
        setPreview(n);
        setPreviewFailed(n == null);
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, queryKey]);

  const resetBuilder = () => {
    setBuilding(false);
    setEditingId(null);
    setName(""); setText(""); setEmotion(""); setState(""); setImportance(""); setWithin("");
    setKinds([]); setTags([]); setCustomTag(""); setPreview(null); setPreviewFailed(false);
  };

  const startEdit = (l: Lens) => {
    setEditingId(l.id);
    setName(l.name);
    setText(l.query.text ?? "");
    setKinds(l.query.kinds ?? []);
    setTags(l.query.tags ?? []);
    setEmotion(l.query.emotion ?? "");
    setState(l.query.state && l.query.state !== "active" ? l.query.state : "");
    setImportance(l.query.minImportance ? (String(l.query.minImportance) as typeof importance) : "");
    setWithin(l.query.withinDays ? (String(l.query.withinDays) as typeof within) : "");
    setBuilding(true);
  };

  const save = async () => {
    const finalName = name.trim() || (presetLinkedTo && editingId == null ? `Linked to ${presetLinkedTo.label}` : "My lens");
    setBusy(true);
    // IM-118: editing goes through updateLens with the full name+query patch —
    // previously the only patch ever sent was {pinned}.
    const lens = editingId != null
      ? await updateLens(editingId, { name: finalName, query: buildQuery() })
      : await createLens(finalName, buildQuery(), true);
    setBusy(false);
    if (!lens) {
      pushToast("Couldn't save that lens — try again.", "⚠️", 3500);
      return;
    }
    pushToast(`Lens saved: ${finalName} (${lens.count ?? 0})`, "⧉", 3500);
    try {
      const sid = localStorage.getItem("brain.spaceId") || "default";
      const k = `stat.lenses_made.${sid}`;
      localStorage.setItem(k, String((parseInt(localStorage.getItem(k) || "0", 10) || 0) + 1));
    } catch { /* ignore */ }
    resetBuilder();
    refresh();
    broadcast();
  };

  const open = async (l: Lens) => {
    const ids = await lensNodes(l.id);
    if (ids.length === 0) {
      pushToast(`"${l.name}" has no matches right now.`, "⧉", 3000);
      return;
    }
    onOpen(ids, l.name);
    onClose();
  };

  const remove = async (l: Lens) => {
    if (rowBusy.has(l.id)) return;
    setRowBusy((s) => new Set(s).add(l.id));
    const idx = lenses.findIndex((x) => x.id === l.id);
    setLenses((xs) => xs.filter((x) => x.id !== l.id));
    try {
      // IM-119: deleteLens's result was ignored — on failure the lens silently
      // resurrected on the next refresh with no error shown. Honour it:
      // restore the row at its old position and say so.
      const ok = await deleteLens(l.id);
      if (!ok) {
        setLenses((xs) => (xs.some((x) => x.id === l.id) ? xs : [...xs.slice(0, Math.max(0, idx)), l, ...xs.slice(Math.max(0, idx))]));
        pushToast("Couldn't delete that lens — it's been put back.", "⚠️", 3500);
        return;
      }
      broadcast();
    } finally {
      setRowBusy((s) => { const next = new Set(s); next.delete(l.id); return next; });
    }
  };

  const togglePin = async (l: Lens) => {
    if (rowBusy.has(l.id)) return;
    setRowBusy((s) => new Set(s).add(l.id));
    try {
      await updateLens(l.id, { pinned: !l.pinned });
      refresh();
      broadcast();
    } finally {
      setRowBusy((s) => { const next = new Set(s); next.delete(l.id); return next; });
    }
  };

  const desc = (q: LensQuery): string => {
    const parts: string[] = [];
    if (q.text) parts.push(`"${q.text}"`);
    if (q.kinds?.length) parts.push(q.kinds.join("/"));
    if (q.tags?.length) parts.push(q.tags.map((t) => `#${t}`).join(" "));
    if (q.emotion) parts.push(q.emotion);
    if (q.state && q.state !== "active") parts.push(q.state);
    if (q.minImportance) parts.push(`≥${q.minImportance} imp`);
    if (q.withinDays) parts.push(`≤${q.withinDays}d`);
    if (q.linkedTo) parts.push("linked");
    return parts.join(" · ") || "all active memories";
  };

  const hasUnsavedBuilderInput = building && !!(name.trim() || text.trim() || emotion || state || importance || within || kinds.length || tags.length || editingId != null);
  const closeWithConfirm = () => {
    // A backdrop click used to discard the builder's in-progress fields with
    // no warning at all, identical to every other click-outside dismissal.
    if (hasUnsavedBuilderInput && !confirm("Discard this unsaved lens?")) return;
    onClose();
  };

  return (
    <div className="lenses-overlay" role="dialog" aria-label="Smart Lenses" onClick={closeWithConfirm}>
      <div className="lenses-card" onClick={(e) => e.stopPropagation()}>
        <header className="lenses-head">
          <h2>⧉ Smart Lenses</h2>
          <button className="lenses-close" onClick={closeWithConfirm} aria-label="Close">×</button>
        </header>
        <p className="lenses-hint">
          A lens is a saved view — open one and the galaxy shows only its stars, staying live as your
          brain grows.
        </p>

        <ul className="lenses-list">
          {loading && lenses.length === 0 && <li className="lenses-empty">Loading lenses…</li>}
          {!loading && lenses.length === 0 && <li className="lenses-empty">No lenses yet — build one below.</li>}
          {lenses.map((l) => (
            <li key={l.id} className="lens-row">
              <button className="lens-open" onClick={() => void open(l)} title="Open this view">
                <span className="lens-name">{l.pinned ? "📌 " : ""}{l.name}</span>
                <span className="lens-desc">{desc(l.query)}</span>
              </button>
              <span className="lens-count" aria-label={`${l.count ?? 0} matches`}>{l.count ?? 0}</span>
              <button className="lens-mini" onClick={() => startEdit(l)} title="Edit lens" aria-label="Edit lens">✎</button>
              <button className="lens-mini" disabled={rowBusy.has(l.id)} onClick={() => void togglePin(l)} title={l.pinned ? "Unpin" : "Pin"} aria-label={l.pinned ? "Unpin" : "Pin"}>{l.pinned ? "📌" : "📍"}</button>
              <button className="lens-mini" disabled={rowBusy.has(l.id)} onClick={() => void remove(l)} title="Delete lens" aria-label="Delete lens">🗑</button>
            </li>
          ))}
        </ul>

        {presetLinkedTo && !building && (
          <button className="lenses-newbtn" onClick={() => { setBuilding(true); setName(`Linked to ${presetLinkedTo.label}`); }}>
            ⧉ Save “everything linked to {presetLinkedTo.label}” as a lens
          </button>
        )}
        {!building && (
          <button className="lenses-newbtn" onClick={() => setBuilding(true)}>+ New lens</button>
        )}

        {building && (
          <div className="lens-builder">
            <input className="lens-input" value={name} maxLength={60} placeholder="Lens name (e.g. Heavy projects)" onChange={(e) => setName(e.target.value)} />
            <input className="lens-input" value={text} maxLength={200} placeholder="Keyword (optional)" onChange={(e) => setText(e.target.value)} />
            <div className="lens-fields">
              <label>Mood
                <select value={emotion} onChange={(e) => setEmotion(e.target.value as typeof emotion)}>
                  <option value="">any</option><option value="positive">joyful</option><option value="heavy">heavy</option><option value="neutral">neutral</option>
                </select>
              </label>
              <label>State
                <select value={state} onChange={(e) => setState(e.target.value as typeof state)}>
                  <option value="">active</option><option value="due">due for recall</option><option value="orphan">orphans</option><option value="archived">archived</option>
                </select>
              </label>
              <label>Importance
                <select value={importance} onChange={(e) => setImportance(e.target.value as typeof importance)}>
                  <option value="">any</option><option value="0.3">≥ 0.3</option><option value="0.5">≥ 0.5</option><option value="0.7">≥ 0.7</option>
                </select>
              </label>
              <label>Recency
                <select value={within} onChange={(e) => setWithin(e.target.value as typeof within)}>
                  <option value="">any time</option><option value="7">last 7 days</option><option value="30">last 30 days</option><option value="90">last 90 days</option>
                </select>
              </label>
            </div>
            <div className="lens-chipblock">
              <span className="lens-chipblock-label">Kinds</span>
              <div className="lens-chips">
                {NODE_TYPES.map((k) => (
                  <button key={k} type="button" className={`tag-chip ${kinds.includes(k) ? "on" : ""}`} onClick={() => setKinds((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]))}>{NODE_TYPE_LABEL[k]}</button>
                ))}
              </div>
            </div>
            <div className="lens-chipblock">
              <span className="lens-chipblock-label">Tags</span>
              <div className="lens-chips">
                {SUGGESTED_TAGS.map((t) => (
                  <button key={t} type="button" className={`tag-chip ${tags.includes(t) ? "on" : ""}`} onClick={() => setTags((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]))}>{t}</button>
                ))}
                {tags.filter((t) => !SUGGESTED_TAGS.includes(t)).map((t) => (
                  <button key={t} type="button" className="tag-chip on" onClick={() => setTags((xs) => xs.filter((x) => x !== t))}>{t} ×</button>
                ))}
                <input
                  className="tag-input" value={customTag} placeholder="+ tag" aria-label="Add a lens tag"
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const t = customTag.trim(); if (t && !tags.includes(t)) setTags((xs) => [...xs, t]); setCustomTag(""); } }}
                />
              </div>
            </div>
            {presetLinkedTo && editingId == null && <p className="lens-note">Includes: linked to “{presetLinkedTo.label}”.</p>}
            <p className="lens-preview" role="status">
              {previewFailed ? "Couldn't count matches right now." : preview != null ? `${preview} match${preview === 1 ? "" : "es"} with these settings` : "Counting matches…"}
            </p>
            <div className="lens-builder-actions">
              <button className="lens-save" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : editingId != null ? "Save changes" : "Save lens"}</button>
              <button className="lens-mini ghost" onClick={resetBuilder}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
