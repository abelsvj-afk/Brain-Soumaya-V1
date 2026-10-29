/**
 * Fleet defense — the shared contract (Wave 2, fleet defense).
 *
 * Something the user already chose to release draws a purge fleet
 * from another world; Soumaya and her fleet defend the galaxy in a
 * Space Invaders-style defense, autonomously or with the player at
 * the helm (design note `docs/worlds/fleet-defense-design-note.md`).
 * This module is only the vocabulary both sides agree on: release
 * kinds and sizes, the wave composition, the ship assignments, the
 * defense and log shapes. The server owns every decision and every
 * outcome; the client renders what the server returns.
 *
 * The never-punish invariant binds everything here:
 * - a defense can only ever start from a user-marked release (no
 *   release, no fleet — the server enforces it);
 * - a purge fleet never deletes brain data: winning clears the
 *   charge the user already chose to release, and the linked brain
 *   record itself is never written by a defense;
 * - losing costs nothing: the fleet disperses, the charge stays,
 *   and the defense can be tried again later;
 * - defending your own brain is free (0 fuel).
 *
 * What is deliberately NOT here: threshold-triggered summoning (no
 * threshold/event system exists in the app yet — the defense is
 * summoned by the user's explicit offer); relic interplay (no relic
 * code exists on the tip yet); expedition costs (taking a fleet out
 * belongs to the fleet-missions increment). Each is a named
 * follow-up in the build record, not a silent gap.
 */

/** What the user chose to release. The release is the only thing a
 *  purge fleet may ever take — anything the user wants to keep is
 *  defended, never purged (design §3). */
export type FleetDefenseReleaseKind = "emotion" | "archived-memory" | "debt";

export const FLEET_DEFENSE_RELEASE_KINDS: readonly FleetDefenseReleaseKind[] = [
  "emotion",
  "archived-memory",
  "debt",
] as const;

/** Plain-words labels for the offer form — the kind is what the user
 *  is letting go of, in their own words on the record. */
export const FLEET_DEFENSE_KIND_LABELS: Record<FleetDefenseReleaseKind, string> = {
  emotion: "An emotion to let go of",
  "archived-memory": "An archived memory",
  debt: "A debt being worked down",
} as const;

/**
 * How big the release feels, picked by the user at offer time — the
 * ONLY thing difficulty scales with (design §4). Never a bad week,
 * never a score. Shown in plain words before the defense starts.
 */
export type FleetDefenseReleaseSize = "small" | "steady" | "big";

export const FLEET_DEFENSE_RELEASE_SIZES: readonly FleetDefenseReleaseSize[] = [
  "small",
  "steady",
  "big",
] as const;

/** Invaders per release size (design §4: a handful, 3–5, one wave). */
export const FLEET_DEFENSE_INVADERS_BY_SIZE: Record<FleetDefenseReleaseSize, number> = {
  small: 3,
  steady: 4,
  big: 5,
} as const;

export const FLEET_DEFENSE_SIZE_LABELS: Record<FleetDefenseReleaseSize, string> = {
  small: "Small — a light thing, 3 ships will come",
  steady: "Steady — a real weight, 4 ships will come",
  big: "Big — a heavy thing, 5 ships will come",
} as const;

/** The defense board: three lanes, positions that matter. An invader
 *  starts a few steps out from the charge and advances one step per
 *  tick; reaching 0 means it got through. The approach length grows
 *  with the wave — one extra step per extra ship — so every size
 *  allows exactly two spare rounds (small: 5 steps for 3 ships,
 *  steady: 6 for 4, big: 7 for 5). A bigger fleet is a longer
 *  approach, never a tighter noose: one missed shot is never the
 *  defense. */
export const FLEET_DEFENSE_LANES = 3;
export const FLEET_DEFENSE_START_DISTANCE_BY_SIZE: Record<FleetDefenseReleaseSize, number> = {
  small: 5,
  steady: 6,
  big: 7,
} as const;

/** Home defense costs no fuel (design §5). Taking a fleet out costs
 *  fuel — that price belongs to the fleet-missions increment. */
export const FLEET_DEFENSE_HOME_FUEL_COST = 0;

/** One ship: its key in the app's asset manifests, its public GLB
 *  URL, and the plain name the panel shows. Every key here already
 *  ships in the app — no new asset, no procedural stand-in. */
export interface FleetDefenseShip {
  key: string;
  url: string;
  name: string;
}

/**
 * Defenders: Soumaya's own ship plus Kenney craft (design §6).
 * The fourth Kenney hull (cargoB) stays docked at the Station in
 * reserve — the defense flies three defenders plus her ship.
 */
export const FLEET_DEFENSE_DEFENDERS: readonly FleetDefenseShip[] = [
  { key: "soumaya-ship", url: "/soumaya-ship.glb", name: "Soumaya's ship" },
  { key: "craft_cargoA", url: "/kenney-space-craft_cargoA.glb", name: "Kenney cargo hauler" },
  { key: "craft_miner", url: "/kenney-space-craft_miner.glb", name: "Kenney miner" },
  { key: "craft_racer", url: "/kenney-space-craft_racer.glb", name: "Kenney racer" },
] as const;

/**
 * Invaders: Quaternius fighters (design §6), in a fixed order — the
 * wave takes the first N, so a wave's composition is deterministic
 * and the panel can show it before the defense starts. Defenders
 * are Kenney hulls, invaders Quaternius hulls: distinct by hull kit,
 * never by color alone.
 */
export const FLEET_DEFENSE_INVADER_SHIPS: readonly FleetDefenseShip[] = [
  { key: "bob", url: "/quaternius-bob.glb", name: "Quaternius bob" },
  { key: "challenger", url: "/quaternius-challenger.glb", name: "Quaternius challenger" },
  { key: "dispatcher", url: "/quaternius-dispatcher.glb", name: "Quaternius dispatcher" },
  { key: "executioner", url: "/quaternius-executioner.glb", name: "Quaternius executioner" },
  { key: "imperial", url: "/quaternius-imperial.glb", name: "Quaternius imperial" },
] as const;

/** One invader on the board. `distance` is steps out from the
 *  charge (5 at summoning, 0 means it got through). */
export interface FleetDefenseInvader {
  lane: number;
  distance: number;
  shipKey: string;
  shipUrl: string;
  shipName: string;
  dispersed: boolean;
}

/**
 * Compose a wave for a release size — pure, so the panel can show
 * the fleet before the defense starts ("a bigger release draws a
 * bigger fleet, in plain words before the defense starts", design
 * §4). Invaders spread across the three lanes round-robin, nearest
 * lane first, so no lane starts empty when the wave allows it.
 */
export function composeWave(size: FleetDefenseReleaseSize): FleetDefenseInvader[] {
  const count = FLEET_DEFENSE_INVADERS_BY_SIZE[size];
  const distance = FLEET_DEFENSE_START_DISTANCE_BY_SIZE[size];
  const invaders: FleetDefenseInvader[] = [];
  for (let i = 0; i < count; i++) {
    const ship = FLEET_DEFENSE_INVADER_SHIPS[i];
    if (!ship) break;
    invaders.push({
      lane: (i % FLEET_DEFENSE_LANES) + 1,
      distance,
      shipKey: ship.key,
      shipUrl: ship.url,
      shipName: ship.name,
      dispersed: false,
    });
  }
  return invaders;
}

/** A release the user marked: offered, defending, or cleared. A
 *  lost defense returns the release to `offered` — the charge stays
 *  and can be defended again. Nothing is ever deleted by a defense. */
export type FleetDefenseReleaseStatus = "offered" | "defending" | "cleared";

export interface FleetDefenseRelease {
  id: number;
  kind: FleetDefenseReleaseKind;
  size: FleetDefenseReleaseSize;
  /** The release in the user's own plain words. */
  label: string;
  /** The brain record it concerns, when one was linked — a memory
   *  node id for the memory kinds. The defense never writes to it. */
  nodeId: number | null;
  status: FleetDefenseReleaseStatus;
  createdAt: string;
  updatedAt: string;
}

/** A defense: one wave, one release, one board. `status` is `active`
 *  until the wave resolves — `won` (every invader dispersed) or
 *  `lost` (an invader reached the charge). */
export type FleetDefenseStatus = "active" | "won" | "lost";

/** Who flew the last tick: Soumaya on her own, or the player at the
 *  helm. Switching is free and instant, either direction,
 *  mid-defense (design §4) — each tick names its own mode. */
export type FleetDefenseTickMode = "autonomous" | "helm";

export interface FleetDefenseState {
  id: number;
  releaseId: number;
  status: FleetDefenseStatus;
  invaders: FleetDefenseInvader[];
  /** Ticks played so far in this defense. */
  tickCount: number;
  lastMode: FleetDefenseTickMode | null;
  /** The last tick's plain-words line — what happened, in one sentence. */
  lastLine: string | null;
  /** The outcome in plain words, once resolved — the codex line on a
   *  win ("on this day, the fleet dispersed and the charge was let
   *  go"), the quiet "not yet" on a loss. */
  outcomeLine: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One append-only log entry: every offer, summoning, tick, win, and
 *  loss, with its cause in plain language — so anyone can ask "why
 *  did it do that?" and get an answer. `createdAt` is server storage
 *  (ISO); the client renders it in the viewer's own local time. */
export interface FleetDefenseLogEntry {
  id: number;
  defenseId: number | null;
  releaseId: number | null;
  kind: "offered" | "summoned" | "tick" | "won" | "lost";
  text: string;
  createdAt: string;
}

/** Everything the panel needs in one read: the releases, the active
 *  defense (if any — at most one per release, and the panel shows
 *  the newest), and the recent history. */
export interface FleetDefenseOverview {
  releases: FleetDefenseRelease[];
  activeDefense: FleetDefenseState | null;
  activeRelease: FleetDefenseRelease | null;
  history: FleetDefenseState[];
  recentLog: FleetDefenseLogEntry[];
}
