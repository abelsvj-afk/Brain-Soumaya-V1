/**
 * CL-1a (Immersion Round 2) — pure presentation helpers for the dock shell &
 * HUD surfaces. Kept separate from the components so every rule is unit-
 * testable without rendering, and so the components stay thin.
 */

/** IM-03 — the ambient self-insight chip text for a foresight: the server's
 *  ACTUAL foresight text, plus when it lands. Never a constant string. */
export function foresightChipText(foresight: { text: string; inDays: number }): string {
  const when = foresight.inDays <= 0 ? "today" : foresight.inDays === 1 ? "in 1 day" : `in ${foresight.inDays} days`;
  return `${foresight.text} · ${when}`;
}

/** IM-05 — local clock time for a toast, e.g. "3:04 PM". */
export function formatToastTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** IM-05 — visible priority wording (never colour alone). */
export function toastPriorityLabel(priority?: "low" | "normal" | "high"): string | null {
  if (priority === "high") return "Urgent";
  if (priority === "low") return "Quiet";
  return null;
}

/** Parse the app's tolerant timestamp shapes (ISO or sqlite "YYYY-MM-DD HH:MM:SS" UTC). */
export function parseTolerantMs(raw?: string | null): number | null {
  if (!raw) return null;
  const iso = raw.includes("Z") || /[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** IM-06 — a local due-time string, e.g. "Oct 21, 3:04 PM". Empty when unparseable. */
export function formatDueLocal(raw?: string | null): string {
  const ms = parseTolerantMs(raw);
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** IM-07 — what an inquiry kind MEANS for the "Yes, connect" action. */
export const INQUIRY_KIND_LABELS: Record<string, string> = {
  anchor: "Connection",
  bridge: "Bridge",
  hub_suggestion: "Constellation suggestion",
  lens_suggestion: "Lens suggestion",
};

export function inquiryKindLabel(kind: string): string {
  return INQUIRY_KIND_LABELS[kind] ?? (kind ? kind.replace(/_/g, " ") : "Noticing");
}

/** IM-07 — human age of an inquiry from its createdAt, e.g. "2d ago" / "3h ago" / "just now". */
export function inquiryAgeText(createdAt?: string | null, nowMs: number = Date.now()): string {
  const ms = parseTolerantMs(createdAt);
  if (ms == null) return "";
  const diff = Math.max(0, nowMs - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

/** IM-14 — the flashback toast's lore line: why THIS memory, in one line. */
export function flashbackLoreLine(node: { label: string; celestialTitle?: string; type?: string }, days: number): string {
  const what = node.celestialTitle || node.type || "memory";
  const age = Number.isFinite(days) && days > 0 ? ` — you wrote this ${Math.round(days)}d ago` : "";
  return `☄️ Flashback: "${node.label.slice(0, 40)}"${age} · a ${what} worth revisiting. Tap to fly back to it.`;
}

/** IM-18 — human auth error copy. Raw HTTP status text never reaches the user. */
export function humanizeAuthError(message: string): string {
  const m = message ?? "";
  if (/401|403|unauthor|invalid.*(passcode|tag|credential)/i.test(m)) return "That gamer tag and passcode didn't match. Check them and try again.";
  if (/409|already (exists|taken)|taken/i.test(m)) return "That gamer tag is already taken — pick another, or sign in if it's yours.";
  if (/400/.test(m)) return "Something in that form needs a fix — check each field and try again.";
  if (/failed to fetch|network|timeout|aborted/i.test(m)) return "Couldn't reach Soumaya just now. Check your connection and try again.";
  if (/\(\d{3}\)|HTTP \d{3}|status \d{3}/i.test(m)) return "Something went wrong opening your galaxy. Please try again.";
  return m || "Something went wrong opening your galaxy. Please try again.";
}
