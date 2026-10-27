import type { GraphNode } from "@brain/shared";

/**
 * Parse a naive SQLite timestamp ("YYYY-MM-DD HH:MM:SS", no zone) OR a real ISO
 * string, tolerantly, as UTC → epoch ms (or NaN for missing/unparsable input).
 *
 * This exact 2-line predicate was independently reimplemented FOUR times —
 * NodeInspector.tsx's `fmtWhen`, NodeList.tsx's `ms`, ActionsPanel.tsx's `ms`, and
 * SectorView.tsx's `msOf` — the identical "computed twice [and four more times] and
 * drifting" risk docs/OPTIMIZATION_ROADMAP.md Problem 2 warns about, in the same file
 * that already exists specifically to prevent it. One definition now; all four import it.
 */
export function parseTolerantMs(raw?: string): number {
  if (!raw) return NaN;
  const iso = raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z";
  return Date.parse(iso);
}

/**
 * The "is this node's reminder due right now" predicate — previously implemented
 * independently in ActionsPanel.tsx and NotificationsBar.tsx (the exact drift risk
 * above). Naive SQLite timestamps must be read as UTC — same bug class as above.
 */
export function isReminderDue(n: Pick<GraphNode, "kind" | "remindAt">, nowMs: number = Date.now()): boolean {
  // A Life Vision's remindAt is a target date, not a reminder (docs/specs/life-vision.md,
  // C2.1-locked) — it must never enter any reminder-notification/agenda/toast surface.
  // Actions are excluded the same way — and the exclusion is now an enforced
  // invariant, not an assumption: the ingest paths refuse remindAt on actions
  // (REG-144/AG-05; IngestPanel refuses the combination, the server's action
  // branch drops it), so no write path can create the state this predicate
  // would otherwise hide from every reminder surface.
  if (n.kind === "action" || n.kind === "life_vision" || !n.remindAt) return false;
  return parseTolerantMs(n.remindAt) <= nowMs;
}
