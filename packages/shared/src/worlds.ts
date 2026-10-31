/**
 * Worlds feature gate (Phase 2, P2-3). The app has no feature-flag
 * system, so the worlds travel layer shipped dark behind this constant:
 * while false, no travel UI mounts, no scene loads, and no travel API
 * calls are made. The owner turned it on after P3-1 merged (D-64),
 * as its own deliberate change — never as a side effect of other work.
 */
export const WORLDS_TRAVEL_ENABLED = true;

/**
 * The People gate (Phase 3, P3-3, Q1 — settled by the build-all delegation,
 * 2026-10-26): the gate appears when the brain holds at least three people
 * with at least two linked memories each, plus at least one memory shared
 * between two people — so the space can show a connection, not just
 * isolated clusters. The server enforces it (TravelRepo.peopleGateOpen,
 * re-checked against the database on every departure to People); the
 * client only displays what the server reports, never its own verdict.
 */
export const PEOPLE_GATE_MIN_PEOPLE = 3;
export const PEOPLE_GATE_MIN_MEMORIES_EACH = 2;
export const PEOPLE_GATE_MIN_SHARED_MEMORIES = 1;

/**
 * Eternity's world (Phase 3, Eternity app world, 2026-10-26). The
 * furthest world: the white void where Eternity himself stands. The
 * world is a real app world, not a mockup — its scene lives in
 * `graph/eternityScene.ts` — but reaching it is gated, by the owner's
 * settled B-01 rule (lore §6, relic-buffs note Rev 112):
 *
 * - The gate opens for a traveller holding the Witness Without a Name
 *   (the key) plus any two other relics. Once the gate has opened for
 *   a traveller it stays open to them — the only price after that is
 *   the fuel for the journey.
 * - The journey itself is a three-leg chain through at least two
 *   intermediate worlds (warp 10 per leg, no direct jump); drift legs
 *   are free, as everywhere.
 *
 * The relic holdings themselves live in the relic increment (the buffs
 * note's B-01 wiring — relic discovery + codex do not exist yet, so no
 * traveller holds anything today). This module defines the gate's
 * shape — the holdings interface and the pure predicate — so the
 * travel ledger can enforce the gate now and the relic increment can
 * supply real holdings later without changing the gate. Until that
 * wiring lands the gate is honestly closed: the world ships, nobody
 * can yet open the way to it, and the server says so in plain words.
 */
export const ETERNITY_WORLD_KEY = "eternity";

/**
 * The Faded Ward (docs/specs/seam-faded-ward-2026-10-31.md, owner "yes, build it" 2026-10-31): a long hall of cots that is a whole world. It is a door IN THE STORY, not a
 * progression wall: it opens for a traveller who has found Tamsin's Ward in the People world (the server checks the Book; the deployment owner is exempt like every gate),
 * and once opened it stays open. The usual warp cost applies; a warp home is free; drift is free.
 */
export const FADED_WARD_WORLD_KEY = "faded-ward";
/** The Book entry whose finding opens the way (the ward seen from the People world). */
export const FADED_WARD_GATE_ENTRY = "sight.tamsins-ward";

/**
 * The Road to the Seam (docs/specs/seam-road-to-the-seam-2026-10-31.md): a long road under the Station. Like the Ward it is a door in the story, not a progression wall — it
 * opens for a traveller who has found Teru's Harbor Nail (the server checks the Book; the owner is exempt) and stays open. It must never say where Teru ended.
 */
export const ROAD_WORLD_KEY = "road-to-the-seam";
export const ROAD_GATE_ENTRY = "relic.harbor-nail";

/**
 * The Village (S-V, The Forty-Second; docs/specs/seam-the-forty-second-2026-10-31.md): the hillside village the Many-Handed left. A door in the story, not a wall: it opens for a
 * traveller who has found the Thread of Many (the server checks the Book; the owner is exempt) and stays open. It must never say whether staying was right.
 */
export const VILLAGE_WORLD_KEY = "the-village";
export const VILLAGE_GATE_ENTRY = "relic.thread-of-many";

/**
 * The Unmade Hour (S-I; docs/specs/seam-the-unmade-hour-2026-10-31.md): the first Sixth Hour, before the second. A door in the story — it opens for a traveller who has found the Lullaby's Hollow
 * (the server checks the Book; the owner is exempt) and stays open. It must never say why the hour was made twice.
 */
export const UNMADE_WORLD_KEY = "the-unmade-hour";
export const UNMADE_GATE_ENTRY = "sight.lullaby-hollow";

/**
 * The Siege of the First Light (S-IV; docs/specs/seam-the-siege-2026-10-31.md): the battlefield made of pale edges, set beside the Deep Past. A door in the story — it opens for a traveller who has found
 * Oru's Bead (the server checks the Book; the owner is exempt) and stays open. It must never say what the First Morning was defended from, and never Oru's real age.
 */
export const SIEGE_WORLD_KEY = "the-siege";
export const SIEGE_GATE_ENTRY = "obj.orus-bead";

/**
 * The Unlit Hulls (S-VI; docs/specs/seam-the-unlit-hulls-2026-10-31.md): the yard where the seventh hull was laid, beside the Station. A door in the story — it opens for a traveller who has found the Blank Nameplate
 * (the server checks the Book; the owner is exempt) and stays open. It must never say the name that goes on the seventh plate.
 */
export const YARD_WORLD_KEY = "the-yard";
export const YARD_GATE_ENTRY = "sight.blank-nameplate";

/**
 * The Long Morning (S-II; docs/specs/seam-the-long-morning-2026-10-31.md): a world of light with no horizon, from before the hole. A door in the story — it opens for a traveller who has found the Unnumbered
 * Fragment (the server checks the Book; the owner is exempt) and stays open. It must never say whether the Uncounted is Eternity.
 */
export const LONG_MORNING_WORLD_KEY = "the-long-morning";
export const LONG_MORNING_GATE_ENTRY = "relic.unnumbered-fragment";
/**
 * Every way in (any one set opens the door; a set needs all of its entries). The Unnumbered Fragment lies in the Scale Space, whose relics are not yet discoverable in the app (docs/AUDIT_PLAYABILITY_2026-10-31.md,
 * gap G1), so the door must not depend on it alone: Orsolya's Shard — the other half of the first record, found in the Deep Past — opens it too.
 */
export const LONG_MORNING_GATE_SETS: readonly (readonly string[])[] = [[LONG_MORNING_GATE_ENTRY], ["relic.first-light-shard"]];

/**
 * The Folded Letter (S-VIII; docs/specs/seam-the-folded-letter-2026-10-31.md): the last room — an empty room with a letter on the floor, still folded. A door in the story that opens for a traveller who holds the
 * Unopened Fold (the server checks the Book; the owner is exempt). It is an ending reached only by choice: nothing leads here, nothing asks you to come, and nothing in it records whether the letter is opened.
 * It must never show the sentence's words, and never say whether the sentence is kind.
 */
export const FOLDED_LETTER_WORLD_KEY = "the-folded-letter";
export const FOLDED_LETTER_GATE_ENTRY = "relic.unopened-fold";
/**
 * The Unopened Fold lies in the Quiet/Archive, whose relics are not yet discoverable in the app (audit gap G1). The letter is also reachable by having seen the open alcove (where a letter lies unfolded-in-waiting) AND
 * held Vesh's paper boat (the page that had to be set down): two things a brain only has by having spent time in the Archive and kept company with Vesh — still a choice, never a prize.
 */
export const FOLDED_LETTER_GATE_SETS: readonly (readonly string[])[] = [[FOLDED_LETTER_GATE_ENTRY], ["sight.open-alcove", "obj.vesh-paper-boat"]];

/** The gate's key relic (lore §6): the Witness Without a Name. */
export const ETERNITY_GATE_KEY_RELIC = "witness-without-a-name";

/** Relics besides the key the gate requires. */
export const ETERNITY_GATE_OTHER_RELICS = 2;

/** Legs in the chain to Eternity's world (home → A → B → Eternity). */
export const ETERNITY_CHAIN_LEGS = 3;

/** Intermediate worlds the chain must pass through. */
export const ETERNITY_CHAIN_INTERMEDIATES = 2;

/**
 * What the gate needs to know about a traveller's relics. The relic
 * increment owns the source of truth (discovery + codex); this is the
 * narrow interface the gate reads — a key flag and a count of other
 * relics held — so no relic-system detail leaks into the travel
 * ledger. The default (no holdings supplied) is "holds nothing".
 */
export interface EternityGateHoldings {
  /** Holds the Witness Without a Name — the gate's key. */
  witnessWithoutName: boolean;
  /** Other relics held (any relics besides the key). */
  otherRelicCount: number;
}

export const NO_ETERNITY_HOLDINGS: EternityGateHoldings = {
  witnessWithoutName: false,
  otherRelicCount: 0,
};

/** The B-01 predicate, pure: key + any two other relics opens the gate. */
export function eternityGateOpens(holdings: EternityGateHoldings): boolean {
  return holdings.witnessWithoutName && holdings.otherRelicCount >= ETERNITY_GATE_OTHER_RELICS;
}

/**
 * Where each world sits on the chart (the world map's layout, 1000×700). Distance between two worlds prices a warp
 * (owner 2026-10-30: "10 fuel to everywhere, no — it needs to correspond to distance"). One copy, shared: the map draws these
 * positions and the server prices with them, so the picture and the price can never disagree.
 */
export const WORLD_COORDS: Readonly<Record<string, { x: number; y: number }>> = {
  home: { x: 500, y: 380 },
  "great-station": { x: 760, y: 250 },
  "growing-place": { x: 250, y: 480 },
  "deep-past": { x: 300, y: 180 },
  people: { x: 845, y: 335 },
  "quiet-archive": { x: 130, y: 620 },
  scale: { x: 850, y: 620 },
  eternity: { x: 905, y: 505 },
  "faded-ward": { x: 900, y: 420 },
  "road-to-the-seam": { x: 700, y: 120 },
  "the-village": { x: 240, y: 300 },
  "the-unmade-hour": { x: 110, y: 420 },
  "the-siege": { x: 330, y: 40 },
  "the-yard": { x: 640, y: 330 },
  "the-long-morning": { x: 480, y: 690 },
  "the-folded-letter": { x: 600, y: 760 },
};

/** Chart units one fuel flies, and the cheapest warp. */
export const WARP_UNITS_PER_FUEL = 45;
export const WARP_COST_MIN = 2;
/** Price when either end is not on the chart (never happens for a known world) — the old flat warp price. */
const WARP_COST_UNKNOWN = 10;

/**
 * Fuel for ONE warp leg: ⌈distance / 45⌉ + 1, at least 2. Going home is always free (D-1: home is always free) and so is
 * staying put; a drift is always free and never asks for this. Examples: Home → Station 8, → Growing Place 7, → Quiet 11,
 * Station → Quiet 18, Quiet ↔ Eternity 19. The worst leg is under a tenth of the 200 tank.
 */
export function warpCost(from: string, to: string): number {
  if (to === "home" || from === to) return 0;
  const a = WORLD_COORDS[from];
  const b = WORLD_COORDS[to];
  if (!a || !b) return WARP_COST_UNKNOWN;
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  return Math.max(WARP_COST_MIN, Math.ceil(distance / WARP_UNITS_PER_FUEL) + 1);
}

/**
 * Every STORY gate in one place (any one set opens the door; a set needs all of its entries). The server checks these against the brain's Book; the reachability test proves that a normal brain can actually
 * satisfy each of them (docs/AUDIT_PLAYABILITY_2026-10-31.md) — a new door must be added here or it will not be tested.
 */
export const STORY_WORLD_GATES: Readonly<Record<string, readonly (readonly string[])[]>> = {
  [FADED_WARD_WORLD_KEY]: [[FADED_WARD_GATE_ENTRY]],
  [ROAD_WORLD_KEY]: [[ROAD_GATE_ENTRY]],
  [VILLAGE_WORLD_KEY]: [[VILLAGE_GATE_ENTRY]],
  [UNMADE_WORLD_KEY]: [[UNMADE_GATE_ENTRY]],
  [SIEGE_WORLD_KEY]: [[SIEGE_GATE_ENTRY]],
  [YARD_WORLD_KEY]: [[YARD_GATE_ENTRY]],
  [LONG_MORNING_WORLD_KEY]: LONG_MORNING_GATE_SETS,
  [FOLDED_LETTER_WORLD_KEY]: FOLDED_LETTER_GATE_SETS,
};
