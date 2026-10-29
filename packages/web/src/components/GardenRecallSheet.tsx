import { useMemo, useState } from "react";
import { gradeReviewDetailed, type GradeResult } from "../api/features.js";

/**
 * Garden v2, step 4 — Seed Pods (docs/specs/growing-place-v2-2026-10-29.md).
 * A memory due for recall has ripened into a pod; Soumaya's ship caught it.
 * She asks, in her own voice (a template — no LLM, so it costs nothing and
 * works offline), whether you remember it:
 * - "I remember" grades it remembered — the pod blooms.
 * - "Show me" reveals it; then you say honestly whether you had it. Either
 *   way it blooms (a "not quite" just comes back sooner — never a loss).
 * - "Not today" grades nothing; the pod drifts off and returns another day.
 * Each grade is the real spaced-repetition review (POST /api/review/:id),
 * so the game IS the review, not a copy of it. Kindness rule: nothing here
 * can be failed — no streak, no penalty, no wilting.
 */

/** Her ways of asking — chosen by memory id so the same pod always asks the same way. */
export const RECALL_PROMPTS = [
  (label: string) => `Do you remember “${label}”?`,
  (label: string) => `This one ripened for you — what comes back about “${label}”?`,
  (label: string) => `A seed from a while ago: “${label}”. Does it still live in you?`,
] as const;

export function recallPrompt(id: number, label: string): string {
  return RECALL_PROMPTS[Math.abs(id) % RECALL_PROMPTS.length]!(label);
}

function attemptKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pod-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function GardenRecallSheet({
  memory,
  groveTitle,
  onCaught,
  onNotToday,
  onClose,
}: {
  memory: { id: number; label: string; content?: string };
  /** The grove it blooms into, if the memory belongs to a Journey. */
  groveTitle: string | null;
  /** Graded — the pod blooms. Called once, as soon as the grade lands. */
  onCaught: (remembered: boolean) => void;
  /** Not today: no grade; the pod drifts off for this stay. */
  onNotToday: () => void;
  /** Close after the bloom message. */
  onClose: () => void;
}) {
  const key = useMemo(attemptKey, []); // one attempt per catch: a retry replays, never double-grades
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(GradeResult & { remembered: boolean }) | null>(null);

  const grade = async (remembered: boolean) => {
    setBusy(true);
    setError(null);
    const r = await gradeReviewDetailed(memory.id, remembered, key);
    setBusy(false);
    if (!r.ok) {
      setError("That didn't reach the garden — try again.");
      return;
    }
    setResult({ ...r, remembered });
    onCaught(remembered);
  };

  if (result) {
    const where = groveTitle ? ` in ${groveTitle}` : " in the meadow";
    const back =
      result.nextIntervalDays !== undefined
        ? ` It ripens again in about ${result.nextIntervalDays} day${result.nextIntervalDays === 1 ? "" : "s"}.`
        : "";
    return (
      <div className="garden-sheet" role="dialog" aria-label="Seed pod caught">
        <h3>🌼 It blooms{where}</h3>
        <p className="garden-sheet-quiet">
          {result.remembered ? "Held onto — that memory is stronger now." : "Seen again — it'll come back a little sooner."}
          {back}
          {result.fuelEarned ? ` +${result.fuelEarned} fuel.` : ""}
        </p>
        <div className="garden-sheet-row" style={{ marginTop: "0.8rem" }}>
          <button type="button" onClick={onClose} autoFocus>
            Back to the garden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="garden-sheet" role="dialog" aria-label="A seed pod">
      <div className="garden-sheet-head">
        <h3>✨ {recallPrompt(memory.id, memory.label)}</h3>
      </div>
      {revealed && <p className="garden-sheet-answer">{memory.content?.trim() || memory.label}</p>}
      {error && <p className="garden-sheet-error" role="alert">{error}</p>}
      <div className="garden-sheet-row garden-recall-actions">
        {!revealed ? (
          <>
            <button type="button" onClick={() => void grade(true)} disabled={busy}>
              I remember
            </button>
            <button type="button" onClick={() => setRevealed(true)} disabled={busy}>
              Show me
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void grade(true)} disabled={busy}>
              I had it
            </button>
            <button type="button" onClick={() => void grade(false)} disabled={busy}>
              Not quite
            </button>
          </>
        )}
        <button type="button" className="garden-recall-later" onClick={onNotToday} disabled={busy}>
          Not today
        </button>
      </div>
    </div>
  );
}
