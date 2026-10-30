import { NPC_TALK_BY_ID, NPC_VOICE_ROLE } from "./npcDialogue.js";
import { STORY_ROAD_BY_ID } from "./storyRoads.js";
import { STORY_RUMOURS } from "./storyRumours.js";

/**
 * Resolve a NAMED talk line to its canon words and voice role (docs/specs/npc-dialogue-voice-2026-10-31.md). The server uses this so a request names a line, never text.
 * Keys: who | place-home | place-away | job | farewell | allfound | rumour | step:<id> | point:<entryId> | road:<roadId>:offer | road:<roadId>:gift.
 */
export function talkLine(npc: string, key: string): { text: string; role: string } | null {
  const t = NPC_TALK_BY_ID.get(npc);
  const role = NPC_VOICE_ROLE[npc];
  if (!t || !role) return null;
  const text = ((): string | null => {
    switch (key) {
      case "who":
        return t.who;
      case "place-home":
        return t.placeHome;
      case "place-away":
        return t.placeAway;
      case "job":
        return t.job;
      case "farewell":
        return t.farewell;
      case "allfound":
        return t.allFound;
      case "rumour":
        return STORY_RUMOURS.find((r) => r.npc === npc)?.line ?? null;
    }
    if (key.startsWith("step:")) return t.thread.find((s) => s.id === key.slice(5))?.say ?? null;
    if (key.startsWith("point:")) return t.points.find((p) => p.entryId === key.slice(6))?.say ?? null;
    const m = /^road:([a-z0-9.-]+):(offer|gift)$/.exec(key);
    if (m) {
      const road = STORY_ROAD_BY_ID.get(m[1]!);
      return road && road.giver === npc ? road[m[2] as "offer" | "gift"] : null;
    }
    return null;
  })();
  return text ? { text, role } : null;
}
