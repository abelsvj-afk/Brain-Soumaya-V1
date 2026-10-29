/**
 * Portrait fit for the worlds' orbit cameras.
 *
 * Every world's orbit radius / height was tuned on a landscape screen
 * (~16:10). The camera's FOV is vertical, so on a 412×915 phone (aspect
 * 0.45) the same distance shows barely a quarter of the width: the Deep
 * Past's 880-wide helix was cropped to a wall of rock, the Station to its
 * rim. The camera backs off by sqrt(reference / aspect) — enough to bring
 * the subject back in, short of shrinking it to a speck — and never moves
 * closer than the tuned distance on a wide screen.
 */
export const REFERENCE_ASPECT = 1.6;
export const MAX_PORTRAIT_FIT = 2.2;

export function portraitFit(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  return Math.min(MAX_PORTRAIT_FIT, Math.max(1, Math.sqrt(REFERENCE_ASPECT / aspect)));
}
