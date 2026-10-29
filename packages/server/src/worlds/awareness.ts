import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { NpcRepo } from "../npcs/repo.js";

/**
 * Soumaya's awareness of the worlds and of Eternity (docs/specs/eternity-autonomy-2026-10-29.md §2a). Added to the
 * SHARED companion context, so the web chat and the Telegram agent both know where the brain is, whether a journey is
 * under way, which worlds are reachable, and what Eternity last did (from his own log, with its cause). Read-only,
 * deterministic, no LLM; best-effort — any failure adds nothing.
 *
 * She speaks ABOUT him, never AS him, and never invents an act he did not log.
 */

const WORLD_NAMES: Record<string, string> = {
  home: "Home (the home galaxy)",
  "great-station": "the Great Station",
  "growing-place": "the Growing Place",
  "deep-past": "the Deep Past",
  people: "the People world",
  "quiet-archive": "Quiet/Archive",
  scale: "Scale",
  eternity: "Eternity's world",
};

export function worldName(key: string): string {
  return WORLD_NAMES[key] ?? key;
}

const ACT_WORDS: Record<string, (act: string) => string> = {
  gesture: (a) => `made the gesture "${a}"`,
  "reorder-light": () => "reordered the heavens",
  speak: (a) => `said: "${a.length > 160 ? `${a.slice(0, 157)}…` : a}"`,
  wait: () => "waited",
};

function ago(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function worldsSnapshotText(h: DbHandle, spaceId: string = DEFAULT_SPACE, nowMs: number = Date.now()): string | null {
  const travel = new TravelRepo(h, spaceId).getState(nowMs);
  const lines: string[] = [];
  lines.push("WORLDS & ETERNITY (live state of the user's worlds — you may talk about these; you are Soumaya, not Eternity):");
  lines.push(`- The user's ship is at: ${worldName(travel.currentWorld)}.`);
  const j = travel.activeJourney;
  if (j) {
    const how = j.kind === "warp" ? "warping" : "drifting";
    const phase = j.state === "arming" ? "about to depart (still cancellable)" : j.state === "returning" ? "turning back" : "under way";
    lines.push(`- A journey is ${phase}: ${how} from ${worldName(j.origin)} to ${worldName(j.destination)}.`);
  }
  const reachable = ["Home", "the Great Station", "the Growing Place", "the Deep Past", "Quiet/Archive", "Scale"];
  if (travel.peopleGateOpen) reachable.push("the People world");
  if (travel.eternityReachable) reachable.push("Eternity's world");
  lines.push(`- Worlds the user can travel to: ${reachable.join(", ")}. (Travel is in Tools → Travel; drift is free, warp costs fuel.)`);

  const npcs = new NpcRepo(h, spaceId);
  const eternityStopped = npcs.state("eternity").stopped;
  const log = npcs.recentLog("eternity").filter((e) => e.kind !== "wait").slice(0, 3);
  lines.push(
    "- Eternity: a cosmic being who lives in his own world — he was and always is. He acts on his own, rarely, and may write to the user himself (signed \"✦ Eternity\"). He is NOT you and you never speak for him.",
  );
  if (eternityStopped) lines.push("  · The user has stopped him for now (Settings → Eternity), so he does nothing.");
  if (log.length === 0) lines.push("  · He has not acted recently.");
  for (const e of log) {
    const say = ACT_WORDS[e.kind]?.(e.act) ?? e.kind;
    lines.push(`  · ${ago(e.createdAt, nowMs)} he ${say} — why: ${e.cause}`);
  }
  const harbor = npcs.recentLog("harbor-controller").find((e) => e.kind === "speak");
  if (harbor) lines.push(`- The Station's harbor controller last said (${ago(harbor.createdAt, nowMs)}): "${harbor.act}"`);
  return lines.join("\n");
}
