import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { localDayInZone } from "../lib/time.js";

/**
 * Calendar parts of an instant in the SPACE's timezone (owner rule
 * 2026-10-21: weekday / day-of-month / month patterns describe the user's
 * own lived calendar, never the UTC calendar — a memory logged Monday
 * evening in Florida is a Monday memory, even though its stored timestamp
 * already reads Tuesday in UTC). The local date string is anchored at UTC
 * noon so weekday derivation can never shift a day.
 */
function localParts(ms: number, tz: string): { dom: number; weekday: number; monthKey: string; weekKey: string } {
  const day = localDayInZone(ms, tz); // YYYY-MM-DD in the space's zone
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const anchored = new Date(`${day}T12:00:00Z`);
  const week = Math.floor((d + 6) / 7) + (m - 1) * 5; // coarse week bucket, as before
  return {
    dom: d,
    weekday: anchored.getUTCDay(),
    monthKey: `${y}-${m - 1}`,
    weekKey: `${y}-${week}`,
  };
}

/**
 * Foresight (Level 2, B3) — the step from DESCRIBING the past to CALLING the next
 * occurrence before it lands. Emotional-weather already charts mood over time;
 * this looks for RECURRING negative windows (a rough month-end, a heavy Monday)
 * and, if the next instance is imminent, surfaces a gentle heads-up.
 *
 * Fully deterministic (no LLM): pure date arithmetic over the user's own
 * negative-weighted memories. Conservative — needs the pattern to repeat across
 * ≥2 distinct months / ≥3 distinct weeks before it will speak.
 */

export interface Foresight {
  text: string;
  /** How soon the predicted window opens, in days (0 = today). */
  inDays: number;
  kind: "monthly" | "weekday";
}

interface DatedMem {
  dom: number; // day of month 1..31
  weekday: number; // 0 Sun .. 6 Sat
  monthKey: string; // YYYY-MM
  weekKey: string; // ISO-ish year-week
}

const parseTs = (raw: string): number =>
  Date.parse(raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z");

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Detect the strongest recurring-negative pattern that's about to recur, or null. */
export function detectForesight(h: DbHandle, spaceId: string = DEFAULT_SPACE): Foresight | null {
  const rows = h.sqlite
    .prepare(
      `SELECT COALESCE(occurred_at, created_at) AS ts FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL
         AND (kind IS NULL OR kind NOT IN ('action','moc','belief'))
         AND emotional_weight <= -0.3
         AND COALESCE(occurred_at, created_at) >= datetime('now','-120 days')`,
    )
    .all(spaceId) as { ts: string }[];
  if (rows.length < 4) return null;

  const tz = spaceTimezone(h.sqlite, spaceId);
  const mems: DatedMem[] = [];
  for (const r of rows) {
    const ms = parseTs(r.ts);
    if (Number.isNaN(ms)) continue;
    mems.push(localParts(ms, tz));
  }

  const now = new Date();
  const nowParts = localParts(now.getTime(), tz);
  const todayDom = nowParts.dom;
  const [nowY, nowM] = nowParts.monthKey.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(nowY, nowM + 1, 0)).getUTCDate();

  // --- Monthly window: negatives clustering in the same ±3-day day-of-month band
  // across ≥2 distinct months. ---
  // Bucket by rounded day-of-month band (early / mid / late thirds is too coarse;
  // use a sliding ±3 around each candidate center at 5,15,25 and month-end).
  const centers = [5, 15, 25, daysInMonth];
  for (const center of centers) {
    const inBand = mems.filter((m) => Math.abs(m.dom - center) <= 3);
    const months = new Set(inBand.map((m) => m.monthKey));
    if (inBand.length >= 3 && months.size >= 2) {
      // How many days until this band opens next (band opens at center-3)?
      const bandStart = Math.max(1, center - 3);
      let inDays = bandStart - todayDom;
      if (inDays < -3) inDays += daysInMonth; // already past → next month
      if (inDays <= 5 && inDays >= -3) {
        const whenText =
          center >= daysInMonth - 1
            ? "month-end"
            : center <= 6
              ? "the start of the month"
              : `around the ${center}th`;
        return {
          text: `Heads up: the last ${months.size} months ran heavy ${whenText}, and it's coming up again. Want to get ahead of it?`,
          inDays: Math.max(0, inDays),
          kind: "monthly",
        };
      }
    }
  }

  // --- Weekday window: negatives on the same weekday across ≥3 distinct weeks. ---
  const byWeekday = new Map<number, Set<string>>();
  for (const m of mems) {
    if (!byWeekday.has(m.weekday)) byWeekday.set(m.weekday, new Set());
    byWeekday.get(m.weekday)!.add(m.weekKey);
  }
  let worst: { weekday: number; weeks: number } | null = null;
  for (const [weekday, weeks] of byWeekday) {
    if (weeks.size >= 3 && (!worst || weeks.size > worst.weeks)) {
      worst = { weekday, weeks: weeks.size };
    }
  }
  if (worst) {
    const todayW = nowParts.weekday;
    let inDays = (worst.weekday - todayW + 7) % 7;
    if (inDays <= 2) {
      return {
        text: `${WEEKDAYS[worst.weekday]}s have been landing hard for you lately (${worst.weeks} weeks running). ${inDays === 0 ? "That's today" : "It's coming up"} — worth a gentle plan.`,
        inDays,
        kind: "weekday",
      };
    }
  }

  return null;
}
