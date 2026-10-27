import { useEffect, useRef, useState, type DragEvent } from "react";
import { SUGGESTED_TAGS } from "@brain/shared";
import { ingestText, getSpaceId } from "../api/client.js";
import { extractFileText } from "../lib/extractFileText.js";
import { JourneyChips } from "./JourneyChips.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { pushToast } from "./Toasts.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SpeechRec =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined;

/** datetime-local value (local wall-clock, no tz) → ISO 8601 UTC, or undefined. */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * IM-117: a brain-dump draft survives closing the panel. It lives in
 * localStorage (like ChatDock's history), restores on reopen, clears only on
 * a successful save or an explicit confirmed discard.
 *
 * CAP-05: the draft is scoped PER BRAIN — `brain.ingestDraft.${id}` — like
 * every sibling store (queue `brain.ingestQueue.${id}`, chat
 * `brain.chat.${id}`, quests `brain.quests.${id}`). The old single global
 * key let one brain's unsaved words render in another brain's capture box,
 * one tap from being filed into the wrong brain.
 *
 * Legacy handling — ADOPT-ONCE: the first panel opened after the upgrade
 * moves a legacy global draft into that brain's scoped key and removes the
 * legacy key. Discarding it instead would silently destroy the user's
 * unsaved words (the exact loss IM-117 exists to prevent); adoption's
 * cross-brain risk is one-time and self-limiting — the legacy key is gone
 * after the first adoption, and from then on scoping is strict. No draft
 * expiry is introduced: draft lifetime is a pending owner decision.
 */
const LEGACY_DRAFT_KEY = "brain.ingestDraft";
const draftKey = (): string => `brain.ingestDraft.${getSpaceId() ?? "default"}`;
interface IngestDraft {
  text: string; details: string; tags: string[]; action: boolean; ttl: number;
  occurred: string; remind: string;
}
function loadDraft(): Partial<IngestDraft> {
  try {
    const key = draftKey();
    let raw = localStorage.getItem(key);
    if (raw == null) {
      const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
      if (legacy != null) {
        // Adopt-once: move the pre-scoping draft into this brain's key.
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_DRAFT_KEY);
        raw = legacy;
      }
    }
    const parsed = JSON.parse(raw || "null") as IngestDraft | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
const draftIsEmpty = (d: Partial<IngestDraft>) => !(d.text?.trim() || d.details?.trim());

/** Chat's patient mic window (ChatDock MIC_SILENCE_MS) — IM-117 mic parity. */
const MIC_SILENCE_MS = 2800;

export function IngestPanel({
  onIngested,
  onClose,
  initialText,
}: {
  onIngested: (newIds?: number[], fuelEarned?: number, linkCount?: number) => void;
  onClose?: () => void;
  /** IM-141: prefill from a PWA share-target landing (App parses the shared
   *  title/text/url and seeds the box, so a share becomes one tap on
   *  "Add to brain"). Seeds the initial state only — never overwrites typing. */
  initialText?: string;
}) {
  const initial = useRef(loadDraft()).current;
  // IM-141 + IM-117 compose: a fresh share-target seed wins over a saved
  // draft (it is the newer intent); otherwise the draft restores.
  const [text, setText] = useState(initialText ?? initial.text ?? "");
  const [details, setDetails] = useState(initial.details ?? "");
  const [showDetails, setShowDetails] = useState(!!initial.details);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // IM-117: errors get their OWN surface — raw error text used to land in the
  // same small span as the success message.
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [action, setAction] = useState(initial.action ?? false);
  const [ttl, setTtl] = useState(initial.ttl ?? 24); // hours
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [customTag, setCustomTag] = useState("");
  const [showWhen, setShowWhen] = useState(!!(initial.occurred || initial.remind));
  const [occurred, setOccurred] = useState(initial.occurred ?? "");
  const [remind, setRemind] = useState(initial.remind ?? "");
  const recRef = useRef<any>(null);
  const wantMicRef = useRef(false);
  const micTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micRestartCountRef = useRef(0);
  const micBaseRef = useRef("");
  const [savedNodeId, setSavedNodeId] = useState<number | null>(null);
  // IM-117: the created nodes were returned but never listed — now a preview.
  const [createdNodes, setCreatedNodes] = useState<{ id: number; label: string }[]>([]);
  const savedNodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (savedNodeTimerRef.current) clearTimeout(savedNodeTimerRef.current); }, []);

  // Persist the draft as it changes (cleared explicitly on save/discard).
  useEffect(() => {
    try {
      if (!text && !details) localStorage.removeItem(draftKey());
      else localStorage.setItem(draftKey(), JSON.stringify({ text, details, tags, action, ttl, occurred, remind } satisfies IngestDraft));
    } catch { /* ignore */ }
  }, [text, details, tags, action, ttl, occurred, remind]);

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const addCustomTag = () => {
    const t = customTag.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setCustomTag("");
  };

  const dirty = !!(text.trim() || details.trim());
  const requestClose = () => {
    if (!onClose) return;
    // IM-117: closing with a draft asks first (shared ConfirmDialog) instead
    // of silently destroying a long brain-dump.
    if (dirty) { setConfirmDiscard(true); return; }
    onClose();
  };
  const discardAndClose = () => {
    try { localStorage.removeItem(draftKey()); } catch { /* ignore */ }
    setConfirmDiscard(false);
    onClose?.();
  };

  /** Clear the box + draft — shared by the online success path and the
   *  CAP-06 queued path (a queued capture is saved, so its words must not
   *  stay live inviting a manual duplicate re-submit). */
  function clearAfterSave() {
    setText("");
    setDetails("");
    setShowDetails(false);
    setTags([]);
    setOccurred("");
    setRemind("");
    setShowWhen(false);
    try { localStorage.removeItem(draftKey()); } catch { /* ignore */ }
  }

  async function submit() {
    const body = details.trim() ? `${text.trim()}\n\n${details.trim()}` : text.trim();
    if (!body) return;
    // REG-144/AG-05: an action item can never carry a reminder — the firing
    // tool would deliver it while every web reminder surface excludes
    // actions, so it would fire invisibly (unseeable, unsnoozeable,
    // unacknowledgeable). Refuse the combination up front and say so, instead
    // of silently dropping the remindAt the user asked for; the server's
    // action branch drops it too as a backstop. An action's due time is its
    // expiry (ttl), which Agenda already shows and counts down.
    if (action && toIso(remind)) {
      setError("Action items can't carry a separate reminder — their due time is the expiry above. Untick \"📌 Action item\" to set a reminder, or clear the reminder time.");
      return;
    }
    stopMic();
    setBusy(true);
    setMsg("");
    setError(null);
    setCreatedNodes([]);
    if (savedNodeTimerRef.current) clearTimeout(savedNodeTimerRef.current);
    setSavedNodeId(null);
    try {
      const r = await ingestText(body, {
        ...(action ? { kind: "action" as const, ttlHours: ttl } : {}),
        ...(tags.length ? { tags } : {}),
        ...(toIso(occurred) ? { occurredAt: toIso(occurred) } : {}),
        ...(toIso(remind) ? { remindAt: toIso(remind) } : {}),
      });
      const n = r.nodes.length;
      const e = r.extractedEdges.length + r.associativeEdges.length;
      const fuelBit = r.fuelEarned ? ` · +${r.fuelEarned.toFixed(1)} ⛽` : "";
      const weighty = r.nodes.some((x: any) => (x.importance ?? 0) >= 0.6);
      const researchBit = action ? "" : weighty ? " · 🔬 may deep-dive in Research Mode" : " · 🗃️ stored, no research needed";
      // REG-143/AG-04: the pipeline stamps the reminder on the FIRST node
      // only — name that carrier here so the user knows which memory holds it.
      const reminderBit = !action && toIso(remind) && r.nodes[0] ? ` · 🔔 reminder on "${(r.nodes[0].label ?? "").slice(0, 30)}"` : "";
      setMsg(
        action
          ? `Action item added (expires in ${ttl}h)${fuelBit}`
          : `+${n} node${n !== 1 ? "s" : ""}, ${e} connection${e !== 1 ? "s" : ""}${fuelBit}${researchBit}${reminderBit}`,
      );
      setCreatedNodes(r.nodes.map((x: any) => ({ id: x.id, label: x.label })));
      clearAfterSave();
      const firstId = r.nodes[0]?.id ?? null;
      setSavedNodeId(firstId);
      if (firstId != null) {
        savedNodeTimerRef.current = setTimeout(() => setSavedNodeId(null), 8000);
      }
      onIngested(r.nodes.map((x: any) => x.id), r.fuelEarned, e);
    } catch (err) {
      // CAP-06: an OfflineQueuedError means the capture WAS saved (into
      // the offline queue) — present it as queued in the success span,
      // never in the ⚠️ error surface, and clear like a success. Matched
      // by name so the panel needs no new import surface. Genuine
      // failures (including the queue's honest no-brain / queue-full
      // errors, which are plain Errors) keep the error surface + words.
      if ((err as Error)?.name === "OfflineQueuedError") {
        setMsg((err as Error).message);
        clearAfterSave();
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  /** IM-116: file import via the existing extraction pipeline (the same
   *  lib/extractFileText the Companion Knowledge upload uses). The extracted
   *  text lands in the capture box as an editable draft — nothing is saved
   *  until the user hits "Add to brain". */
  async function importFile(file: File) {
    setImporting(true);
    setError(null);
    try {
      const { text: extracted } = await extractFileText(file);
      setText((t) => (t.trim() ? `${t.trim()}\n\n${extracted}` : extracted));
      pushToast(`Imported ${file.name} — review, then Add to brain.`, "📎", 4000);
    } catch (err) {
      setError((err as Error).message || "Couldn't read that file.");
    } finally {
      setImporting(false);
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void importFile(f);
  };

  // Voice → text, at parity with Chat's mic (IM-117): interim results, a
  // 2.8s silence window before it stops, and auto-restart with backoff when
  // the engine self-terminates mid-dictation. Dictation appends to the draft
  // (it does NOT auto-send — this is a capture box, not a conversation).
  function stopMic() {
    wantMicRef.current = false;
    if (micTimerRef.current) clearTimeout(micTimerRef.current);
    if (micRestartTimerRef.current) clearTimeout(micRestartTimerRef.current);
    micRestartCountRef.current = 0;
    try { recRef.current?.stop?.(); } catch { /* already stopped */ }
    setListening(false);
  }
  function toggleMic() {
    if (!SpeechRec) return;
    if (listening) { stopMic(); return; }
    const rec = new SpeechRec();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    micBaseRef.current = text.trim();
    let finalText = "";
    const armSilenceTimer = () => {
      if (micTimerRef.current) clearTimeout(micTimerRef.current);
      micTimerRef.current = setTimeout(() => { if (wantMicRef.current) stopMic(); }, MIC_SILENCE_MS);
    };
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      const said = `${finalText} ${interim}`.trim();
      setText(micBaseRef.current ? `${micBaseRef.current} ${said}` : said);
      micRestartCountRef.current = 0;
      armSilenceTimer();
    };
    rec.onerror = (e: any) => {
      if (e?.error && e.error !== "no-speech" && e.error !== "aborted") stopMic();
    };
    rec.onend = () => {
      if (wantMicRef.current) {
        micRestartCountRef.current += 1;
        if (micRestartCountRef.current > 6) {
          stopMic();
          pushToast("The mic kept dropping — try again.", "⚠️", 4000);
          return;
        }
        const delay = Math.min(150 * micRestartCountRef.current, 1000);
        micRestartTimerRef.current = setTimeout(() => {
          try { rec.start(); } catch { stopMic(); }
        }, delay);
      }
    };
    recRef.current = rec;
    wantMicRef.current = true;
    micRestartCountRef.current = 0;
    setListening(true);
    armSilenceTimer();
    rec.start();
  }

  return (
    <div
      className={`panel ingest ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-testid="ingest-panel"
    >
      <div className="panel-head">
        <h2>Dump a thought</h2>
        {onClose && (
          <button className="panel-close" onClick={requestClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A business idea, a reflection, a random thought…"
        rows={4}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />

      {/* IM-116: import a document (PDF / Word / text) — or drag one in. */}
      <div className="ingest-import">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: "none" }}
          aria-label="Import a file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
        <button type="button" className="ingest-more" disabled={importing} onClick={() => fileInputRef.current?.click()}>
          {importing ? "Reading file…" : "📎 Import a file (PDF / Word / text) — or drag & drop it here"}
        </button>
      </div>

      {showDetails ? (
        <textarea
          className="ingest-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="More context (optional) — the why, the backstory, related people, how it makes you feel…"
          rows={3}
        />
      ) : (
        <button className="ingest-more" onClick={() => setShowDetails(true)}>
          + Add more context (optional)
        </button>
      )}

      <div className="tag-row">
        {SUGGESTED_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={`tag-chip ${tags.includes(t) ? "on" : ""}`}
            onClick={() => toggleTag(t)}
          >
            {t}
          </button>
        ))}
        {tags
          .filter((t) => !SUGGESTED_TAGS.includes(t))
          .map((t) => (
            <button key={t} type="button" className="tag-chip on" onClick={() => toggleTag(t)}>
              {t} ×
            </button>
          ))}
        <input
          className="tag-input"
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustomTag();
            }
          }}
          placeholder="+ tag"
          aria-label="Add a custom tag"
        />
      </div>

      {showWhen ? (
        <div className="when-block">
          <label className="when-field">
            <span>🕰️ When did this happen?</span>
            <input
              type="datetime-local"
              value={occurred}
              onChange={(e) => setOccurred(e.target.value)}
            />
          </label>
          <label className="when-field">
            <span>⏰ Remind me</span>
            <input
              type="datetime-local"
              value={remind}
              onChange={(e) => setRemind(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <button className="ingest-more" onClick={() => setShowWhen(true)}>
          + When / remind me (optional)
        </button>
      )}

      <label className="action-toggle">
        <input type="checkbox" checked={action} onChange={(e) => setAction(e.target.checked)} />
        📌 Action item (a to-do that times out)
        {action && remind && (
          <span className="ingest-warn" style={{ display: "block", fontSize: "12px", opacity: 0.85 }}>
            ⚠️ A reminder time is set above — action items can't carry one (their due time is the expiry). Clear it, or untick this to save a reminder.
          </span>
        )}
        {action && (
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
            <option value={24}>today (24h)</option>
            <option value={72}>3 days</option>
            <option value={168}>1 week</option>
          </select>
        )}
      </label>

      <div className="row">
        <button onClick={submit} disabled={busy}>
          {busy ? "Thinking…" : action ? "Add action item" : "Add to brain"}
        </button>
        {SpeechRec && (
          <button
            className={`mic-btn ${listening ? "on" : ""}`}
            onClick={toggleMic}
            title={listening ? "Stop recording" : "Speak your memory"}
            aria-label="Voice input"
          >
            {listening ? "● Listening…" : "🎤 Speak"}
          </button>
        )}
        <span className="msg">{msg}</span>
      </div>
      {/* IM-117: separated error surface (never the success span). */}
      {error && (
        <div className="ingest-error" role="alert">
          ⚠️ {error}
        </div>
      )}
      {/* IM-117: what was actually created — verify Soumaya heard you right. */}
      {createdNodes.length > 0 && (
        <div className="ingest-created">
          <span className="ingest-created-label">Created:</span>
          <ul className="ingest-created-list">
            {createdNodes.map((n) => (
              <li key={n.id}>{n.label}</li>
            ))}
          </ul>
        </div>
      )}
      {savedNodeId != null && (
        <div className="ingest-journey-prompt">
          <JourneyChips kind="node" refId={savedNodeId} />
        </div>
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard this draft?"
          message="This thought hasn't been added to your brain yet. Discard it, or go back and keep writing?"
          confirmLabel="Discard"
          cancelLabel="Keep writing"
          onConfirm={discardAndClose}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
