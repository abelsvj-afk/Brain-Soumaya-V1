/**
 * Streak ember — an always-visible stake on your daily streak. A calm flame when you've
 * already fed your brain today; a restless, warning pulse when the streak is alive but
 * you haven't logged anything yet TODAY (so keeping it going feels like it matters).
 * Lives on the left edge (outside the header the PWA hides) and never blocks a click.
 *
 * IM-10: surfaces Streak.best, shows the TRUE shield count as a number (the old
 * icon repeat was capped at 2, so 3+ shields looked like 2), and — when the
 * caller passes onClick — taps through to streak detail (the Progress tab),
 * like the neighbouring fuel gauge opens its sheet.
 */
export function StreakEmber({ streak, best, atRisk, shields = 0, onClick }: { streak: number; best?: number; atRisk: boolean; shields?: number; onClick?: () => void }) {
  if (streak <= 0) return null;
  const shieldNote = shields > 0 ? ` · ${shields} nebula shield${shields === 1 ? "" : "s"} banked (each forgives one missed day)` : "";
  const bestNote = best != null && best > streak ? ` · best ${best}` : "";
  const inner = (
    <>
      <span className="se-flame">🔥</span>
      <span className="se-count">{streak}</span>
      {best != null && best > streak && <span className="se-best">best {best}</span>}
      {shields > 0 && <span className="se-shields" aria-label={`${shields} streak shields`}>🛡️×{shields}</span>}
      {atRisk && <span className="se-warn">at risk today</span>}
    </>
  );
  const title =
    (atRisk
      ? `${streak}-day streak — log one memory today to keep it alive!`
      : `${streak}-day streak — safe for today. Come back tomorrow.`) + shieldNote + bestNote +
    (onClick ? " Tap for streak details." : "");
  if (onClick) {
    return (
      <button type="button" className={`streak-ember tappable${atRisk ? " at-risk" : ""}`} onClick={onClick} title={title} aria-label={`${streak}-day streak${bestNote}${shieldNote}. View streak details.`}>
        {inner}
      </button>
    );
  }
  return (
    <div className={`streak-ember${atRisk ? " at-risk" : ""}`} role="status" title={title}>
      {inner}
    </div>
  );
}
