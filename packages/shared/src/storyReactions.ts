/**
 * Item Reactions (docs/lore/DRAFT_5_THE_WEB.md §4): people are known by what they notice in your hands. When you meet a canon person while holding a particular thing they have
 * a line about, they say it sideways — their relationship to the thing, never an explanation. Holding is enough: nothing is spent, given up or required, and a reaction never
 * gates anything. The lines are CANON (public), so each is voiced once in that person's own voice and shared (docs/specs/lore-narration-2026-10-30.md §3).
 *
 * Only people who exist in the cast (shared/npcs.ts) are here, each with at least three (Draft 5 §4); the rest of Draft 5's reactions wait for their people.
 */

/** Who is speaking — selects the ElevenLabs voice (`LORE_TTS_VOICE_<ROLE>`); any role without its own voice set is read by the narrator's. */
export type VoiceRole = "narrator" | "eternity" | "calend" | "ysmerel" | "dorrow" | "dissenter" | "surveyor" | "archivist" | "keeper" | "hesk" | "tamsin" | "ossian" | "ilsabet" | "pell" | "wim";

/** Every role that can have its own voice, in the order the console lists them. */
export const VOICE_ROLES: readonly VoiceRole[] = ["narrator", "eternity", "calend", "ysmerel", "dorrow", "dissenter", "surveyor", "archivist", "keeper", "hesk", "tamsin", "ossian", "ilsabet", "pell", "wim"];

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
  { npc: "broker", holds: "sight.missing-berth", role: "dorrow", line: "The berths and the ships come out equal on the count. That is what troubles me." },
  { npc: "archivist", holds: "sight.open-alcove", role: "archivist", line: "Yes. It was left open on purpose. Please do not fill it." },
  { npc: "keeper", holds: "relic.dawn-leaf", role: "keeper", line: "That is from a morning I was not awake for. Keep it dry." },
  { npc: "eternity", holds: "sight.long-room", role: "eternity", line: "Long. It is meant to be. I have not yet reached the end of it either." },
  { npc: "eternity", holds: "echo.eighth-bell", role: "eternity", line: "You counted. Most do not count past seven." },
  { npc: "eternity", holds: "relic.witness-without-a-name", role: "eternity", line: "I will not say its name. It is not mine to say, and not yours to ask." },
  { npc: "hesk", holds: "obj.tin-soldier", role: "hesk", line: "I don’t know whose that is." },
  { npc: "hesk", holds: "sight.locked-room", role: "hesk", line: "You stood at the door. Then you know I never meant it as a wall." },
  { npc: "hesk", holds: "obj.kiths-drawing", role: "hesk", line: "A child drew that? Put it where it will not be hushed." },
  { npc: "tamsin", holds: "obj.kiths-drawing", role: "tamsin", line: "She draws her every week. I keep the ones she leaves behind." },
  { npc: "tamsin", holds: "sight.tamsins-ward", role: "tamsin", line: "You sat with them. Thank you. They can tell when someone has." },
  { npc: "tamsin", holds: "obj.vesh-paper-boat", role: "tamsin", line: "A boat folded from a page. Someone is very tired, and very kind." },
  { npc: "ossian", holds: "obj.follower-ribbon", role: "ossian", line: "You found my ribbon. It was never mine, but I will say it was." },
  { npc: "ossian", holds: "sight.lane-to-nowhere", role: "ossian", line: "That lane is true, which spoils it for me. Walk it anyway." },
  { npc: "ossian", holds: "obj.doorkeepers-nail", role: "ossian", line: "Calend’s nail. I told that story once and made the nail cold. I was wrong on purpose." },
  { npc: "ilsabet", holds: "sight.lane-to-nowhere", role: "ilsabet", line: "Mine. The lane. I only drew where it stops." },
  { npc: "ilsabet", holds: "obj.dissenters-chart", role: "ilsabet", line: "Where did you find that? That is my chart, in his hand." },
  { npc: "ilsabet", holds: "sight.second-seam", role: "ilsabet", line: "You heard it hum. Then you can tell me which way to draw." },
  { npc: "pell", holds: "obj.follower-ribbon", role: "pell", line: "That is mine. Or it will be. I have never been sure of the tense." },
  { npc: "pell", holds: "sight.hung-star", role: "pell", line: "Its light is late. So am I. We have never met in the same hour." },
  { npc: "pell", holds: "companion.dock-1", role: "pell", line: "You shared a cup with someone. I left them a note." },
  { npc: "wim", holds: "obj.anonymous-payments", role: "wim", line: "That is the unclaimed slip. Please do not tell me whose it is. I would have to know." },
  { npc: "wim", holds: "sight.missing-berth", role: "wim", line: "Yes. The berth. I count it every morning." },
  { npc: "wim", holds: "relic.mooring-ring", role: "wim", line: "Brannoch’s ring. It is warm. I know it is warm." },
  { npc: "keeper", holds: "sight.village-chair", role: "keeper", line: "That chair is not for resting. It is for waiting. They are different, and I know both." },
  { npc: "tamsin", holds: "obj.village-bread", role: "tamsin", line: "One slice more than the house needs. I have done that. I will not say for whom." },
  { npc: "wayfarer", holds: "obj.village-hooks", role: "calend", line: "Someone set those for hands that were not yet born. I always hoped they would take them." },
  { npc: "keeper", holds: "obj.village-thread-end", role: "keeper", line: "I gave you the soft end. The other end is where my family keeps its patience." },
  { npc: "archivist", holds: "obj.unmade-blank-leaf", role: "archivist", line: "I set it down. I did not burn it. Those are the two verbs I am proudest of." },
  { npc: "cantor", holds: "echo.unmade-note", role: "ysmerel", line: "It stops where the verse stops. I have never had the courage to sing past it." },
  { npc: "wayfarer", holds: "sight.unmade-ring", role: "calend", line: "I have walked up to that line from every side. It is a very good line." },
  { npc: "tamsin", holds: "sight.unmade-no-mark", role: "tamsin", line: "Be glad it will not keep you. Some of us were kept and we are still carrying it." },
  { npc: "wayfarer", holds: "obj.road-nails", role: "calend", line: "I set one of those, once. I did not set the rest. They are all warm." },
  { npc: "hesk", holds: "sight.road-post", role: "hesk", line: "My predecessors kept that post. I keep the bench swept. It is not a duty. It is a courtesy." },
  { npc: "wayfarer", holds: "sight.road-chalk-end", role: "calend", line: "Somebody was called away. I always hope it was for something kind." },
  { npc: "tamsin", holds: "sight.road-chalk", role: "tamsin", line: "A child's count. I know that hand, or one like it. Do not ask me whose." },
  // Item Reactions to the heavens (Draft 9 §6): a person remarks on a thing you hold that sits on one of the bodies' threads.
  { npc: "pell", holds: "relic.star-hanger", role: "pell", line: "Someone hung that for whoever was late. I have always been grateful, and always a little after." },
  { npc: "surveyor", holds: "relic.unnumbered-fragment", role: "surveyor", line: "It came off something that was never on a chart. Measure it if you like. It will not agree." },
  { npc: "ilsabet", holds: "relic.sunward-compass", role: "ilsabet", line: "It points the way I have been drawing. I did not ask it to." },
  { npc: "dissenter", holds: "relic.first-light-shard", role: "dissenter", line: "The oldest light still arriving. Do not let anyone tell you it is finished arriving." },
  { npc: "wayfarer", holds: "relic.mooring-ring", role: "calend", line: "He stopped on the road and stayed. Some of us cannot. I envy him a little." },
  { npc: "tamsin", holds: "obj.ward-soldier", role: "tamsin", line: "Someone stands it facing the door. I do not move it. I do not ask." },
  { npc: "tamsin", holds: "obj.ward-bowl", role: "tamsin", line: "It has never been cold. I have stopped checking, and I check every night." },
  { npc: "hesk", holds: "obj.ward-soldier", role: "hesk", line: "Leave it as it stands. It has been standing there longer than my orders." },
  { npc: "hesk", holds: "sight.ward-door", role: "hesk", line: "You went in. Good. Mind the door. It is meant to stay a little open." },
  { npc: "wayfarer", holds: "sight.gatepost-lamp", role: "calend", line: "Someone keeps that lit. I have never once asked who lights it for whom." },
  { npc: "tamsin", holds: "sight.ruels-laugh", role: "tamsin", line: "You heard him. Please do not tell the others. They will want to wait for him." },
  { npc: "tamsin", holds: "obj.linnets-coat", role: "tamsin", line: "I made up a cot for whoever wore that. It is not a rule. It is a habit." },
  { npc: "hesk", holds: "obj.linnets-coat", role: "hesk", line: "That coat stays on its hook. If it is gone, I will notice. I will not ask." },
  { npc: "cantor", holds: "sight.aldous-at-rest", role: "ysmerel", line: "He is resting. Do not stand too near. He would only try to make room." },
  { npc: "archivist", holds: "sight.aldous-at-rest", role: "archivist", line: "You saw him. Then I was right to leave the alcove open." },
  { npc: "broker", holds: "obj.blank-line", role: "dorrow", line: "A printing error. I have said so for years. You are kind not to answer." },
  { npc: "keeper", holds: "sight.marens-winter", role: "keeper", line: "Round it, please, not through it. Some things are not finished. They are resting." },
  { npc: "ossian", holds: "account.tall-tale", role: "ossian", line: "You noticed the wrong thing in it. Good. Now do not tell me which." },
  { npc: "surveyor", holds: "obj.orus-bead", role: "surveyor", line: "It is warmer than it should be, and exactly the size of a morning I was not there for." },
];

export function reactionFor(npc: string, found: ReadonlySet<string>): StoryReaction | null {
  return STORY_REACTIONS.find((r) => r.npc === npc && found.has(r.holds)) ?? null;
}

/** The reaction for exactly this pairing (the server uses it so a client can only ask for a line that exists). */
export function reactionBetween(npc: string, holds: string): StoryReaction | null {
  return STORY_REACTIONS.find((r) => r.npc === npc && r.holds === holds) ?? null;
}
