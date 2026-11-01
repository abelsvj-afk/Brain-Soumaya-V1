import type { DbHandle } from "../db/client.js";
import {
  CAPTAIN_AFFINITY_CAP,
  CAPTAIN_AFFINITY_COOLING_PER_DAY,
  CAPTAIN_AFFINITY_PREMIUM_TAKEN,
  captainDefinition,
  type CaptainId,
} from "@brain/shared";
import { PurposeStore } from "./purpose.js";

/**
 * P3 — trait affinities (Layer §4.3; numbers ruled as R7): one
 * value per captain pair, stored canonically (captain_a <
 * captain_b), capped at ±10, cooled toward zero by 1 point per
 * local day at her day rollover inside the advance. Affinity is
 * written ONLY by ruled events inside an advance — a premium taken
 * (evidenced targeting only), a Director tow assist, convoy
 * co-travel, a Station encounter — and read as a decider
 * consideration and as her stated opinion. It never gates the
 * player, never touches player state, and produces no combat,
 * destruction, or refusal-to-exist. It is not faction standing;
 * no faction reads it in P3.
 */

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function getAffinity(h: DbHandle, spaceId: string, a: CaptainId, b: CaptainId): number {
  if (a === b) return 0;
  const [x, y] = pair(a, b);
  const row = h.sqlite
    .prepare(`SELECT value FROM npc_affinity WHERE space_id = ? AND captain_a = ? AND captain_b = ?`)
    .get(spaceId, x, y) as { value: number } | undefined;
  return row?.value ?? 0;
}

export function affinitiesOf(h: DbHandle, spaceId: string, captainId: CaptainId): { captainId: CaptainId; value: number }[] {
  const rows = h.sqlite
    .prepare(
      `SELECT captain_a, captain_b, value FROM npc_affinity
        WHERE space_id = ? AND (captain_a = ? OR captain_b = ?) ORDER BY captain_a, captain_b`,
    )
    .all(spaceId, captainId, captainId) as { captain_a: string; captain_b: string; value: number }[];
  return rows.map((r) => ({
    captainId: (r.captain_a === captainId ? r.captain_b : r.captain_a) as CaptainId,
    value: r.value,
  }));
}

/**
 * Apply a ruled delta, clamped to the cap. With `encounterDay`
 * set, the add is a Station encounter: at most one encounter delta
 * per pair per local day lands (R7's per-pair daily cap), tracked
 * on the row itself.
 */
export function addAffinity(
  h: DbHandle,
  spaceId: string,
  a: CaptainId,
  b: CaptainId,
  delta: number,
  nowMs: number,
  opts: { encounterDay?: string } = {},
): number {
  if (a === b || delta === 0) return getAffinity(h, spaceId, a, b);
  const [x, y] = pair(a, b);
  const existing = h.sqlite
    .prepare(`SELECT value, last_encounter_day FROM npc_affinity WHERE space_id = ? AND captain_a = ? AND captain_b = ?`)
    .get(spaceId, x, y) as { value: number; last_encounter_day: string | null } | undefined;
  if (opts.encounterDay && existing?.last_encounter_day === opts.encounterDay) {
    return existing.value;
  }
  const next = Math.max(-CAPTAIN_AFFINITY_CAP, Math.min(CAPTAIN_AFFINITY_CAP, (existing?.value ?? 0) + delta));
  h.sqlite
    .prepare(
      `INSERT INTO npc_affinity (space_id, captain_a, captain_b, value, last_encounter_day, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_id, captain_a, captain_b) DO UPDATE SET
         value = excluded.value,
         last_encounter_day = COALESCE(excluded.last_encounter_day, npc_affinity.last_encounter_day),
         updated_at = excluded.updated_at`,
    )
    .run(spaceId, x, y, next, opts.encounterDay ?? null, new Date(nowMs).toISOString());
  return next;
}

/** Cooling (R7): move every pair involving this captain toward
 *  zero by the ruled rate × elapsed local days — never past zero.
 *  Runs as an explicit step at her local-day rollover inside the
 *  advance; no timers. */
export function coolAffinities(h: DbHandle, spaceId: string, captainId: CaptainId, elapsedDays: number, nowMs: number): void {
  if (elapsedDays <= 0) return;
  const amount = CAPTAIN_AFFINITY_COOLING_PER_DAY * elapsedDays;
  const rows = h.sqlite
    .prepare(`SELECT captain_a, captain_b, value FROM npc_affinity WHERE space_id = ? AND (captain_a = ? OR captain_b = ?)`)
    .all(spaceId, captainId, captainId) as { captain_a: string; captain_b: string; value: number }[];
  for (const r of rows) {
    if (r.value === 0) continue;
    const next = r.value > 0 ? Math.max(0, r.value - amount) : Math.min(0, r.value + amount);
    if (next === r.value) continue;
    h.sqlite
      .prepare(`UPDATE npc_affinity SET value = ?, updated_at = ? WHERE space_id = ? AND captain_a = ? AND captain_b = ?`)
      .run(next, new Date(nowMs).toISOString(), spaceId, r.captain_a, r.captain_b);
  }
}

/**
 * The premium-taken event (R7): `sellerId` just consumed the last
 * NPC premium units of (buyer, good). Another captain's affinity
 * toward the seller moves by the ruled delta ONLY where her
 * targeting of that (buyer, good) is evidenced — by her stored
 * plan steps or her C14 knowledge — never assumed. Returns the
 * captains an event landed for.
 */
export function recordPremiumTaken(
  h: DbHandle,
  spaceId: string,
  sellerId: CaptainId,
  buyerId: string,
  good: string,
  nowMs: number,
): CaptainId[] {
  const buyer = buyerNameOf(buyerId);
  const goodLabel = goodLabelOf(good);
  const store = new PurposeStore(h, spaceId);
  const landed: CaptainId[] = [];
  for (const def of allCaptainDefs()) {
    if (def.id === sellerId || !def.active) continue;
    const other = def.id as CaptainId;
    let evidenced = false;
    // Her knowledge: a claim naming this buyer and this good.
    for (const k of store.knowledgeOf(other)) {
      if (k.supersededBy !== null) continue;
      const claim = k.claim.toLowerCase();
      if (claim.includes(buyer.toLowerCase()) && claim.includes(goodLabel.toLowerCase())) {
        evidenced = true;
        break;
      }
    }
    // Her stored plans: a step whose label or params name the pair.
    if (!evidenced) {
      const plans = h.sqlite
        .prepare(
          `SELECT ps.label, ps.params FROM npc_plan_steps ps
             JOIN npc_plans p ON p.id = ps.plan_id
            WHERE ps.space_id = ? AND ps.npc_id = ? AND p.state = 'active' AND ps.state = 'open'`,
        )
        .all(spaceId, other) as { label: string; params: string }[];
      for (const s of plans) {
        const text = `${s.label} ${s.params}`.toLowerCase();
        if (text.includes(buyer.toLowerCase()) && text.includes(goodLabel.toLowerCase())) {
          evidenced = true;
          break;
        }
      }
    }
    if (evidenced) {
      addAffinity(h, spaceId, other, sellerId, CAPTAIN_AFFINITY_PREMIUM_TAKEN, nowMs);
      landed.push(other);
    }
  }
  return landed;
}

function allCaptainDefs() {
  return ["dain", "veyra", "bex", "junia", "hollis", "sorrel", "yara", "felix"]
    .map((id) => captainDefinition(id))
    .filter((d): d is NonNullable<typeof d> => !!d);
}

function buyerNameOf(buyerId: string): string {
  switch (buyerId) {
    case "station-exchange": return "Exchange";
    case "station-foundry": return "Foundry";
    case "salvage-yard": return "Salvage Yard";
    case "archive-broker": return "Archive Broker";
    case "fleet-quartermaster": return "Quartermaster";
    default: return buyerId;
  }
}

function goodLabelOf(good: string): string {
  switch (good) {
    case "ore": return "Ore";
    case "salvage": return "Salvage";
    case "data": return "Data";
    case "component": return "Component";
    case "circuit": return "Circuit";
    default: return good;
  }
}

/** Her opinion of another captain, in plain words, for the
 *  "tell me about [captain]" answer — labelled as her opinion,
 *  grounded in the stored value, nothing invented. */
export function affinityLabel(value: number): string {
  if (value >= 6) return "a captain I hold in real regard";
  if (value >= 2) return "a captain I'm warm toward";
  if (value > 0) return "a captain I think a little well of";
  if (value === 0) return "a captain I hold no strong feeling about either way";
  if (value > -2) return "a captain who's cost me a little, market-wise";
  if (value > -6) return "a captain whose market habits have stung me more than once";
  return "a captain whose market habits I keep a weather eye on";
}
