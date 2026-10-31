/**
 * Relic buff arithmetic (design note v2 §10) — a pure function of the held
 * set plus the space's recorded Seed effects, computed fresh on every
 * read. No buffed value is ever stored.
 * Held order matters only for the Deep Past window: most recently held wins,
 * and the winner + overruled are named.
 *
 * §9 ITEM 7, RULED (tier decisions, 2026-10-30): location NEVER gates
 * buffs. A relic's buffs depend on one thing only — whether it is in
 * the held set (plus, for Seeds, whether its consumption is recorded).
 * Whether a held relic is carried or stored at the Great Station is
 * organization, not power: storage location is not an input to this
 * function and must never become one. This was already the shipped
 * behavior; the ruling settles it as law so no future change "fixes"
 * it by accident. Pinned by test (relicTiers.test.ts, item-7 describe).
 */
import {
  RELIC_BASE, RELIC_BY_ID, REVIEW_EARN_FLOOR, FUEL_REGEN_FLOOR_PER_HOUR,
  DRIFT_BONUS_FLOOR, GROWTH_MULTIPLIER_FLOOR,
  type EffectiveRelicBuffs,
} from "@brain/shared";
import type { DbHandle } from "../db/client.js";

interface RelicEffect {
  fuelCapDelta?: number; fuelRegenSet?: number; reviewDelta?: number;
  linkDouble?: boolean; discoveryDelta?: number; driftDelta?: number; driftCapDelta?: number;
  riseWindowDays?: number; growthSlower?: boolean; swingMultiplier?: number; risenHold?: boolean;
  /** Tier implementation (2026-10-30): a PERMANENT regen contribution.
   *  Additive by ruling — effective regen is (fuelRegenSet ?? base)
   *  + Σ fuelRegenDelta, floored as today — because a permanent effect
   *  must never be a set-point: set-points override each other
   *  last-wins, and a permanent set would silently erase (or be
   *  silently erased by) a held relic's set. A delta always counts. */
  fuelRegenDelta?: number;
}
export const RELIC_EFFECTS: Readonly<Record<string, RelicEffect>> = {
  "harbor-nail": { fuelCapDelta: 25, reviewDelta: -1 },
  "witness-seed": { riseWindowDays: 45, growthSlower: true },
  "first-light-shard": { reviewDelta: 1, swingMultiplier: 1.25 },
  "lantern-of-keeping": { riseWindowDays: 45, growthSlower: true, risenHold: true },
  "thread-of-many": { linkDouble: true, riseWindowDays: 20 },
  "unopened-fold": { discoveryDelta: 2, growthSlower: true },
  // The Mooring Ring's and Stillness Seal's held entries are REMOVED
  // (tier decisions, 2026-10-30): both are Seeds now, a Seed is never
  // held, and a held-effect entry for one would be dead code that lies
  // about the object's behavior. Their permanent forms live in
  // RELIC_SEED_EFFECTS below.
};

/** Relics I-6 (§4.5): the permanent effects of recorded Seeds, keyed
 *  by relic id. The tier decisions (2026-10-30) authored the values:
 *  the Mooring Ring carries ONLY its per-journey half (+1 drift; the
 *  held form's daily-cap raise does NOT become permanent — the ruled
 *  ceiling is 2 × 4 = 8/day, not the held form's 12), and the
 *  Stillness Seal is +0.5 fuel/hr as an additive delta (regen 4.0/hr
 *  on the 3.5 base; its held form's review cost does NOT become
 *  permanent — a Seed's effect is growth only).
 *
 *  The Dawn Leaf is DELIBERATELY ABSENT — debt D-1 in the tier
 *  decisions' register: its effect acts on partial milestone
 *  progress, and no partial-milestone progress feed exists yet, so no
 *  honest value can be authored. The absence is the honest state,
 *  not an omission: a recorded Dawn Leaf consumption contributes
 *  nothing today, and the day a value is authored here, every
 *  recorded consumption lights up with it automatically (the lookup
 *  is by the live map at computation time — no migration). */
export const RELIC_SEED_EFFECTS: Readonly<Record<string, RelicEffect>> = {
  "mooring-ring": { driftDelta: 1 },
  "stillness-seal": { fuelRegenDelta: 0.5 },
};

export function computeRelicBuffs(
  heldIdsInOrder: readonly string[],
  seedEffectIds: readonly string[] = [],
): EffectiveRelicBuffs {
  const effects = [
    ...heldIdsInOrder.map((id) => RELIC_EFFECTS[id]).filter(Boolean) as RelicEffect[],
    ...seedEffectIds.map((id) => RELIC_SEED_EFFECTS[id]).filter(Boolean) as RelicEffect[],
  ];
  const sum = (pick: (e: RelicEffect) => number | undefined) => effects.reduce((a, e) => a + (pick(e) ?? 0), 0);
  let riseWindowDays: number = RELIC_BASE.riseWindowDays;
  let riseWindowSetBy: string | null = null;
  const riseWindowOverruled: string[] = [];
  // Each id's window is read from ITS OWN class's map (residuals
  // sweep, closing the I-6 review's latent P2-1): a held relic's
  // window is its held effect's; a consumed Seed's is its seed
  // effect's. The previous shape read the HELD map first for every
  // id, so a seed-class relic that also carries a held-map entry
  // (witness-seed is the standing example) would take the held
  // map's window over its authored Seed window the day one is
  // written — and a held id's fallback into the seed map leaked
  // the same way in reverse. Iteration order is unchanged (held
  // ids in held order, then seed ids in recorded order; the last
  // window named wins, the rest are overruled).
  for (const [id, w] of [
    ...heldIdsInOrder.map((id) => [id, RELIC_EFFECTS[id]?.riseWindowDays] as const),
    ...seedEffectIds.map((id) => [id, RELIC_SEED_EFFECTS[id]?.riseWindowDays] as const),
  ]) {
    if (w === undefined) continue;
    if (riseWindowSetBy !== null) riseWindowOverruled.push(riseWindowSetBy);
    riseWindowDays = w; riseWindowSetBy = id;
  }
  const slowers = effects.filter((e) => e.growthSlower).length;
  const regenSet = effects.map((e) => e.fuelRegenSet).filter((v): v is number => v !== undefined).at(-1);
  return {
    fuelCap: RELIC_BASE.fuelCap + sum((e) => e.fuelCapDelta),
    // Tier decisions (2026-10-30): regen = (the held set-point, or the
    // base when none is held) + every permanent fuelRegenDelta, floored
    // as always. The Seal's permanent +0.5 therefore always counts and
    // stacks honestly on top of any held set-point.
    fuelRegenPerHour: Math.max(FUEL_REGEN_FLOOR_PER_HOUR, (regenSet ?? RELIC_BASE.fuelRegenPerHour) + sum((e) => e.fuelRegenDelta)),
    reviewEarn: Math.max(REVIEW_EARN_FLOOR, RELIC_BASE.reviewEarn + sum((e) => e.reviewDelta)),
    linkEarn: effects.some((e) => e.linkDouble) ? RELIC_BASE.linkEarn * 2 : RELIC_BASE.linkEarn,
    discoveryEarn: RELIC_BASE.discoveryEarn + sum((e) => e.discoveryDelta),
    driftBonus: Math.max(DRIFT_BONUS_FLOOR, RELIC_BASE.driftBonus + sum((e) => e.driftDelta)),
    driftDailyCap: RELIC_BASE.driftDailyCap + sum((e) => e.driftCapDelta),
    riseWindowDays, riseWindowSetBy, riseWindowOverruled,
    growthMultiplier: Math.max(GROWTH_MULTIPLIER_FLOOR, 1 - 0.25 * slowers),
    emotionalSwingMultiplier: effects.reduce((a, e) => a * (e.swingMultiplier ?? 1), 1),
    risenHold: effects.some((e) => e.risenHold),
  };
}

export function relicName(id: string | null): string | null {
  return id ? (RELIC_BY_ID.get(id)?.name ?? id) : null;
}

/** Held relic ids for a space, in held order (oldest held first). Reads only relic_holdings. */
export function heldRelicIds(h: DbHandle, spaceId: string): string[] {
  try {
    const rows = h.sqlite.prepare(
      `SELECT relic_id FROM relic_holdings WHERE space_id = ? AND held = 1 ORDER BY held_at ASC, rowid ASC`,
    ).all(spaceId) as { relic_id: string }[];
    return rows.map((r) => r.relic_id).filter((id) => RELIC_BY_ID.has(id));
  } catch { return []; }
}
/** Relics I-6 (§4.5): this space's recorded Seed effects, in the
 *  order they were recorded — computeRelicBuffs' second input. Same
 *  bare-handle guard as heldRelicIds (test handles may lack the
 *  table; a missing table means no effects, never a throw). */
export function seedEffectIdsForSpace(h: DbHandle, spaceId: string): string[] {
  try {
    const rows = h.sqlite.prepare(
      `SELECT relic_id FROM relic_seed_effects WHERE space_id = ? ORDER BY applied_at ASC, rowid ASC`,
    ).all(spaceId) as { relic_id: string }[];
    return rows.map((r) => r.relic_id).filter((id) => RELIC_BY_ID.has(id));
  } catch { return []; }
}
export function buffsForSpace(h: DbHandle, spaceId: string): EffectiveRelicBuffs {
  return computeRelicBuffs(heldRelicIds(h, spaceId), seedEffectIdsForSpace(h, spaceId));
}
export function applyGrowthMultiplier(current: number, requested: number, multiplier: number): number {
  const c = Math.max(0, Math.min(1, current)); const r = Math.max(0, Math.min(1, requested));
  if (r <= c) return r;
  return Math.max(0, Math.min(1, c + (r - c) * multiplier));
}
/** Shard swing, display only: scale one displayed point, clamped to [-1, 1]. */
export function swingDisplayPoint(value: number, multiplier: number): number {
  return Math.max(-1, Math.min(1, value * multiplier));
}
