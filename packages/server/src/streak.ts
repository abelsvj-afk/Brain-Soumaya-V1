import type { Streak } from "@brain/shared";
import type { DbHandle } from "./db/client.js";
import { DEFAULT_SPACE } from "./db/schema.js";
import { getPreferences, localDay, DEFAULT_PREFS } from "./agent/notify/policy.js";

/**
 * Daily-tending streak: how many consecutive days a brain has been fed a memory.
 * Stored in `space_meta` alongside fuel (one row per brain). Server-authoritative
 * so the count is consistent across devices. A small fuel bonus is awarded the
 * first time each day to reward showing up (the caller credits it via EconomyRepo).
 * Fully space-scoped; offline-safe (pure SQLite, no LLM).
 */

/** Flat fuel bonus the first time a brain is tended on a new day. */
export const STREAK_DAY_BONUS = 2;

/**
 * The SPACE's local calendar date (YYYY-MM-DD) for `instant`, optionally offset
 * by whole days — owner decision 2026-10-20: streak days are space-local, no
 * UTC exemption (date/time accuracy audit gap #9). The timezone comes from the
 * same source quiet hours and the digest use (space_meta.timezone via the
 * notify layer's getPreferences). Offsets shift the local calendar date itself
 * (anchored at UTC noon), so a DST transition can never make "yesterday"
 * repeat or skip.
 *
 * SEAM: `last_active_date` values stored before this change were UTC days.
 * They are interpreted as-is against local days — never rewritten. On the
 * changeover day, an evening user's stored UTC date can read as their local
 * today or tomorrow, a one-time artifact bounded to a single day (documented
 * in the date/time fixes record).
 */
function spaceDayStr(sqlite: DbHandle["sqlite"], spaceId: string, instant: Date, offsetDays = 0): string {
  let tz = DEFAULT_PREFS.timezone;
  try {
    tz = getPreferences(sqlite, spaceId).timezone;
  } catch {
    // space_meta unreachable (bare test DB) — the shared default applies,
    // mirroring spaceLocalDate()'s defensive read in agent/episodic.ts.
  }
  const today = localDay(instant, tz);
  if (offsetDays === 0) return today;
  const anchor = new Date(`${today}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  return anchor.toISOString().slice(0, 10);
}

interface MetaRow {
  streak: number;
  streak_best: number;
  last_active_date: string | null;
  streak_shields: number;
}

/** Most "nebula shields" a brain can bank at once. */
const SHIELD_CAP = 2;

export class StreakRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  /** Lazily create this brain's meta row (shares the fuel row's defaults). */
  private ensure(): void {
    this.h.sqlite
      .prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`)
      .run(this.spaceId);
  }

  private row(): MetaRow {
    this.ensure();
    const r = this.h.sqlite
      .prepare(`SELECT streak, streak_best, last_active_date, streak_shields FROM space_meta WHERE space_id = ?`)
      .get(this.spaceId) as MetaRow | undefined;
    return r ?? { streak: 0, streak_best: 0, last_active_date: null, streak_shields: SHIELD_CAP };
  }

  /** This space's local day string (see spaceDayStr), optionally offset. */
  private dayStr(offsetDays = 0): string {
    return spaceDayStr(this.h.sqlite, this.spaceId, new Date(), offsetDays);
  }

  /**
   * Effective current streak: alive if tended today or yesterday — OR if exactly one
   * day was missed and a nebula shield is banked to forgive it (the shield is consumed
   * on the next tend, in `touch`). Older gaps lapse to 0.
   */
  get(): Streak {
    const r = this.row();
    const today = this.dayStr();
    const shields = r.streak_shields ?? SHIELD_CAP;
    const protectedByShield = r.last_active_date === this.dayStr(-2) && shields > 0;
    const alive = r.last_active_date === today || r.last_active_date === this.dayStr(-1) || protectedByShield;
    return {
      current: alive ? r.streak : 0,
      best: r.streak_best ?? 0,
      today: r.last_active_date === today,
      shields,
    };
  }

  /**
   * Record a tending today. Advances the streak on a new day (continuing if the last
   * active day was yesterday). If exactly one day was missed, a **nebula shield** bridges
   * the gap so the streak survives (consuming one shield) — a broken streak is data, not
   * punishment. Otherwise it restarts at 1. A shield is earned back each 7-day run
   * (capped). Same-day repeats are a no-op; `advanced` gates the once-a-day fuel bonus.
   */
  touch(): { streak: Streak; advanced: boolean; shieldUsed?: boolean } {
    const r = this.row();
    const today = this.dayStr();
    if (r.last_active_date === today) {
      return { streak: this.get(), advanced: false }; // already counted today
    }
    let shields = r.streak_shields ?? SHIELD_CAP;
    let shieldUsed = false;
    let current: number;
    if (r.last_active_date === this.dayStr(-1)) {
      current = r.streak + 1; // consecutive day
    } else if (r.last_active_date === this.dayStr(-2) && shields > 0) {
      current = r.streak + 1; // one missed day, forgiven by a shield
      shields -= 1;
      shieldUsed = true;
    } else {
      current = 1; // lapsed → fresh start
    }
    // Earn a shield back for every completed 7-day run (never above the cap).
    if (current > 0 && current % 7 === 0) shields = Math.min(SHIELD_CAP, shields + 1);
    const best = Math.max(r.streak_best ?? 0, current);
    this.h.sqlite
      .prepare(`UPDATE space_meta SET streak = ?, streak_best = ?, last_active_date = ?, streak_shields = ? WHERE space_id = ?`)
      .run(current, best, today, shields, this.spaceId);
    return { streak: { current, best, today: true, shields }, advanced: true, shieldUsed };
  }
}
