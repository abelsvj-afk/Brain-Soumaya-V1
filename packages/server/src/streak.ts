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

  /** Shift a YYYY-MM-DD day string by whole days (anchored at UTC noon, DST-proof). */
  private shiftDay(day: string, offsetDays: number): string {
    const anchor = new Date(`${day}T12:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
    return anchor.toISOString().slice(0, 10);
  }

  /** The day-tracking table (IM-64) — additive; created here too so a bare handle works. */
  private ensureDaysTable(): void {
    this.h.sqlite.exec(
      `CREATE TABLE IF NOT EXISTS streak_days (
         space_id TEXT NOT NULL,
         day TEXT NOT NULL,
         PRIMARY KEY (space_id, day)
       )`,
    );
  }

  /** Record that this space was tended on `day` (IM-64 day history). Idempotent. */
  private recordDay(day: string): void {
    this.ensureDaysTable();
    this.h.sqlite
      .prepare(`INSERT OR IGNORE INTO streak_days (space_id, day) VALUES (?, ?)`)
      .run(this.spaceId, day);
  }

  private recordedDays(): Set<string> {
    this.ensureDaysTable();
    const rows = this.h.sqlite
      .prepare(`SELECT day FROM streak_days WHERE space_id = ?`)
      .all(this.spaceId) as { day: string }[];
    return new Set(rows.map((r) => r.day));
  }

  /**
   * Per-day tending history for the last `days` space-local days, oldest first (IM-64).
   * Honesty rules — a day is only asserted `false` (not tended) when that is knowable:
   *  - `true`: recorded by touch() in streak_days, OR the stored last_active_date, OR
   *    inside the current streak's span ending at last_active_date (every day in that
   *    span counted toward the streak; the one nuance is a shield-forgiven gap day
   *    inside a PRE-tracking span, which counted toward the streak without a tend —
   *    it reads as tended, bounded to at most one day and only for legacy spans).
   *  - `false`: today (known from last_active_date) or any day on/after the first
   *    recorded day with no record — every tend since tracking began is recorded,
   *    so absence is a fact there.
   *  - `null`: before the recorded era and not derivable — "no record", never
   *    presented as a missed day.
   */
  history(days = 14): { date: string; tended: boolean | null }[] {
    const r = this.row();
    const today = this.dayStr();
    const recorded = this.recordedDays();
    const knownStart = recorded.size > 0 ? [...recorded].sort()[0]! : null;
    // Span of the current (still-alive) streak ending at last_active_date.
    const s = this.getBase(r);
    const span = new Set<string>();
    if (s.current > 0 && r.last_active_date) {
      for (let i = 0; i < s.current; i++) span.add(this.shiftDay(r.last_active_date, -i));
    }
    const out: { date: string; tended: boolean | null }[] = [];
    for (let back = days - 1; back >= 0; back--) {
      const date = this.shiftDay(today, -back);
      let tended: boolean | null;
      if (recorded.has(date) || span.has(date) || date === r.last_active_date) {
        tended = true;
      } else if (date === today) {
        tended = false; // today is always knowable: last_active_date !== today here
      } else if (knownStart !== null && date >= knownStart) {
        tended = false;
      } else {
        tended = null;
      }
      out.push({ date, tended });
    }
    return out;
  }

  /** The pre-IM-64 streak fields, factored so get()/history() share one computation. */
  private getBase(r: MetaRow): { current: number; best: number; today: boolean; shields: number } {
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
   * Effective current streak: alive if tended today or yesterday — OR if exactly one
   * day was missed and a nebula shield is banked to forgive it (the shield is consumed
   * on the next tend, in `touch`). Older gaps lapse to 0.
   */
  get(): Streak {
    const r = this.row();
    return {
      ...this.getBase(r),
      lastActiveDate: r.last_active_date,
      history: this.history(),
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
      this.recordDay(today); // IM-64: keep the day record complete even for repeats
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
    this.recordDay(today); // IM-64
    return { streak: this.get(), advanced: true, shieldUsed };
  }
}
