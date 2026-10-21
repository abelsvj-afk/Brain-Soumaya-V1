/**
 * IM-04 — shared human labels for Soumaya's autonomous job types.
 * Server job types are snake_case code tokens (maintenance route enum:
 * synthesis | calibration | patrol | pruning | harmonization | research |
 * merging | sector_vibe | daily_log). Rendering one raw ("Running
 * sector_vibe") leaks plumbing into the galaxy. Every surface that names a
 * job — the ship's floating task label, panels, logs — should go through
 * this one map so the wording can never drift between surfaces.
 */
export const JOB_TYPE_LABELS: Record<string, string> = {
  patrol: "Patrolling the galaxy",
  synthesis: "Connecting threads",
  calibration: "Calibrating memories",
  pruning: "Pruning faded memories",
  harmonization: "Harmonising memories",
  research: "Deep-diving",
  merging: "Fusing duplicates",
  sector_vibe: "Charting the sector",
  daily_log: "Writing the Captain's Log",
  replay: "Replaying what happened while you were away",
};

/** Humanize any job-type token; unknown tokens are de-snaked, never shown raw. */
export function humanizeJobType(type: string): string {
  const known = JOB_TYPE_LABELS[type];
  if (known) return known;
  const words = type.replace(/_/g, " ").trim();
  if (!words) return "Working";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The ship task label for a running job: its own description wins, else the friendly label. */
export function shipTaskLabel(job: { type: string; description?: string | null }): string {
  if (job.description && job.description.trim()) return job.description;
  return humanizeJobType(job.type);
}
