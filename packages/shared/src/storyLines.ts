import { STORY_BANNED } from "./story.js";

/**
 * The seven Lines of keeping (docs/specs/story-lines-2026-10-31.md; Draft 7 §4). Presentation only: a person is lit by finding anything of theirs, a Line's thread
 * is lit by two lit people. No counts anywhere, and an unlit person's name is never shown.
 */
export interface LinePerson {
  name: string;
  /** Entries that are theirs: finding any one lights them. */
  entries: readonly string[];
}
export interface StoryLine {
  id: string;
  title: string;
  people: readonly LinePerson[];
}

export const STORY_LINES: readonly StoryLine[] = [
  { id: "line.dawn", title: "The Line of the Dawn", people: [{ name: "Oru", entries: ["obj.orus-bead"] }, { name: "Orsolya", entries: ["relic.first-light-shard"] }] },
  { id: "line.measure", title: "The Line of the Measure", people: [{ name: "Sethane", entries: ["obj.measurers-cord"] }, { name: "Cael", entries: ["relic.basin-stone"] }] },
  {
    id: "line.door",
    title: "The Line of the Door",
    people: [{ name: "Calend", entries: ["obj.doorkeepers-nail"] }, { name: "Teru", entries: ["relic.harbor-nail"] }, { name: "Mara", entries: ["sight.gatepost-lamp"] }],
  },
  {
    id: "line.garden",
    title: "The Line of the Garden",
    people: [{ name: "Maren", entries: ["sight.marens-winter", "sight.dead-bough"] }, { name: "Iselle", entries: ["relic.dawn-leaf"] }, { name: "Wend", entries: ["relic.witness-seed"] }],
  },
  {
    id: "line.hearth",
    title: "The Line of the Hearth",
    people: [{ name: "Nuaré", entries: ["sight.empty-chair"] }, { name: "Maud and Edric", entries: ["relic.hearth-ember"] }, { name: "Tamsin", entries: ["sight.tamsins-ward"] }],
  },
  {
    id: "line.rest",
    title: "The Line of the Rest",
    people: [{ name: "Vesh", entries: ["obj.vesh-paper-boat", "sight.lullaby-hollow"] }, { name: "Noor", entries: ["relic.stillness-seal"] }, { name: "The Archivist", entries: ["relic.unopened-fold"] }],
  },
  {
    id: "line.choir",
    title: "The Line of the Choir",
    people: [
      { name: "Aldous", entries: ["sight.aldous-at-rest"] },
      { name: "Ysmerel", entries: ["sight.ysmerel-at-the-edge", "sight.ysmerels-hum", "obj.choirmasters-breath"] },
    ],
  },
];

export interface LineView {
  id: string;
  title: string;
  /** Lit people by name, in the Line's order. Unlit people are not listed at all. */
  lit: readonly string[];
  /** True once two people are lit: the story joins them. */
  thread: boolean;
}

export function lineView(line: StoryLine, found: ReadonlySet<string>): LineView {
  const lit = line.people.filter((p) => p.entries.some((e) => found.has(e))).map((p) => p.name);
  return { id: line.id, title: line.title, lit, thread: lit.length >= 2 };
}

export function checkStoryLines(lines: readonly StoryLine[], entryIds: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.id)) issues.push(`duplicate line ${l.id}`);
    seen.add(l.id);
    if (l.people.length < 2) issues.push(`${l.id}: needs at least two people for a thread`);
    const texts = [l.title];
    for (const p of l.people) {
      texts.push(p.name);
      if (p.entries.length === 0) issues.push(`${l.id}/${p.name}: nothing of theirs can be found`);
      for (const e of p.entries) if (!entryIds.has(e)) issues.push(`${l.id}/${p.name}: unknown entry ${e}`);
    }
    for (const t of texts) {
      if (/\d/.test(t)) issues.push(`${l.id}: a digit in "${t}"`);
      for (const re of STORY_BANNED) if (re.test(t)) issues.push(`${l.id}: banned wording in "${t}"`);
    }
  }
  return issues;
}
