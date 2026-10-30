/**
 * Item Reactions (docs/lore/DRAFT_5_THE_WEB.md §4): people are known by what they notice in your hands. When you meet a canon person while holding a particular thing they have
 * a line about, they say it sideways — their relationship to the thing, never an explanation. Holding is enough: nothing is spent, given up or required, and a reaction never
 * gates anything. The lines are CANON (public), so each is voiced once in that person's own voice and shared (docs/specs/lore-narration-2026-10-30.md §3).
 *
 * Only people who exist in the cast (shared/npcs.ts) are here, each with at least three (Draft 5 §4); the rest of Draft 5's reactions wait for their people.
 */

/** Who is speaking — selects the ElevenLabs voice (`LORE_TTS_VOICE_<ROLE>`); any role without its own voice set is read by the narrator's. */
export type VoiceRole = "narrator" | "eternity" | "calend" | "ysmerel" | "dorrow" | "dissenter" | "surveyor" | "archivist" | "keeper";

/** Every role that can have its own voice, in the order the console lists them. */
export const VOICE_ROLES: readonly VoiceRole[] = ["narrator", "eternity", "calend", "ysmerel", "dorrow", "dissenter", "surveyor", "archivist", "keeper"];

export interface StoryReaction {
  npc: string;
  /** The entry they notice you are holding. */
  holds: string;
  line: string;
  role: VoiceRole;
}

export const STORY_REACTIONS: readonly StoryReaction[] = [
  { npc: "wayfarer", holds: "relic.harbor-nail", role: "calend", line: "It’s warm, isn’t it. They always are." },
  { npc: "cantor", holds: "obj.choirmasters-breath", role: "ysmerel", line: "You are holding the length of a name. Please do not tell me whose." },
  { npc: "cantor", holds: "echo.hymnal-gap", role: "ysmerel", line: "You heard it too. Then you know why we stop where we stop." },
  { npc: "broker", holds: "obj.dorrows-page", role: "dorrow", line: "That is not from my Book. Put it away before the ink notices you." },
  { npc: "broker", holds: "obj.anonymous-payments", role: "dorrow", line: "Someone pays it every year. I have never been thanked, and I have never once asked." },
  { npc: "dissenter", holds: "obj.dissenters-chart", role: "dissenter", line: "You kept it. Good. Then at least one of us isn’t afraid." },
  { npc: "surveyor", holds: "obj.measurers-cord", role: "surveyor", line: "She taught me that knot. Leave the last one. It hasn’t ended." },
  { npc: "archivist", holds: "obj.vesh-paper-boat", role: "archivist", line: "That was folded from a page that had to be put down. I would know the fold anywhere." },
  { npc: "archivist", holds: "relic.unopened-fold", role: "archivist", line: "Keep it a while longer. I will ask you something about it, once. Not today." },
  { npc: "keeper", holds: "relic.witness-seed", role: "keeper", line: "Do not water what you cannot name." },
  { npc: "keeper", holds: "sight.dead-bough", role: "keeper", line: "It greens a little when someone finishes. Have you finished something?" },
  { npc: "wayfarer", holds: "obj.faded-ticket", role: "calend", line: "Someone wanted to go. I keep thinking that matters." },
  { npc: "wayfarer", holds: "obj.doorkeepers-nail", role: "calend", line: "I carried one of those once. I set it down where it was needed." },
  { npc: "dissenter", holds: "sight.unlooked-direction", role: "dissenter", line: "You looked the way no one looks. Did it look back?" },
  { npc: "dissenter", holds: "obj.follower-ribbon", role: "dissenter", line: "Someone told you that story wrong on purpose. Be kind to them." },
  { npc: "surveyor", holds: "sight.hung-star", role: "surveyor", line: "It isn’t where the charts keep it. It never was. That is the whole trouble." },
  { npc: "surveyor", holds: "relic.sunward-compass", role: "surveyor", line: "That points at something. I have stopped asking whether it is the sun." },
  { npc: "cantor", holds: "sight.ysmerel-at-the-edge", role: "ysmerel", line: "You saw her standing there. Thank you for not calling out." },
  { npc: "broker", holds: "obj.tin-soldier", role: "dorrow", line: "I don’t know whose that is." },
  { npc: "archivist", holds: "sight.open-alcove", role: "archivist", line: "Yes. It was left open on purpose. Please do not fill it." },
  { npc: "keeper", holds: "relic.dawn-leaf", role: "keeper", line: "That is from a morning I was not awake for. Keep it dry." },
  { npc: "eternity", holds: "sight.long-room", role: "eternity", line: "Long. It is meant to be. I have not yet reached the end of it either." },
  { npc: "eternity", holds: "echo.eighth-bell", role: "eternity", line: "You counted. Most do not count past seven." },
  { npc: "eternity", holds: "relic.witness-without-a-name", role: "eternity", line: "I will not say its name. It is not mine to say, and not yours to ask." },
];

export function reactionFor(npc: string, found: ReadonlySet<string>): StoryReaction | null {
  return STORY_REACTIONS.find((r) => r.npc === npc && found.has(r.holds)) ?? null;
}

/** The reaction for exactly this pairing (the server uses it so a client can only ask for a line that exists). */
export function reactionBetween(npc: string, holds: string): StoryReaction | null {
  return STORY_REACTIONS.find((r) => r.npc === npc && r.holds === holds) ?? null;
}
