/**
 * Relic buff arithmetic (design note v2 §10) — a pure function of the held
 * set, computed fresh on every read. No buffed value is ever stored.
 * Held order matters only for the Deep Past window: most recently held wins,
 * and the winner + overruled are named.
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
}
export const RELIC_EFFECTS: Readonly<Record<string, RelicEffect>> = {
  "harbor-nail": { fuelCapDelta: 25, reviewDelta: -1 },
  "mooring-ring": { driftDelta: 1, driftCapDelta: 1 },
  "witness-seed": { riseWindowDays: 45, growthSlower: true },
  "first-light-shard": { reviewDelta: 1, swingMultiplier: 1.25 },
  "lantern-of-keeping": { riseWindowDays: 45, growthSlower: true, risenHold: true },
  "thread-of-many": { linkDouble: true, riseWindowDays: 20 },
  "stillness-seal": { fuelRegenSet: 5.0, reviewDelta: -1 },
  "unopened-fold": { discoveryDelta: 2, growthSlower: true },
};

export function computeRelicBuffs(heldIdsInOrder: readonly string[]): EffectiveRelicBuffs {
  const effects = heldIdsInOrder.map((id) => RELIC_EFFECTS[id]).filter(Boolean) as RelicEffect[];
  const sum = (pick: (e: RelicEffect) => number | undefined) => effects.reduce((a, e) => a + (pick(e) ?? 0), 0);
  let riseWindowDays: number = RELIC_BASE.riseWindowDays;
  let riseWindowSetBy: string | null = null;
  const riseWindowOverruled: string[] = [];
  for (const id of heldIdsInOrder) {
    const w = RELIC_EFFECTS[id]?.riseWindowDays;
    if (w === undefined) continue;
    if (riseWindowSetBy !== null) riseWindowOverruled.push(riseWindowSetBy);
    riseWindowDays = w; riseWindowSetBy = id;
  }
  const slowers = effects.filter((e) => e.growthSlower).length;
  const regenSet = effects.map((e) => e.fuelRegenSet).filter((v): v is number => v !== undefined).at(-1);
  return {
    fuelCap: RELIC_BASE.fuelCap + sum((e) => e.fuelCapDelta),
    fuelRegenPerHour: Math.max(FUEL_REGEN_FLOOR_PER_HOUR, regenSet ?? RELIC_BASE.fuelRegenPerHour),
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
export function buffsForSpace(h: DbHandle, spaceId: string): EffectiveRelicBuffs {
  return computeRelicBuffs(heldRelicIds(h, spaceId));
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
