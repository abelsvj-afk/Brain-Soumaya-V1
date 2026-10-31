import { castIn, npcLocation, NPC_SLOT_MS, type CastMember } from "./npcs.js";
import {
  CURRENT_KEYS,
  callingOf,
  faction,
  hash01,
  npcFaith,
  ordinanceFor,
  type ActivityKind,
  type CurrentKey,
  type SocietyDay,
} from "./society.js";

/**
 * What each NPC is doing right now (docs/specs/npc-hive-society-2026-10-30.md): a deterministic, clock-driven plan, chosen per half hour from
 * {their routine} × {their faction's calling today} × {the governing ordinance} × {their own temper}, with mutual pairs for trading and debating.
 * Pure — server and web agree, and the same hour never looks the same twice because the day's seed, the slot and the currents all move it.
 */

export const ACTIVITY_SLOT_MS = 30 * 60_000;

export const WORLD_NAMES: Readonly<Record<string, string>> = {
  home: "Home",
  "great-station": "the Great Station",
  "growing-place": "the Growing Place",
  "deep-past": "the Deep Past",
  people: "the People world",
  "quiet-archive": "Quiet",
  scale: "Scale",
  "faded-ward": "the Faded Ward",
  "road-to-the-seam": "the Road to the Seam",
  "the-village": "the Village",
  "the-unmade-hour": "the Unmade Hour",
  "the-siege": "the Siege of the First Light",
  "the-yard": "the Unlit Hulls",
  "the-long-morning": "the Long Morning",
  "the-folded-letter": "the Folded Letter",
  eternity: "Eternity's world",
};

const TOPICS: Readonly<Record<CurrentKey, readonly string[]>> = {
  reverence: ["whether Eternity is listening", "what the hours are for", "how to keep faith on a long day"],
  giving: ["who needs help this week", "what a fair gift costs", "how to forgive a debt"],
  ambition: ["the price of fuel", "which lane pays best", "whether a plan is worth the risk"],
  appetite: ["what is worth wanting", "how much is enough", "the temptation of a cheap berth"],
  friction: ["the Wardens' ordinance", "who gets to close a lane", "what a quarrel is really about"],
  weight: ["how heavy the days have been", "who has gone quiet lately", "what a rest is worth"],
  peace: ["the quiet", "a good morning", "the light on the terraces"],
};

export type DoingKind = ActivityKind;

export interface NpcDoing {
  kind: DoingKind;
  /** Words, never colour alone: "trading fuel with the Broker". */
  caption: string;
  partnerId: string | null;
  /** What they are talking about, when the activity is a conversation (also what overheard chatter is about). */
  topic: string | null;
}

const KINDS: readonly ActivityKind[] = ["work", "trade", "refuel", "travel", "discuss", "worship", "rest", "patrol", "wander"];

/** The topic of conversation today: one of the two strongest currents, chosen by the slot. */
export function topicFor(society: SocietyDay, seed: string): string {
  const top = [...CURRENT_KEYS].sort((a, b) => society.currents[b] - society.currents[a]).slice(0, 2);
  const key = top[hash01(`${seed}|topic-key`) < 0.65 ? 0 : 1]!;
  const list = TOPICS[key];
  return list[Math.floor(hash01(`${seed}|topic`) * list.length)]!;
}

function pairOf(me: CastMember, mates: readonly CastMember[], sub: number): CastMember | null {
  if (mates.length < 2) return null;
  const order = [...mates].sort((a, b) => hash01(`${sub}|${a.id}`) - hash01(`${sub}|${b.id}`));
  const i = order.findIndex((m) => m.id === me.id);
  if (i < 0) return null;
  const j = i % 2 === 0 ? i + 1 : i - 1;
  return order[j] ?? null;
}

const nameOf = (m: CastMember) => (m.name.startsWith("The ") ? m.name.toLowerCase().replace(/^the /, "the ") : m.name);

function solo(member: CastMember, kind: ActivityKind, world: string, nowMs: number, faith: number): string {
  switch (kind) {
    case "work":
      return member.workCaption;
    case "refuel":
      return world === "great-station" ? "refuelling at the Drydock" : "refuelling";
    case "travel": {
      const next = npcLocation(member, nowMs + NPC_SLOT_MS);
      return next !== world ? `heading for ${WORLD_NAMES[next] ?? next}` : "on a long run";
    }
    case "discuss":
      return "talking with whoever will listen";
    case "worship":
      return faith >= 0.3 ? "in prayer" : "sitting out the hours";
    case "rest":
      return "resting";
    case "patrol":
      return "on patrol";
    case "wander":
      return "wandering";
    case "trade":
      return "checking the prices";
  }
}

export function npcDoing(
  member: CastMember,
  nowMs: number,
  ctx: { society: SocietyDay; world: string; mates: readonly CastMember[] },
): NpcDoing {
  const { society, world } = ctx;
  const sub = Math.floor(nowMs / ACTIVITY_SLOT_MS);
  const faith = npcFaith(member.faith, member.susceptibility, society.belief);
  const partner = pairOf(member, ctx.mates, sub);

  // A pair that is "social" this half hour does the same thing together, so a trade is seen from both ships.
  if (partner) {
    const pairKey = [member.id, partner.id].sort().join("+") + `|${sub}`;
    if (hash01(`${pairKey}|social`) < 0.4) {
      const ledger = member.faction === "ledger" || partner.faction === "ledger";
      const kind: ActivityKind = hash01(`${pairKey}|kind`) < (ledger ? 0.75 : 0.2) ? "trade" : "discuss";
      const topic = topicFor(society, pairKey);
      if (kind === "trade") {
        const verb = member.faction === "open-hand" ? "giving supplies to" : member.faction === "wardens" ? "inspecting the cargo of" : member.faction === "ledger" ? "trading fuel with" : "bartering with";
        return { kind, caption: `${verb} ${nameOf(partner)}`, partnerId: partner.id, topic: null };
      }
      const partnerFaith = npcFaith(partner.faith, partner.susceptibility, society.belief);
      const caption = Math.abs(faith - partnerFaith) > 0.8 ? `debating Eternity with ${nameOf(partner)}` : `discussing ${topic} with ${nameOf(partner)}`;
      return { kind, caption, partnerId: partner.id, topic };
    }
  }

  // Otherwise their own day: routine × calling × ordinance, rolled by the slot.
  const calling = callingOf(society, member.faction);
  const ordinance = ordinanceFor(world, society.currents, society.dayKey);
  const weights = KINDS.map((k) => {
    if (k === "trade" || k === "discuss") {
      // Trading needs a counterpart (only the Ledger will window-shop alone), and a debate is rarer without company.
      const alone = k === "trade" ? (member.faction === "ledger" ? 0.3 : 0) : 0.4;
      const base = (member.routine[k] ?? 0) * (partner ? 1 : alone);
      return base * (calling?.bias[k] ?? 1) * (ordinance.bias[k] ?? 1);
    }
    return (member.routine[k] ?? 0) * (calling?.bias[k] ?? 1) * (ordinance.bias[k] ?? 1);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let kind: ActivityKind = "work";
  if (total > 0) {
    let r = hash01(`${member.id}|${sub}|roll`) * total;
    for (let i = 0; i < KINDS.length; i++) {
      r -= weights[i]!;
      if (r <= 0) {
        kind = KINDS[i]!;
        break;
      }
    }
  }
  return { kind, caption: solo(member, kind, world, nowMs, faith), partnerId: null, topic: kind === "discuss" ? topicFor(society, `${member.id}|${sub}`) : null };
}

/** Everyone in a world right now with what they are doing — the one call the web (and the daily script's brief) needs. */
export function worldLife(
  world: string,
  nowMs: number,
  society: SocietyDay,
): { member: CastMember; doing: NpcDoing; faith: number; factionName: string | null; calling: string | null }[] {
  const mates = castIn(world, nowMs);
  return mates.map((member) => ({
    member,
    doing: npcDoing(member, nowMs, { society, world, mates }),
    faith: npcFaith(member.faith, member.susceptibility, society.belief),
    factionName: faction(member.faction)?.name ?? null,
    calling: callingOf(society, member.faction)?.text ?? null,
  }));
}
