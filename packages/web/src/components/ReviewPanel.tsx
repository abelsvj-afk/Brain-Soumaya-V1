import { useEffect, useRef, useState } from "react";
import { getDueReviews, gradeReviewDetailed, type DueReview } from "../api/client.js";
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
 * The helper itself now lives in utils/localDay.ts — the one canonical web
 * home every panel shares (owner rule 2026-10-21) — and is re-exported here
 * so existing imports keep working.
 */
import { spaceLocalDay } from "../utils/localDay.js";
import { getSpaceTimeZone, useSpaceTimeZone } from "../utils/spaceTimezone.js";
export { spaceLocalDay };
/** The daily recall-cap key. Its day is the SPACE's configured local day
 *  (audit-2 item 2 — utils/spaceTimezone.ts; device zone only as the
 *  pre-load fallback). Exported so the key's zone is testable. */
export function todayKey(now: Date = new Date(), timeZone: string = getSpaceTimeZone()): string {
  return `review.doneToday.${spaceLocalDay(now, timeZone)}`;
}
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
  // Audit-2 item 2: the recall-cap key follows the SPACE's configured
  // timezone; when that zone loads, the effect below re-runs so the cap
  // is checked against the correct day's key.
  const spaceTimeZone = useSpaceTimeZone();
  const [due, setDue] = useState<DueReview[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [why, setWhy] = useState(false);
  const [cappedForToday, setCappedForToday] = useState(false);
  const [grading, setGrading] = useState(false);
  // IM-114: after a grade, when this memory comes back ("next review in ~N
  // days") — the reschedule used to be invisible, so grading felt consequence-free.
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  useEffect(() => {
    pruneOldDoneTodayKeys();
    const already = doneToday();
    if (already >= DAILY_CAP) { setCappedForToday(true); setDue([]); return; }
    const room = Math.min(SESSION_SIZE, DAILY_CAP - already);
    // Falls back to an empty list on failure (renders the existing "nothing due" state)
    // rather than leaving `due` null forever — an unhandled rejection here previously left
    // the panel stuck on "Finding memories ready to revisit…" indefinitely.
    void getDueReviews().then((d) => setDue(d.slice(0, room))).catch(() => setDue([]));
    // Re-run when the space's configured timezone arrives: the cap key's
    // day (todayKey) is derived from it, not the device zone.
  }, [spaceTimeZone]);

  const current = due && idx < due.length ? due[idx] : null;

  const grade = async (remembered: boolean) => {
    if (!current || grading) return; // rapid double-tap used to grade the same card twice
    setGrading(true);
    try {
      // IM-112: gradeReview never throws for HTTP failures — it returns false.
      // Honour that: a failed grade must NOT advance the session, bump the
      // daily count, or earn the streak nudge. It gets the same toast + retry
      // posture as a thrown error (previously unreachable for HTTP failures).
      const result = await gradeReviewDetailed(current.id, remembered);
      if (!result.ok) {
        pushToast("Couldn't save that — try again.", "⚠️", 3500);
        return;
      }
      if (typeof result.nextIntervalDays === "number") {
        const n = result.nextIntervalDays;
        setLastFeedback(n <= 0 ? "Next review tomorrow." : n === 1 ? "Next review in ~1 day." : `Next review in ~${n} days.`);
      } else if (result.nextReviewAt) {
        const days = Math.max(0, Math.round((Date.parse(result.nextReviewAt) - Date.now()) / 86_400_000));
        setLastFeedback(days <= 1 ? "Next review in ~1 day." : `Next review in ~${days} days.`);
      } else {
        setLastFeedback(null);
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
            {lastFeedback && <p className="rv-feedback" role="status">{lastFeedback}</p>}
            <p className="rv-empty-sub">That's a good session. Come back later for the next few.</p>
            <button className="rv-btn primary" onClick={onClose}>Done</button>
          </div>
        )}

        {current && (
          <div className="rv-body" aria-live="polite">
            <div className="rv-progress">{idx + 1} of {due!.length} this session</div>
            {lastFeedback && idx > 0 && <div className="rv-feedback" role="status">{lastFeedback}</div>}
            <div className="rv-prompt">Do you remember this one?</div>
            {/* IM-114: strength + review count were fetched but never shown —
                they are the context that makes a grade feel consequential. */}
            <div className="rv-meta" data-testid="rv-meta">
              Strength {Math.round(current.strength * 100)}% · reviewed {current.reviewCount}×
            </div>
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
