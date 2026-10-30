import {
  dayBeats,
  dayDoneCount,
  guideSteps,
  guideVisible,
  type DayCounts,
  type GuideProgress,
  type Objective,
} from "../graph/gardenGuide.js";

/**
 * The Growing Place's always-on guidance (docs/specs/owner-feedback-2026-10-30-travel-exits-garden.md §4):
 * one line that says the next useful thing, what she holds (with a Drop),
 * what is happening right now (walking, working, the last result), the
 * first-visit steps and the garden day's three beats. It only draws what
 * gardenGuide.ts decides.
 */
export interface GardenObjectiveProps {
  objective: Objective;
  carrying: boolean;
  onDrop: () => void;
  /** Where she is walking, or null when standing still. */
  walkingTo: string | null;
  onStop: () => void;
  /** The last thing that happened ("Placed … ✓"), shown briefly. */
  result: string | null;
  guide: GuideProgress;
  onDismissGuide: () => void;
  day: DayCounts;
}

export function GardenObjective(p: GardenObjectiveProps) {
  const steps = guideSteps(p.guide);
  const showGuide = guideVisible(p.guide);
  const beats = dayBeats(p.day);
  const done = dayDoneCount(p.day);
  return (
    <div className="garden-objective" role="region" aria-label="What to do in the garden">
      <p className="garden-objective-line" role="status" aria-live="polite">
        <span aria-hidden="true">{p.carrying ? "🧺" : p.objective.kind === "pods" ? "✨" : p.objective.kind === "rest" ? "🌿" : "🌱"}</span>{" "}
        {p.walkingTo ? `Walking to ${p.walkingTo} …` : p.objective.text}
        {p.walkingTo && (
          <button type="button" className="mini garden-objective-btn" onClick={p.onStop}>
            Stop
          </button>
        )}
        {!p.walkingTo && p.carrying && (
          <button type="button" className="mini garden-objective-btn" onClick={p.onDrop}>
            Drop
          </button>
        )}
      </p>
      {p.result && (
        <p className="garden-objective-result" role="status">
          ✓ {p.result}
        </p>
      )}
      {showGuide && (
        <ol className="garden-guide" aria-label="First visit">
          {steps.map((s) => (
            <li key={s.id} className={s.done ? "done" : undefined}>
              {s.done ? "✓" : "○"} {s.label}
            </li>
          ))}
          <li className="garden-guide-hide">
            <button type="button" className="mini garden-objective-btn" onClick={p.onDismissGuide} aria-label="Hide guide">
              ✕
            </button>
          </li>
        </ol>
      )}
      <p className="garden-day" aria-label={`Garden day: ${done} of 3 done — ${beats.map((b) => `${b.label} ${b.have} of ${b.goal}`).join(", ")}`}>
        <span className="garden-day-ring" aria-hidden="true">
          {beats.map((b) => (
            <i key={b.id} className={b.done ? "on" : undefined} />
          ))}
        </span>
        <span>
          Today {done}/3 · {beats.map((b) => `${b.done ? "✓ " : ""}${b.label}${b.done ? "" : ` ${b.have}/${b.goal}`}`).join(" · ")}
        </span>
      </p>
    </div>
  );
}
