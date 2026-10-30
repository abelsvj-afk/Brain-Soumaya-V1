import type { Fuel, TravelKind } from "@brain/shared";
import type { DbHandle } from "./db/client.js";
import { buffsForSpace } from "./relics/buffs.js";
import { DEFAULT_SPACE } from "./db/schema.js";

/**
 * Relics I-6 (§4.7, §9 ruling 1): the exchange's Credits option reads
 * its price from ONE place — a posted value. No posted value exists:
 * there is no Credits ledger anywhere in the app and the G0 D-07
 * value decisions have not priced a Legacy, so this seam reports
 * "not offered" for every relic and no caller can invent a number.
 * When a real posted value exists, this is where it lands
 * (offered: true, value: the posted amount), and the exchange is
 * where it would be paid.
 */
export type PostedExchangeValue = { offered: false } | { offered: true; value: number };
export function postedExchangeValue(_relicId: string): PostedExchangeValue {
  return { offered: false };
}

/**
 * The "Celestial Economy": Fuel is a free, in-app energy that powers Soumaya's
 * autonomous work. You EARN it by tending the galaxy (adding memories, forging
 * links, clearing action items) and she SPENDS it on autonomous LLM jobs — on
 * top of the real USD budget, which remains the hard cap. At zero fuel she idles
 * on free upkeep only. Fully space-scoped (each brain has its own fuel).
 */
/**
 * The numbers now live in `@brain/shared` so the web app can label a cost/reward
 * (e.g. "up to 2 ⛽", the Agenda's "+fuel" tooltip) without restating them as
 * literals that silently go stale when these are retuned. Re-exported here so every
 * existing server import site keeps working unchanged.
 *
 * Meanings, for reference: FUEL_CAP is a roomy tank so earnings can be banked rather
 * than hitting the ceiling. EARN_MEMORY is the main income and should feel rewarding.
 * FUEL_REGEN_PER_HOUR is a slow passive trickle (≈2.5 days empty→full) so Soumaya keeps
 * working even for an idle brain — at 6/hr regen alone overfilled the tank in under a
 * day and earning stopped meaning anything; the real USD budget is still the hard cap.
 */
export {
  FUEL_START,
  FUEL_CAP,
  FUEL_JOB_COST,
  EARN_MEMORY,
  EARN_LINK,
  EARN_ACTION_DONE,
  EARN_MIND,
  EARN_THOUGHT,
  EARN_CODEX_DISCOVERY,
  EARN_REVIEW,
  WARP_COST,
  EARN_JOURNEY_COMPLETE,
  EARN_JOURNEY_DRIFT,
  FUEL_REGEN_PER_HOUR,
  ACTION_DONE_MIN_AGE_MINUTES,
  LOW_FUEL_THRESHOLD,
  EARN_THOUGHT_DAILY_CAP,
  EARN_MIND_DAILY_CAP,
} from "@brain/shared";
import {
  FUEL_START,
  FUEL_CAP,
  FUEL_JOB_COST,
  FUEL_REGEN_PER_HOUR,
  WARP_COST,
  ACTION_DONE_MIN_AGE_MINUTES,
} from "@brain/shared";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export class EconomyRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  /** Lazily create this brain's fuel row at the starting balance. */
  private ensure(): void {
    this.h.sqlite
      .prepare(`INSERT OR IGNORE INTO space_meta (space_id, fuel) VALUES (?, ?)`)
      .run(this.spaceId, FUEL_START);
  }

  /**
   * Lazily credit passive regen based on time elapsed since the last update.
   * Computed on read (no background timer). Only persists once a meaningful chunk
   * (≥0.1) has accrued, so `updated_at` isn't thrashed and fractions never get
   * rounded away between frequent reads.
   */
  private applyRegen(): void {
    const row = this.h.sqlite
      .prepare(`SELECT fuel, updated_at FROM space_meta WHERE space_id = ?`)
      .get(this.spaceId) as { fuel: number; updated_at: string } | undefined;
    const buffs = buffsForSpace(this.h, this.spaceId); const cap = buffs.fuelCap;
    if (!row || row.fuel >= cap) return; // already full — nothing to accrue
    const ts = row.updated_at;
    const ms = Date.parse(ts?.includes("T") ? ts : `${(ts ?? "").replace(" ", "T")}Z`);
    if (Number.isNaN(ms)) return;
    const hours = (Date.now() - ms) / 3_600_000;
    if (hours <= 0) return;
    const regen = hours * buffs.fuelRegenPerHour;
    if (regen < 0.1) return; // wait for a meaningful chunk; updated_at stays so it keeps accruing
    const next = clamp(row.fuel + regen, 0, cap);
    this.h.sqlite
      .prepare(`UPDATE space_meta SET fuel = ?, updated_at = CURRENT_TIMESTAMP WHERE space_id = ?`)
      .run(next, this.spaceId);
  }

  get(): number {
    this.ensure();
    this.applyRegen();
    const row = this.h.sqlite
      .prepare(`SELECT fuel FROM space_meta WHERE space_id = ?`)
      .get(this.spaceId) as { fuel: number } | undefined;
    return row?.fuel ?? FUEL_START;
  }

  /** Credit fuel (saturates at the cap). Returns the new balance. */
  add(amount: number): number {
    if (!(amount > 0)) return this.get();
    this.ensure();
    const next = clamp(this.get() + amount, 0, buffsForSpace(this.h, this.spaceId).fuelCap);
    this.h.sqlite
      .prepare(`UPDATE space_meta SET fuel = ?, updated_at = CURRENT_TIMESTAMP WHERE space_id = ?`)
      .run(next, this.spaceId);
    return next;
  }

  /** Spend fuel if affordable. Returns true if the debit happened. */
  spend(amount: number): boolean {
    this.ensure();
    const cur = this.get();
    if (cur < amount) return false;
    this.h.sqlite
      .prepare(`UPDATE space_meta SET fuel = ?, updated_at = CURRENT_TIMESTAMP WHERE space_id = ?`)
      .run(cur - amount, this.spaceId);
    return true;
  }

  /** True if there's enough fuel for one autonomous LLM job. */
  canRunJob(): boolean {
    return this.get() >= FUEL_JOB_COST;
  }

  /**
   * Charge one warp (Worlds travel, Phase 2). Same refusal semantics as
   * spend(): no partial debit, never below zero. The travel layer calls this
   * only when the server closes a departure's cancel window — a cancelled
   * departure is never charged.
   */
  spendWarp(): boolean {
    return this.spend(WARP_COST);
  }

  /** True if the balance covers one warp. */
  canWarp(): boolean {
    return this.get() >= WARP_COST;
  }

  toFuel(): Fuel {
    return { fuel: Math.round(this.get() * 10) / 10, capacity: buffsForSpace(this.h, this.spaceId).fuelCap, jobCost: FUEL_JOB_COST, warpCost: WARP_COST };
  }
}

/** Parse a stored timestamp the way the review scheduler does: a naive
 *  "YYYY-MM-DD HH:MM:SS" (SQLite) value is UTC; ISO values parse as-is. */
export function parseStoredMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const s = ts.includes("T") ? ts : ts.replace(" ", "T");
  const z = s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const t = Date.parse(z);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * REG-141 (AG-02): the action-completion age gate, as true elapsed-time math.
 * The old gate was a SQL string comparison (`created_at <= datetime('now',
 * '-10 minutes')`) between an ISO timestamp and SQLite's space-separated
 * output — at byte 10 `T` (0x54) > ` ` (0x20), so every same-UTC-date
 * comparison failed and the predicate reduced to "created on an earlier UTC
 * calendar date". This is the same rule the Agenda client already states
 * (`earnsFuel()` in ActionsPanel): an action earns once it has existed
 * ACTION_DONE_MIN_AGE_MINUTES, on both sides of UTC midnight.
 */
export function actionEarnsFuel(createdAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const createdMs = parseStoredMs(createdAt);
  if (!createdMs) return false;
  return nowMs - createdMs >= ACTION_DONE_MIN_AGE_MINUTES * 60_000;
}

/**
 * REG-051 (PG-08): server-enforced per-day earn bound. `daily_earn_counts`
 * records how many paid earns of one kind a space has taken on one
 * space-local day; the count survives dismiss/delete (the rows themselves
 * don't), which is exactly why a live-row count can't bound these paths.
 * Returns true when this call is within the cap (count incremented); false
 * once the cap is reached (count untouched, no fuel paid). The day is the
 * SPACE-local day, like the streak — never a UTC day.
 */
export function claimDailyEarn(
  h: DbHandle,
  spaceId: string,
  day: string,
  kind: "thought" | "mind",
  cap: number,
): boolean {
  const run = h.sqlite.transaction(() => {
    const row = h.sqlite
      .prepare(`SELECT count FROM daily_earn_counts WHERE space_id = ? AND day = ? AND kind = ?`)
      .get(spaceId, day, kind) as { count: number } | undefined;
    if ((row?.count ?? 0) >= cap) return false;
    h.sqlite
      .prepare(
        `INSERT INTO daily_earn_counts (space_id, day, kind, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(space_id, day, kind) DO UPDATE SET count = count + 1`,
      )
      .run(spaceId, day, kind);
    return true;
  });
  return run();
}

/**
 * Journey-bonus crediting contract (Worlds Phase 2 — DEFINED in P2-1,
 * IMPLEMENTED in P2-4: TravelRepo satisfies this interface, crediting
 * inside the P2-2 arrival transaction and recording the outcome on the
 * journey row). Crediting is server-side, at arrival, exactly once per
 * journey: `journeyId` is the idempotency key, so a retried arrival returns
 * the original outcome instead of paying twice (reward honesty).
 */
/** The travel-kind vocabulary lives in `@brain/shared` (one definition,
 *  shared with the P2-2 travel ledger); this alias keeps the bonus
 *  contract's original spelling. A travel journey's id is what
 *  `creditJourneyBonus` will receive as its `journeyId`. */
export type JourneyKind = TravelKind;

export interface JourneyBonusResult {
  /** True when this call is the one that credited the bonus. */
  credited: boolean;
  /** The bonus amount for the journey kind (0 when not credited). */
  amount: number;
  /** The balance after the credit (or the current balance when not credited). */
  balance: number;
}

export interface JourneyBonusCreditor {
  creditJourneyBonus(journeyId: string, kind: JourneyKind): JourneyBonusResult;
}
