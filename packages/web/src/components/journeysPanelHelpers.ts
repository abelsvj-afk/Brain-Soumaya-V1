import type { Journey } from "@brain/shared";

/**
 * Pure helpers for JourneysPanel (CL-10 / IM-85, IM-88, IM-89) — kept separate
 * from the component so the grapheme, date, next-step and list-shaping rules
 * are unit-testable without rendering the panel.
 */

/** Accent colours offered for a Journey (IM-85). The server accepts any string
 *  ≤20 chars for `color`; these presets are the UI's vocabulary, and a stored
 *  colour outside the list still renders (it is used as-is for the accent). */
export const JOURNEY_COLORS: Array<{ value: string; label: string }> = [
  { value: "#5bd6ff", label: "Sky" },
  { value: "#b98bff", label: "Violet" },
  { value: "#5ee6a0", label: "Leaf" },
  { value: "#ffcd46", label: "Sun" },
  { value: "#ff9eb0", label: "Rose" },
  { value: "#ffa94d", label: "Ember" },
];

/**
 * First grapheme cluster of `value` (IM-89). The icon input used to keep one
 * Unicode *code point* (`Array.from(v).slice(0, 1)`), which silently mangles
 * ZWJ sequences (👨‍👩‍👧 → 👨), flag emoji (🇺🇸 → 🇺 — a lone regional indicator)
 * and keycap/skin-tone sequences. `Intl.Segmenter` with grapheme granularity
 * is the correct boundary; the fallback walks code points and keeps combining
 * marks, variation selectors, skin-tone modifiers, ZWJ-joined code points and
 * regional-indicator pairs together.
 */
export function firstGrapheme(value: string): string {
  if (!value) return "";
  const Seg = (Intl as unknown as {
    Segmenter?: new (locales?: string, opts?: { granularity: string }) => {
      segment: (s: string) => Iterable<{ segment: string }>;
    };
  }).Segmenter;
  if (typeof Seg === "function") {
    try {
      const seg = new Seg(undefined, { granularity: "grapheme" });
      for (const part of seg.segment(value)) return part.segment;
      return "";
    } catch { /* fall through to the manual walk */ }
  }
  const cps = Array.from(value);
  let out = "";
  let regionalPairOpen = false;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    out += cp;
    if (i === 0) {
      regionalPairOpen = isRegionalIndicator(cp);
      continue;
    }
    const prev = cps[i - 1]!;
    if (isRegionalIndicator(cp) && regionalPairOpen) { regionalPairOpen = false; break; }
    if (isRegionalIndicator(cp)) { regionalPairOpen = true; continue; }
    regionalPairOpen = false;
    if (prev === "\u200d") continue; // ZWJ: the code point after it joins the cluster
    if (cp === "\u200d") continue; // ZWJ itself joins; keep going for what follows
    if (isMarkOrModifier(cp)) continue;
    break;
  }
  return out;
}

/**
 * The icon input's next value (IM-89): typing/pasting into a field that already
 * holds an icon APPENDS in the DOM, so "first grapheme of the raw value" would
 * keep the old icon forever. When the raw value starts with the current icon
 * and grew, the appended part is the user's new icon — take ITS first grapheme.
 */
export function nextIconValue(current: string, raw: string): string {
  if (!raw) return "";
  if (current && raw.startsWith(current) && raw.length > current.length) {
    return firstGrapheme(raw.slice(current.length)) || firstGrapheme(raw);
  }
  return firstGrapheme(raw);
}

const isRegionalIndicator = (cp: string): boolean => {
  const n = cp.codePointAt(0) ?? 0;
  return n >= 0x1f1e6 && n <= 0x1f1ff;
};
const isMarkOrModifier = (cp: string): boolean =>
  /^\p{M}$/u.test(cp) || cp === "\uFE0F" || cp === "\u20E3" || /^\p{Emoji_Modifier}$/u.test(cp);

/**
 * Format an ISO timestamp (or a date-only `YYYY-MM-DD`) in LOCAL time (IM-88).
 * Returns null for missing/unparseable input so the UI can omit the date
 * rather than print "Invalid Date". Date-only strings are parsed as a local
 * calendar date — `new Date("2026-01-01")` is UTC midnight, which renders as
 * the previous day anywhere west of UTC.
 */
export function formatJourneyDate(iso?: string | null): string | null {
  if (!iso) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export type JourneySort = "recent" | "title" | "progress" | "links";
export type JourneyStatusFilter = "all" | "active" | "paused" | "done";

/** Search (title + description) + status filter + sort for the panel's lists
 *  (IM-88). Pure and non-mutating; "recent" = most recently updated first,
 *  matching the server list's own ordering basis. */
export function filterAndSortJourneys(
  journeys: Journey[],
  query: string,
  filter: JourneyStatusFilter,
  sort: JourneySort,
): Journey[] {
  const needle = query.trim().toLowerCase();
  const out = journeys.filter((j) => {
    if (filter !== "all" && j.status !== filter) return false;
    if (!needle) return true;
    return j.title.toLowerCase().includes(needle) || (j.description ?? "").toLowerCase().includes(needle);
  });
  const by = {
    recent: (a: Journey, b: Journey) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    title: (a: Journey, b: Journey) => a.title.localeCompare(b.title),
    progress: (a: Journey, b: Journey) => (b.progress ?? 0) - (a.progress ?? 0),
    links: (a: Journey, b: Journey) => (b.linkCount ?? 0) - (a.linkCount ?? 0),
  }[sort];
  return [...out].sort(by);
}

export interface NextStepInput {
  status: Journey["status"];
  /** 0..100, as shown by the panel's slider. */
  pct: number;
  /** True total of linked items (server count, not the display window). */
  totalCount: number;
  taskCount: number;
  goalCount: number;
}

/**
 * The next-step / milestone prompt surface (IM-88): progress in this app is a
 * manual slider — there are no stored milestones to read — so the prompt is
 * DERIVED from what the journey actually contains, and says so by construction
 * (each variant names the concrete thing it is based on). Returns null for a
 * completed journey, whose honest next step is none.
 */
export function nextStepFor(input: NextStepInput): string | null {
  if (input.status === "done") return null;
  if (input.totalCount === 0) {
    return "Next step: link a memory, task, or transaction below — a chapter needs something in it to move forward.";
  }
  if (input.pct >= 100) {
    return "Milestone reached: progress is at 100% — mark this Journey complete when it feels finished.";
  }
  if (input.taskCount > 0) {
    return `Next step: finish one of the ${input.taskCount} linked task${input.taskCount === 1 ? "" : "s"}, then move the progress slider to match.`;
  }
  if (input.goalCount > 0) {
    return "Next step: make one payment or allocation toward a linked goal, then nudge the progress slider.";
  }
  if (input.pct === 0) {
    return "Next step: take one small action on something linked here today, then move the progress slider off 0%.";
  }
  return "Next step: keep going — one more linked action, then move the progress slider a little further.";
}
