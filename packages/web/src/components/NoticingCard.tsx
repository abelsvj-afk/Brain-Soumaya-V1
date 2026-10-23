import { useEffect, useState, useRef } from "react";
import { getInquiries, answerInquiry, dismissInquiry, rejectInquiry, confirmInquiry, type Inquiry } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { logDiagnosticEvent } from "../diagnostics/buffer";
import { inquiryKindLabel, inquiryAgeText } from "./cl1a.helpers.js";

/**
 * "Soumaya noticed…" — the proactive-intelligence surface. She NEVER pops this open on
 * her own anymore. It's a quiet 💭 button that only appears when she has something, and
 * GLOWS while that something is new/unseen. Opening it clears the glow — even if you
 * don't act — because you've now seen it; a fresh noticing lights it up again. Tap to
 * read her grounded question, fly to the bodies involved, answer, connect, or wave off.
 *
 * Hidden entirely while a panel/Observatory is up (via `hidden`).
 */
export function NoticingCard({
  onFocus,
  onAnswered,
  hidden,
  spaceId,
}: {
  onFocus: (id: number) => void;
  onAnswered?: () => void;
  hidden?: boolean;
  spaceId?: string;
}) {
  const renderCount = useRef(0);
  renderCount.current++;
  useEffect(() => {
    logDiagnosticEvent('event', 'NoticingCard', { action: 'mount', render: renderCount.current });
    return () => logDiagnosticEvent('event', 'NoticingCard', { action: 'unmount' });
  }, []);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  // IM-07: which inquiry in the queue is showing — the card used to pin [0]
  // forever ("(1 of N)" with no way to reach the rest).
  const [index, setIndex] = useState(0);
  const seenKey = `brain.noticing.seen.${spaceId ?? "legacy"}`;
  const [seenId, setSeenId] = useState<number>(() => {
    try { return parseInt(localStorage.getItem(seenKey) || "0", 10) || 0; } catch { return 0; }
  });
  // Re-sync the "seen" baseline when the brain changes (undefined→real id at login),
  // otherwise the button re-glows for noticings already seen in this space.
  useEffect(() => {
    try { setSeenId(parseInt(localStorage.getItem(seenKey) || "0", 10) || 0); } catch { setSeenId(0); }
  }, [seenKey]);

  const refresh = () => getInquiries().then(inquiries => { 
    setInquiries(inquiries); 
    logDiagnosticEvent('state', 'NoticingCard.inquiries', { count: inquiries.length }); 
  }).catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    // A fresh memory can produce a noticing server-side — re-check after ingests.
    const onIngest = () => setTimeout(refresh, 800);
    window.addEventListener("brain-memory-added", onIngest);
    return () => {
      clearInterval(t);
      window.removeEventListener("brain-memory-added", onIngest);
    };
  }, []);

  // Tell the app when this card is open so the object-lore card (same top-center slot)
  // steps aside instead of stacking on top of it.
  useEffect(() => {
    logDiagnosticEvent('event', 'NoticingCard.sync', { open: open });
    window.dispatchEvent(new CustomEvent("brain-noticing-open", { detail: open }));
  }, [open]);

  if (hidden || inquiries.length === 0) return null;
  const safeIndex = Math.min(index, inquiries.length - 1);
  const q = inquiries[safeIndex]!;
  const maxId = inquiries.reduce((m, i) => Math.max(m, i.id), 0);
  const glow = maxId > seenId; // there's a noticing you haven't opened yet

  // Opening marks everything currently here as "seen" so the glow stops — whether or not
  // you end up acting on it. (A later, higher-id noticing re-lights the button.)
  const markSeen = () => {
    if (maxId > seenId) {
      setSeenId(maxId);
      try { localStorage.setItem(seenKey, String(maxId)); } catch { /* ignore */ }
    }
  };
  const toggle = () => {
    if (open) {
      setOpen(false);
      logDiagnosticEvent('state', 'NoticingCard.open', { open: false });
    } else {
      setOpen(true);
      logDiagnosticEvent('state', 'NoticingCard.open', { open: true });
      markSeen();
    }
  };

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const r = await answerInquiry(q.id, reply.trim());
      if (r) {
        playSfx("achievement");
        pushToast("Answered — woven into your galaxy 🧠", "💭", 4000);
        setReply("");
        await refresh();
        onAnswered?.();
      } else {
        pushToast("Couldn't send that — try again.", "⚠️", 3500);
      }
    } finally {
      setBusy(false);
    }
  };
  const afterAct = async () => {
    // If that was the last one, close the popover; the button hides itself (length 0).
    const remaining = inquiries.filter((x) => x.id !== q.id);
    if (remaining.length === 0) setOpen(false);
    else setIndex((i) => Math.min(i, remaining.length - 1));
  };
  const wave = async () => {
    // GH-19: dismiss honestly, like send() — the inquiry leaves only on a
    // verified success. Before, it was removed locally first and a failed
    // dismiss silently resurrected it at the next poll, unexplained.
    const ok = await dismissInquiry(q.id).catch(() => false);
    if (!ok) {
      pushToast("Couldn't wave that off — it's still here.", "⚠️", 3500);
      return;
    }
    setInquiries((xs) => xs.filter((x) => x.id !== q.id));
    void afterAct();
  };
  const reject = async () => {
    setInquiries((xs) => xs.filter((x) => x.id !== q.id));
    await rejectInquiry(q.id);
    pushToast("Got it — I won't tie those together.", "🧠", 3500);
    onAnswered?.(); // the galaxy may lose an edge → refresh
    void afterAct();
  };
  const isHub = q.kind === "hub_suggestion";
  const isLens = q.kind === "lens_suggestion";
  const confirmToast = isHub
    ? "Constellation named ✨ — a new hub anchors that cluster."
    : isLens
      ? "Lens saved ⧉ — pinned to your galaxy."
      : "Connected ✦ — woven into your galaxy.";
  const confirm = async () => {
    // GH-19: celebrate ONLY a verified success (send() is the in-file
    // template). Before, the inquiry was removed locally first and the
    // success sound + toast fired without ever checking the result — a
    // connection that was never made got announced as woven in.
    const r = await confirmInquiry(q.id).catch(() => ({ ok: false, hubId: null }));
    if (!r.ok) {
      pushToast("Couldn't connect those — try again.", "⚠️", 3500);
      return;
    }
    setInquiries((xs) => xs.filter((x) => x.id !== q.id));
    playSfx("achievement");
    pushToast(confirmToast, "🧠", 3500);
    if (isLens) window.dispatchEvent(new Event("brain-lenses-changed")); // refresh the chips
    // A constellation just formed → let the galaxy fly-to-isolate the new hub with a burst
    // (once the refresh lands it in the data). onAnswered triggers that refresh.
    if (isHub && r.hubId != null) {
      window.dispatchEvent(new CustomEvent("brain-constellation-formed", { detail: { id: r.hubId } }));
    }
    onAnswered?.();
    void afterAct();
  };
  // A one-tap "yes" makes sense for the connection-style + hub + lens noticings.
  const canConfirm = q.kind === "anchor" || q.kind === "bridge" || isHub || isLens;

  return (
    <>
      <button
        className={`fab noticing-fab ${glow ? "glow" : ""} ${open ? "on" : ""}`}
        onClick={toggle}
        aria-label={`Soumaya noticed ${inquiries.length}`}
        title={glow ? "Soumaya noticed something new" : "Soumaya's noticings"}
      >
        💭
        <span className="fab-cap">Notices</span>
        <span className="fab-badge noticing-count">{inquiries.length > 9 ? "9+" : inquiries.length}</span>
      </button>

      {open && (
        <div className="noticing-card" role="dialog" aria-label="Soumaya noticed something">
          <div className="noticing-head">
            <span className="noticing-eye">💭</span>
            <span className="noticing-title">Soumaya noticed{inquiries.length > 1 ? ` (${safeIndex + 1} of ${inquiries.length})` : ""}</span>
            <button className="noticing-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="noticing-meta">
            <span className="noticing-kind">{inquiryKindLabel(q.kind)}</span>
            {inquiryAgeText(q.createdAt) && <span className="noticing-age">{inquiryAgeText(q.createdAt)}</span>}
          </div>
          <p className="noticing-q">{q.question}</p>
          {inquiries.length > 1 && (
            <div className="noticing-nav">
              <button className="mini ghost" onClick={() => setIndex((i) => Math.max(0, Math.min(i, inquiries.length - 1) - 1))} disabled={safeIndex === 0} aria-label="Previous noticing">← Prev</button>
              <button className="mini ghost" onClick={() => setIndex((i) => Math.min(inquiries.length - 1, i + 1))} disabled={safeIndex >= inquiries.length - 1} aria-label="Next noticing">Next →</button>
            </div>
          )}
          {q.nodes.length > 0 && (
            <div className="noticing-chips">
              {q.nodes.slice(0, 8).map((n) => (
                <button key={n.id} className="noticing-chip" onClick={() => onFocus(n.id)} title="Fly to it">
                  {n.label}
                </button>
              ))}
              {q.nodes.length > 8 && (
                <span className="noticing-chip noticing-chip-more" aria-label={`${q.nodes.length - 8} more`}>
                  +{q.nodes.length - 8} more
                </span>
              )}
            </div>
          )}
          <textarea
            className="companion-textarea"
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            placeholder="Tell her… (this becomes a memory, linked in)"
          />
          <div className="noticing-actions">
            {canConfirm && (
              <button className="noticing-confirm" onClick={() => void confirm()} title="Connect them">
                ✦ Yes, connect
              </button>
            )}
            <button onClick={() => void send()} disabled={busy || !reply.trim()}>
              {busy ? "Weaving…" : "Answer"}
            </button>
            <button className="mini ghost" onClick={() => void reject()} title="Sever this connection and don't suggest it again">
              Not related
            </button>
            <button className="mini ghost" onClick={() => void wave()}>Not now</button>
          </div>
        </div>
      )}
    </>
  );
}
