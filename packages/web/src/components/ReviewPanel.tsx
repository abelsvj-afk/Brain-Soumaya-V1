import { useEffect, useRef, useState } from "react";
import { getDueReviews, gradeReview, type DueReview } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { useDialogA11y } from "../hooks/useDialogA11y.js";

/**
 * Active recall (NEURO_ALIGNMENT #1) — "memory is made by retrieval, not storage".
 * Soumaya surfaces memories that have decayed to their spaced-repetition point and asks you
 * to RECALL them before revealing. You self-grade; SM-2 reschedules server-side.
 *
 * Two UX fixes (user feedback): it now EXPLAINS itself (what it is, why, what happens after
 * you grade) and it's FINITE — a short session with a gentle DAILY CAP, so it never feels like
 * an endless wall of 20-more-instantly. Closure > completeness.
 */

const SESSION_SIZE = 7; // one sitting
const DAILY_CAP = 15; // enough for a day; the rest keep for tomorrow

/**
 * IM-113: the daily cap keys on the LOCAL day, not the UTC day (PR #74 made
 * streaks/daily-logs space-local; Recall's cap was the one surface missed —
 * `toISOString().slice(0,10)` resets at UTC midnight, so an evening user in
 * the Americas was capped/uncapped against the wrong day).
 *
 * Same algorithm as the server's `localDay()` (agent/notify/policy.ts, the
 * helper the streak fix uses): en-CA formatToParts in the target timezone.
 * The web has no space_meta access, so the timezone is the one this device
 * reports — the user's own local zone, which is what the space timezone is
 * set from (server default America/New_York).
 */
export function spaceLocalDay(d: Date = new Date(), timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    // Unknown/invalid zone — fall back to the runtime's own local calendar day.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}
const todayKey = () => `review.doneToday.${spaceLocalDay()}`;
const doneToday = (): number => {
  try { return parseInt(localStorage.getItem(todayKey()) || "0", 10) || 0; } catch { return 0; }
};
const bumpToday = () => {
  try { localStorage.setItem(todayKey(), String(doneToday() + 1)); } catch { /* ignore */ }
};
/** One new `review.doneToday.YYYY-MM-DD` key got written every day, forever,
 *  with nothing ever removing an old one — a slow, permanent localStorage leak.
 *  Only today's key is ever read; anything older is dead weight. */
const pruneOldDoneTodayKeys = () => {
  try {
    const keep = todayKey();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("review.doneToday.") && k !== keep) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
};

export function ReviewPanel({ onClose, onFocus }: { onClose: () => void; onFocus?: (id: number) => void }) {
  const [due, setDue] = useState<DueReview[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [why, setWhy] = useState(false);
  const [cappedForToday, setCappedForToday] = useState(false);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    pruneOldDoneTodayKeys();
    const already = doneToday();
    if (already >= DAILY_CAP) { setCappedForToday(true); setDue([]); return; }
    const room = Math.min(SESSION_SIZE, DAILY_CAP - already);
    // Falls back to an empty list on failure (renders the existing "nothing due" state)
    // rather than leaving `due` null forever — an unhandled rejection here previously left
    // the panel stuck on "Finding memories ready to revisit…" indefinitely.
    void getDueReviews().then((d) => setDue(d.slice(0, room))).catch(() => setDue([]));
  }, []);

  const current = due && idx < due.length ? due[idx] : null;

  const grade = async (remembered: boolean) => {
    if (!current || grading) return; // rapid double-tap used to grade the same card twice
    setGrading(true);
    try {
      // IM-112: gradeReview never throws for HTTP failures — it returns false.
      // Honour that: a failed grade must NOT advance the session, bump the
      // daily count, or earn the streak nudge. It gets the same toast + retry
      // posture as a thrown error (previously unreachable for HTTP failures).
      const saved = await gradeReview(current.id, remembered);
      if (!saved) {
        pushToast("Couldn't save that — try again.", "⚠️", 3500);
        return;
      }
      bumpToday();
      // A recall earns Fuel + keeps the streak alive — nudge the HUD to refresh.
      window.dispatchEvent(new Event("brain-memory-added"));
      setDone((n) => n + 1);
      setRevealed(false);
      setIdx((i) => i + 1);
    } catch {
      // Leave the card exactly as it was (still revealed, same index) so the
      // user can just retry — this used to be an unhandled rejection that
      // silently ate the grade with no feedback at all.
      pushToast("Couldn't save that — try again.", "⚠️", 3500);
    } finally {
      setGrading(false);
    }
  };

  const cardRef = useRef<HTMLDivElement>(null);
  useDialogA11y(cardRef, onClose);

  return (
    <div className="review-overlay" role="dialog" aria-label="Recall session" onClick={onClose}>
      <div className="review-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <button className="rv-x" onClick={onClose} aria-label="Close">×</button>
        <div className="rv-head">
          <span className="rv-glyph">🧠</span>
          <div>
            <div className="rv-title">Recall session</div>
            <div className="rv-sub">
              A quick memory workout — try to remember before you reveal.{" "}
              <button className="rv-why" onClick={() => setWhy((v) => !v)}>{why ? "Hide" : "What's this?"}</button>
            </div>
          </div>
        </div>

        {why && (
          <div className="rv-explain">
            <p><strong>Why:</strong> you remember things by <em>retrieving</em> them, not re-reading them. Recalling an old memory strengthens it — so it sticks.</p>
            <p><strong>After you grade:</strong> "I remembered" brightens that memory's star and pushes its next review further out; "Forgot" brings it back sooner so it doesn't slip away. It's rescheduled for you automatically — you never track it.</p>
            <p><strong>The red dot</strong> is just how many memories are ready to revisit. You don't have to clear them all — a short session is the whole point.</p>
          </div>
        )}

        {due === null && <div className="rv-empty">Finding memories ready to revisit…</div>}

        {cappedForToday && (
          <div className="rv-empty">
            <p>You've done your reviews for today — nice work. 🌟</p>
            <p className="rv-empty-sub">The rest will keep. Come back tomorrow.</p>
            <button className="rv-btn primary" onClick={onClose}>Done</button>
          </div>
        )}

        {!cappedForToday && due && due.length === 0 && (
          <div className="rv-empty">
            <p>Nothing due right now — your memories are fresh. 🌟</p>
            <p className="rv-empty-sub">Soumaya will resurface them as they gently fade.</p>
            <button className="rv-btn primary" onClick={onClose}>Done</button>
          </div>
        )}

        {!cappedForToday && due && due.length > 0 && !current && (
          <div className="rv-empty">
            <p>Session complete — you revisited {done} memor{done === 1 ? "y" : "ies"}. ✨</p>
            <p className="rv-empty-sub">That's a good session. Come back later for the next few.</p>
            <button className="rv-btn primary" onClick={onClose}>Done</button>
          </div>
        )}

        {current && (
          <div className="rv-body" aria-live="polite">
            <div className="rv-progress">{idx + 1} of {due!.length} this session</div>
            <div className="rv-prompt">Do you remember this one?</div>
            <button className="rv-label" onClick={() => current && onFocus?.(current.id)} title="Find it in the galaxy">
              {current.label}
            </button>
            {!revealed ? (
              <button className="rv-btn reveal" onClick={() => setRevealed(true)}>Reveal &amp; rate my recall</button>
            ) : (
              <>
                {/* IM-111: Reveal must actually reveal — the memory's own content,
                    so the grade below is a judgement about a shown memory. */}
                {current.content && <div className="rv-content">{current.content}</div>}
                <div className="rv-grade">
                  <button className="rv-btn forgot" disabled={grading} onClick={() => void grade(false)}>Forgot</button>
                  <button className="rv-btn primary" disabled={grading} onClick={() => void grade(true)}>I remembered</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
