import type { GraphNode, CelestialClass, CodexMindKind, CodexPhenomenon } from "@brain/shared";
import { CELESTIAL_CLASSES, CELESTIAL_ICON, CELESTIAL_LABEL, NODE_TYPE_LABEL } from "@brain/shared";
import { statsSpaceId } from "./achievements.js";

/**
 * The Codex — a living, gamified atlas of your memory galaxy. Entries start LOCKED
 * (undiscovered), unlock as your galaxy grows, then LEVEL UP the more you engage.
 * Everything is computed live from graph state (+ a couple of localStorage stats),
 * mirroring the achievements pattern — no server round-trip to render it.
 */

export type CodexCategory = "sectors" | "bodies" | "constellations" | "mind" | "fleet" | "phenomena" | "fieldnotes";

export const CODEX_CATEGORIES: { id: CodexCategory; title: string; icon: string; blurb: string }[] = [
  { id: "sectors", title: "Sectors", icon: "🗺️", blurb: "The named regions of your inner cosmos — one per kind of memory." },
  { id: "constellations", title: "Constellations", icon: "🌌", blurb: "The Maps of Content you've charted from clusters of related memories." },
  { id: "mind", title: "The Mind Layer", icon: "🧠", blurb: "What your galaxy is THINKING — the goals, skills, people and ideas that give it direction." },
  { id: "bodies", title: "Celestial Bodies", icon: "✸", blurb: "The classes of body a memory can grow into, from asteroid to supergiant." },
  { id: "fleet", title: "The Fleet", icon: "🛸", blurb: "Soumaya and the machines that tend your galaxy." },
  { id: "phenomena", title: "Phenomena", icon: "✦", blurb: "Rare events and milestones discovered as your galaxy comes alive." },
  { id: "fieldnotes", title: "Soumaya's Field Notes", icon: "✒️", blurb: "Discoveries Soumaya charted on her own, as your galaxy revealed them." },
];

/** A server-charted discovery (Soumaya's field notes) → a discovered Codex entry. */
export interface AgentDiscovery { key: string; title: string; lore: string; icon: string; focusId: number | null; createdAt: string }
export function fieldNoteEntries(discoveries: AgentDiscovery[]): CodexEntry[] {
  return discoveries.map((d) => ({
    id: `fieldnote-${d.key}`,
    category: "fieldnotes" as const,
    icon: d.icon || "✒️",
    title: d.title,
    lockedHint: "",
    lore: d.lore,
    discovered: true,
    level: 1,
    maxLevel: 1,
    levelLabel: "Charted by Soumaya",
    focusId: d.focusId ?? undefined,
    // IM-91: keep the charting date — field notes are a chronology, and
    // dropping createdAt here erased it before the panel ever saw it.
    createdAt: d.createdAt,
  }));
}

export interface CodexEntry {
  id: string;
  category: CodexCategory;
  icon: string;
  title: string;
  lockedHint: string;
  lore: string;
  discovered: boolean;
  /** 0 when locked; 1..maxLevel once discovered (deeper the more you engage). */
  level: number;
  maxLevel: number;
  levelLabel: string;
  progressToNext?: { cur: number; target: number };
  /** A memory id to fly to, when the entry maps to a specific body. */
  focusId?: number;
  /** When the entry was charted (field notes carry the server's date). */
  createdAt?: string;
  /**
   * IM-95: a locked entry whose unlock lives in another dock tab carries a
   * go-there action, instead of only naming that tab's vocabulary in prose.
   * `tab` is a RightDock DockTab id.
   */
  goTo?: { tab: string; label: string };
}

export interface CodexCtx {
  /** Real memories (no actions, no MOC hubs). */
  memories: GraphNode[];
  /** MOC hub nodes. */
  constellations: GraphNode[];
  /** Total edge count. */
  links: number;
}

const stat = (key: string): number => {
  try {
    return parseInt(localStorage.getItem(`stat.${key}.${statsSpaceId()}`) || "0", 10) || 0;
  } catch {
    return 0;
  }
};

const ageDays = (n: GraphNode): number => {
  const t = Date.parse(n.occurredAt ?? n.createdAt ?? "");
  return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86_400_000);
};

/** A tier from a count against ascending thresholds. Returns level (0 if below first). */
function tierOf(count: number, thresholds: number[]): { level: number; next?: number } {
  let level = 0;
  for (const t of thresholds) if (count >= t) level++;
  const next = thresholds[level];
  return { level, next };
}

// ---- Sectors: a region per memory kind, matching the server-side lore cosmology ----
const SECTOR_DEFS: { type: string; name: string; lore: string }[] = [
  { type: "person", name: "The Kinship Reaches", lore: "Where the people of your life burn — the bodies you orbit and are orbited by. Warm, crowded space; every star here has a name you know." },
  { type: "company", name: "The Guild Expanse", lore: "A trade-lane of institutions and teams — cold, orderly systems that your other memories dock with and depart." },
  { type: "project", name: "The Forge Fields", lore: "Restless space where efforts are hammered into being. Bodies here flare bright while active and cool the moment the work is set down." },
  { type: "decision", name: "The Crossroad Nebula", lore: "Every fork you've stood at, frozen mid-choice. Twin lights and the dark lane between them — the atlas remembers the road not taken." },
  { type: "meeting", name: "The Confluence", lore: "Where paths crossed at a single point in time. Brief, bright conjunctions that leave a gravitational mark long after they pass." },
  { type: "daily", name: "The Drift", lore: "The vast, gentle current of ordinary days — fleeting motes of light that, in sheer number, hold the galaxy together." },
  { type: "knowledge", name: "The Archive Belt", lore: "A slow ring of durable facts and learnings. Little heat, great permanence — the bedrock the living bodies are built upon." },
  { type: "concept", name: "The Deep Field", lore: "The abstract far reaches — ideas and principles that gravitationally lens everything nearer to the core." },
  { type: "other", name: "The Uncharted Verge", lore: "The edge of the mapped galaxy, where anything that fits no known region drifts until it finds its place." },
];

function sectorEntries(ctx: CodexCtx): CodexEntry[] {
  return SECTOR_DEFS.map((d) => {
    const count = ctx.memories.filter((m) => m.type === d.type).length;
    const { level, next } = tierOf(count, [1, 5, 15, 40]);
    return {
      id: `sector-${d.type}`,
      category: "sectors" as const,
      icon: "🗺️",
      title: d.name,
      lockedHint: `A region for “${NODE_TYPE_LABEL[d.type as keyof typeof NODE_TYPE_LABEL] ?? d.type}” memories — log one to chart it.`,
      lore: d.lore,
      discovered: count >= 1,
      level: Math.max(0, level),
      maxLevel: 4,
      levelLabel: count >= 1 ? `Charted · ${count} ${count === 1 ? "body" : "bodies"}` : "Uncharted",
      progressToNext: next ? { cur: count, target: next } : undefined,
    };
  });
}

// ---- Celestial bodies: one entry per class + the black hole ----
const BODY_LORE: Record<CelestialClass, string> = {
  asteroid: "The smallest bodies — new or fleeting thoughts, barely massed. Most memories begin here.",
  moon: "A thought with a little pull, caught in orbit of something larger than itself.",
  planet: "A settled, self-holding memory — round, weighty, worth returning to.",
  gas_giant: "A dense, emotionally-charged body whose gravity bends the bodies around it. Rings mark the rare ones.",
  giant: "A memory grown vast through connection and significance — a landmark you navigate by.",
  star: "A memory that burns — highly important, highly connected. It lights the space around it.",
  supergiant: "The rarest, heaviest light in your galaxy. A defining memory whose gravity shapes whole sectors.",
};

function bodyEntries(ctx: CodexCtx): CodexEntry[] {
  const has = (cls: CelestialClass) => ctx.memories.some((m) => m.celestial === cls);
  const countCls = (cls: CelestialClass) => ctx.memories.filter((m) => m.celestial === cls).length;
  const entries: CodexEntry[] = CELESTIAL_CLASSES.map((cls) => {
    const n = countCls(cls);
    const { level, next } = tierOf(n, [1, 5, 20]);
    return {
      id: `body-${cls}`,
      category: "bodies" as const,
      icon: CELESTIAL_ICON[cls],
      title: `The ${CELESTIAL_LABEL[cls]}`.replace(/\b\w/, (c) => c.toUpperCase()),
      lockedHint: `Grow a memory to ${CELESTIAL_LABEL[cls]} class to catalog it.`,
      lore: BODY_LORE[cls],
      discovered: has(cls),
      level: Math.max(0, level),
      maxLevel: 3,
      levelLabel: has(cls) ? `${n} in your galaxy` : "Never observed",
      progressToNext: next ? { cur: n, target: next } : undefined,
    };
  });
  // The black hole — the prestige body.
  const singularity = ctx.memories.length;
  entries.push({
    id: "body-singularity",
    category: "bodies",
    icon: "🕳️",
    title: "The Singularity",
    lockedHint: "Reach 365 memories — a full year of your mind — to witness it.",
    lore: "A black hole at the edge of your galaxy: the collapse-point of a year's remembering, more massive than any star. Nothing in your cosmos is bigger.",
    discovered: singularity >= 365,
    level: singularity >= 365 ? 1 : 0,
    maxLevel: 1,
    levelLabel: singularity >= 365 ? "Witnessed" : "Unseen",
    progressToNext: singularity >= 365 ? undefined : { cur: singularity, target: 365 },
  });
  return entries;
}

// ---- Constellations: dynamic, one per MOC hub ----
function constellationEntries(ctx: CodexCtx): CodexEntry[] {
  if (ctx.constellations.length === 0) {
    return [
      {
        id: "constellation-none",
        category: "constellations",
        icon: "🌌",
        title: "Chart your first constellation",
        lockedHint: "In the Insights tab, group related memories with “✦ Save as constellation”.",
        lore: "A constellation is a named hub that summarizes a whole body of work — a front door to a region of your mind. You haven't charted one yet.",
        discovered: false,
        goTo: { tab: "insights", label: "Open Insights →" },
        level: 0,
        maxLevel: 1,
        levelLabel: "Uncharted",
      },
    ];
  }
  return ctx.constellations.map((hub) => {
    const members = hub.degree ?? 0;
    const { level } = tierOf(members, [1, 5, 12, 25]);
    return {
      id: `constellation-${hub.id}`,
      category: "constellations" as const,
      icon: "🌌",
      title: hub.label,
      lockedHint: "",
      lore: hub.content || "A charted constellation of related memories.",
      discovered: true,
      level: Math.max(1, level),
      maxLevel: 4,
      levelLabel: `${members} ${members === 1 ? "member" : "members"}`,
      focusId: hub.id,
    };
  });
}

// ---- The Mind Layer: discover each cognitive kind as it first appears ----
// `kind` is typed against the shared catalog (CODEX_MIND_KINDS in @brain/shared):
// an id outside the server's rewardable set is a compile error, and the catalog
// sync test (codex.catalog.test.ts) proves the sets are exactly equal.
const MIND_DEFS: { kind: CodexMindKind; title: string; icon: string; lore: string; hint: string }[] = [
  { kind: "goal", title: "The Ambition", icon: "🎯", hint: "Set a goal in the Mind tab to chart it.", lore: "A goal is a gravity well set in your future — a body your memories fall toward, pulling your galaxy in a direction rather than just a shape." },
  { kind: "skill", title: "The Craft", icon: "🛠️", hint: "Add a skill in the Mind tab.", lore: "A skill brightens with every memory that proves practice — a star you don't set by hand but earn, tier by tier, from what you actually do." },
  { kind: "person_entity", title: "The Kindred", icon: "👤", hint: "Add a person in the Mind tab.", lore: "A person is a named star others orbit. Every memory that mentions them drifts into their gravity, and their light warms or cools with how you've been." },
  { kind: "identity", title: "The Self", icon: "🪞", hint: "Define an identity in the Mind tab.", lore: "An identity is held to the evidence of your life: memories that express who you are brighten it; ones that contradict it, in your own words, dim it." },
  { kind: "idea", title: "The Spark", icon: "💡", hint: "Capture an idea in the Mind tab.", lore: "An idea is alive — it brightens as memories come to support it, fades if you never return, and, once ripe, can be promoted into a goal your memories orbit." },
  { kind: "intention", title: "The Intention", icon: "🌠", hint: "Note something you mean to do soon.", lore: "A short-lived comet: an intention either gets fulfilled — you act, and it settles into memory — or it expires, burning up unremembered." },
  { kind: "motivation", title: "The Driving Force", icon: "🧭", hint: "Name a motivation in the Mind tab.", lore: "A motivation is the deep current beneath your goals — a gravity well that brightens as more of your galaxy aligns with it." },
];

function mindEntries(ctx: CodexCtx): CodexEntry[] {
  return MIND_DEFS.map((d) => {
    const count = ctx.memories.filter((m) => m.kind === d.kind).length;
    const { level, next } = tierOf(count, [1, 3, 8]);
    return {
      id: `mind-${d.kind}`,
      category: "mind" as const,
      icon: d.icon,
      title: d.title,
      lockedHint: d.hint,
      lore: d.lore,
      discovered: count >= 1,
      goTo: { tab: "mind", label: "Open the Mind tab →" },
      level: Math.max(0, level),
      maxLevel: 3,
      levelLabel: count >= 1 ? `${count} in your mind` : "Unformed",
      progressToNext: next ? { cur: count, target: next } : undefined,
    };
  });
}

// ---- Fleet ----
function fleetEntries(ctx: CodexCtx): CodexEntry[] {
  const hasMem = ctx.memories.length >= 1;
  const beacons = stat("beacons_deployed");
  const hops = stat("travel_hops");
  return [
    {
      id: "fleet-soumaya",
      category: "fleet",
      icon: "🛸",
      title: "Soumaya, the Starpilot",
      lockedHint: "Log your first memory to summon her.",
      lore: "Your autonomous caretaker. She flies the galaxy tending memories, forging connections, and keeping the dark at bay — a companion, not a tool.",
      discovered: hasMem,
      level: hops >= 15 ? 3 : hops >= 1 ? 2 : hasMem ? 1 : 0,
      maxLevel: 3,
      levelLabel: hasMem ? `${hops} voyages logged` : "Dormant",
      progressToNext: hops >= 15 ? undefined : { cur: hops, target: hops >= 1 ? 15 : 1 },
    },
    {
      id: "fleet-station",
      category: "fleet",
      icon: "🌐",
      title: "Waystation Soumaya-Prime",
      lockedHint: "Log your first memory.",
      lore: "The great orbital station where Soumaya recharges. The fixed point your galaxy turns around, second only to the Sun.",
      discovered: hasMem,
      level: hasMem ? 1 : 0,
      maxLevel: 1,
      levelLabel: hasMem ? "Online" : "—",
    },
    {
      id: "fleet-beacon",
      category: "fleet",
      icon: "🛰️",
      title: "Aura Beacons",
      lockedHint: "They deploy over memories going cold — keep tending as your galaxy grows.",
      lore: "Warming relays flung out to orbit cooling memories, projecting energy beams tinted by each star's emotion.",
      discovered: beacons >= 1,
      level: beacons >= 5 ? 2 : beacons >= 1 ? 1 : 0,
      maxLevel: 2,
      levelLabel: beacons >= 1 ? `${beacons} deployed` : "Undeployed",
      progressToNext: beacons >= 5 ? undefined : { cur: beacons, target: beacons >= 1 ? 5 : 1 },
    },
  ];
}

// ---- Phenomena: rare events + milestones ----
function phenomenaEntries(ctx: CodexCtx): CodexEntry[] {
  const firstLink = ctx.links >= 1;
  const star = ctx.memories.some((m) => m.celestial === "star" || m.celestial === "supergiant");
  const deep = ctx.memories.some((m) => (m.degree ?? 0) >= 6);
  const ancient = ctx.memories.some((m) => ageDays(m) >= 90);
  const cooling = ctx.memories.some((m) => (m.entropy ?? 0) >= 0.55);
  const tended = stat("memories_tended");
  const def = (
    id: CodexPhenomenon,
    icon: string,
    title: string,
    hint: string,
    lore: string,
    discovered: boolean,
  ): CodexEntry => ({
    id: `phenom-${id}`,
    category: "phenomena",
    icon,
    title,
    lockedHint: hint,
    lore,
    discovered,
    level: discovered ? 1 : 0,
    maxLevel: 1,
    levelLabel: discovered ? "Observed" : "Unobserved",
  });
  const joyful = ctx.memories.some((m) => (m.emotionalWeight ?? 0) >= 0.5);
  const heavy = ctx.memories.some((m) => (m.emotionalWeight ?? 0) <= -0.5);
  const bands = new Set(
    ctx.memories
      .filter((m) => typeof m.emotionalWeight === "number")
      .map((m) => ((m.emotionalWeight ?? 0) > 0.12 ? "+" : (m.emotionalWeight ?? 0) < -0.12 ? "-" : "0")),
  );
  const supergiant = ctx.memories.some((m) => m.celestial === "supergiant");
  const bigHub = ctx.constellations.some((h) => (h.degree ?? 0) >= 12);
  return [
    def("firstlink", "🔌", "First Synapse", "Log two related memories.", "The first filament between two memories — the moment a pile of notes became a mind.", firstLink),
    def("star", "★", "Ignition", "Grow a memory to star class.", "The first memory to catch fire and burn as a star: important, connected, luminous.", star),
    def("supernova", "💥", "Supernova", "Grow a memory to supergiant — the rarest, heaviest light.", "The brightest event your sky can hold: a memory so massive it bends whole sectors around it. Few galaxies ever see one.", supergiant),
    def("deep", "🧲", "Deep Cluster", "Grow a memory to 6+ connections.", "A gravity well: one memory so connected that others fall into orbit around it.", deep),
    def("crown", "👑", "Crown Jewel", "Grow a constellation to 12+ members.", "A constellation dense enough to be a landmark of its own — a crown of related stars you can navigate a whole region by.", bigHub),
    def("goldenhour", "🌅", "Golden Hour", "Log a deeply joyful memory.", "A star burning warm gold at the top of your emotional range — the light you return to on the hard days.", joyful),
    def("theweight", "🪨", "The Weight", "Log a deeply heavy memory.", "A dense, heavy body pulling hard on the space around it. Naming it is how you keep it from pulling the rest of the sky down with it.", heavy),
    def("aurora", "🌈", "Aurora", "Hold joyful, neutral AND heavy memories at once.", "The full emotional spectrum lit across your sky at once — proof of a galaxy that holds the whole of a life, not just its highlights.", bands.size >= 3),
    def("ancient", "🕰️", "Ancient Light", "Keep a memory alive for 90+ days.", "Light from a memory that has survived a full season — the oldest, steadiest glow in your sky.", ancient),
    def("cooling", "❄️", "The Cold", "Let a memory drift untended for a while.", "You've witnessed entropy: a memory cooling in neglect, its color bleeding toward blue. The dark your galaxy is always fighting.", cooling),
    def("tender", "🌿", "The Gardener", "Warm 10+ cooling memories back to life.", "Proof that nothing here truly dies while you return — light restored by hand, over and over.", tended >= 10),
  ];
}

export function buildCodex(ctx: CodexCtx): CodexEntry[] {
  return [
    ...sectorEntries(ctx),
    ...constellationEntries(ctx),
    ...mindEntries(ctx),
    ...bodyEntries(ctx),
    ...fleetEntries(ctx),
    ...phenomenaEntries(ctx),
  ];
}

export interface CodexProgress {
  discovered: number;
  total: number;
  pct: number;
  byCategory: Record<CodexCategory, { discovered: number; total: number }>;
}

export function codexProgress(entries: CodexEntry[]): CodexProgress {
  const byCategory = {} as Record<CodexCategory, { discovered: number; total: number }>;
  for (const c of CODEX_CATEGORIES) byCategory[c.id] = { discovered: 0, total: 0 };
  let discovered = 0;
  for (const e of entries) {
    byCategory[e.category].total++;
    if (e.discovered) {
      byCategory[e.category].discovered++;
      discovered++;
    }
  }
  const total = entries.length;
  return { discovered, total, pct: total ? Math.round((discovered / total) * 100) : 0, byCategory };
}
