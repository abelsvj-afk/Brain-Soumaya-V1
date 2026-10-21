import { parseTolerantMs } from "./dueReminders.js";

/**
 * Shared Browse-tab formatting (IM-43): All / Folders / Hubs used to disagree —
 * All rendered a human local date ("Oct 20 (today)") while Folders rendered the
 * raw stored `YYYY-MM-DD` string. Every Browse surface now formats stored
 * timestamps through here: the viewer's LOCAL calendar date in human shape.
 * Parsed via the shared tolerant parser (naive SQLite strings read as UTC, the
 * same rule NodeInspector/DigestPanel use); unparseable values render "" —
 * never the raw stored string.
 */
export function fmtBrowseDate(raw?: string): string {
  if (!raw) return "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "today" / "yesterday" / "Nd ago" / "Nmo ago" / "Ny ago" — same vocabulary as NodeList. */
export function relativeBrowse(raw?: string): string {
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "";
  const d = Math.round((Date.now() - t) / 8.64e7);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

/** The human date plus its relative label, All-view style: "Oct 20, 2026 (today)". */
export function fmtBrowseDateWithRelative(raw?: string): string {
  const abs = fmtBrowseDate(raw);
  if (!abs) return "";
  const rel = relativeBrowse(raw);
  return rel ? `${abs} (${rel})` : abs;
}

export type BrowseEmotion = "positive" | "neutral" | "negative";

/** Same buckets/labels NodeList's emotion filter uses ("● warm/neutral/heavy"). */
export function emotionBucketOf(ew?: number): BrowseEmotion {
  if (typeof ew !== "number") return "neutral";
  if (ew > 0.2) return "positive";
  if (ew < -0.2) return "negative";
  return "neutral";
}

export const BROWSE_EMOTION_DOT: Record<BrowseEmotion, string> = {
  positive: "#ffcf6b",
  neutral: "#9b96c4",
  negative: "#6bb7ff",
};

export const BROWSE_EMOTION_LABEL: Record<BrowseEmotion, string> = {
  positive: "warm",
  neutral: "neutral",
  negative: "heavy",
};
