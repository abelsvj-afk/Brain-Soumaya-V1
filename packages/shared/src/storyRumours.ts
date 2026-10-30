import { STORY_BANNED } from "./story.js";

/**
 * Seeds for the eight expansion seams (docs/lore/DRAFT_7_THE_DEEP_CAST.md §6, §8 step 7): one rumour per seam, said by someone who would know, so a later expansion is already
 * hinted in the world that exists. A rumour only ever points at a silence — it never states what the silence holds. Offered only after a few meetings, and nothing is gated by it.
 */
export interface StoryRumour {
  id: string;
  /** The seam it hints (Draft 7 §6). */
  seam: string;
  /** Who says it (cast id). */
  npc: string;
  /** Meetings before they say it. */
  minMeetings: number;
  line: string;
}

export const STORY_RUMOURS: readonly StoryRumour[] = [
  { id: "rumour.unmade-hour", seam: "S-I", npc: "cantor", minMeetings: 3, line: "Some of the old hymns count six hours and then six again. No one has ever agreed which count was the first." },
  { id: "rumour.long-morning", seam: "S-II", npc: "surveyor", minMeetings: 3, line: "Before the hole there was a record of a place with no horizon. It was written in light, and light does not keep." },
  { id: "rumour.road-to-the-seam", seam: "S-III", npc: "wayfarer", minMeetings: 4, line: "There is a long road under the Station. I walked it once as far as I dared. It goes on past where I turned back." },
  { id: "rumour.the-siege", seam: "S-IV", npc: "dissenter", minMeetings: 3, line: "Ask three people about the siege. One will say it was small. All three are certain." },
  { id: "rumour.the-forty-second", seam: "S-V", npc: "keeper", minMeetings: 3, line: "A village sent forty-one and counted forty-two at the gate. They have kept that count ever since." },
  { id: "rumour.unlit-hulls", seam: "S-VI", npc: "wim", minMeetings: 3, line: "Six ships of one family carry their names. The yard that laid the seventh keeps no ledger I can find." },
  { id: "rumour.faded-ward", seam: "S-VII", npc: "tamsin", minMeetings: 3, line: "The ward is larger than it looks from the door. The cots go on. I do not walk to the end of them." },
  { id: "rumour.folded-letter", seam: "S-VIII", npc: "archivist", minMeetings: 4, line: "There is a letter I keep and have never opened. Someone will come who is meant to decide." },
];

export const rumourFor = (npc: string, meetings: number): StoryRumour | null => STORY_RUMOURS.find((r) => r.npc === npc && meetings >= r.minMeetings) ?? null;

export function checkStoryRumours(rs: readonly StoryRumour[], castIds: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const seams = new Set<string>();
  for (const r of rs) {
    if (!castIds.has(r.npc)) issues.push(`${r.id}: ${r.npc} is not in the cast`);
    if (seams.has(r.seam)) issues.push(`${r.id}: seam ${r.seam} seeded twice`);
    seams.add(r.seam);
    if (/\d/.test(r.line)) issues.push(`${r.id}: a digit`);
    if (r.line.split(/\s+/).length > 32) issues.push(`${r.id}: too long`);
    for (const re of STORY_BANNED) if (re.test(r.line)) issues.push(`${r.id}: banned wording`);
  }
  return issues;
}
