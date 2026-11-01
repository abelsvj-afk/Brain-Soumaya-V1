/**
 * G0 backup — restore reconciliation, tier 3 + ledgers (increment B4;
 * B0 v1.1 amendment C, completeness-read item K4).
 *
 * Amendment C names three reconciliation tiers and forbids letting
 * one substitute for another. B1/B2's verification covers tier 1
 * (manifest counts) and tier 2 (structural integrity) — see
 * `verifySnapshotFile`. This module is tier 3:
 *
 * - CRITICAL-RECORD IDENTITY: for the identity-sensitive record
 *   classes that exist at drill time — travel history, relic
 *   holdings, notification dedup/delivery state, finance history,
 *   economy balances — the restored database must contain the same
 *   RECORDS, not merely the same counts ("two different sets of 25
 *   discovery records have identical counts and completely different
 *   truth"). Each table gets a content digest over a canonical
 *   serialization of every row; digests are compared between the
 *   verified staged snapshot and the installed database.
 *
 * - LEDGER RECONCILIATION (K4): values the app DERIVES or stores as
 *   balances are recomputed from the restored records themselves —
 *   the current world derived from the travel ledger (the same rule
 *   TravelRepo applies: latest journey by created_at/rowid; arrived
 *   → its destination, anything else → its origin, none → "home"),
 *   per-space fuel balances, per-space finance totals — plus the
 *   travel event-chain consistency check (a journey's state must
 *   have its supporting append-only event). Computed on the staged
 *   snapshot and again on the installed database; the restore report
 *   compares the two summaries line by line.
 *
 * Everything here is READ-ONLY: the ledger derivation deliberately
 * does NOT call TravelRepo.currentWorld, which settles active
 * journeys lazily (a write). Reconciliation must never mutate the
 * database it is checking.
 */
import { createHash } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { RawDb } from "../db/vec.js";

/**
 * The amendment-C identity-sensitive classes that exist at drill
 * time. (G2's first-discovery records join this set via the K3
 * inventory extension when G2 lands.) Every entry must be an
 * INCLUDED inventory table — a test pins that, so this list can
 * never drift outside what backups actually record counts for.
 * FTS/vec shadow-bearing tables are deliberately absent: their
 * content is derived index data (tier 1 counts + the vec/FTS parent
 * rows in the memory core cover the records themselves), and their
 * internal row layout is an implementation detail of the index.
 */
export const CRITICAL_RECORD_TABLES: readonly string[] = [
  // Travel history + the travel ledger (amendment C: travel history).
  "travel_journeys",
  "travel_journey_events",
  // Economy balances (space_meta carries each space's fuel balance).
  "space_meta",
  // Relic holdings (amendment C: relic holdings).
  "npc_relic_holdings",
  // Game progress records.
  "codex_discoveries",
  "codex_claims",
  // Notification dedup + delivery state (amendment C: dedup state —
  // these are what stop a restored brain re-sending old notices).
  "notification_outbox",
  "notification_outbox_deliveries",
  "notification_cap_claims",
  "push_outbox",
  "inbox_notifications",
  // Finance history (amendment C: finance history).
  "fin_account",
  "fin_source",
  "fin_income",
  "fin_expense",
  "fin_bill",
  "fin_bill_occurrence",
  "fin_paystub",
  "fin_asset",
  "fin_asset_snapshot",
  "fin_allocation",
  "fin_bucket",
  "fin_category_override",
  "fin_goal",
  "fin_goal_link",
];

/** Read-only open of a snapshot/database file, vec extension loaded (mirrors manifest.ts). */
export function openSnapshotReadonly(path: string): RawDb {
  const sqlite = new BetterSqlite3(path, { readonly: true });
  try {
    sqliteVec.load(sqlite);
  } catch {
    // The critical-record tables are plain rowid tables; a vec load
    // failure must not mask their digests. (verifySnapshotFile is
    // the check that surfaces extension trouble, via its counts.)
  }
  return sqlite as RawDb;
}

// ── Tier 3: critical-record identity digests ─────────────────────────

export interface TableRecordDigest {
  table: string;
  rowCount: number;
  /** SHA-256 over the sorted per-row digests + the row count. */
  digest: string;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Canonical serialization of one value. Type-tagged so that, say,
 * the string "1" and the number 1 can never collide, and a blob is
 * its bytes, not its stringification.
 */
function serializeValue(v: unknown): string {
  if (v === null || v === undefined) return "N";
  if (typeof v === "number") return `#${v}`;
  if (typeof v === "bigint") return `#${v.toString()}`;
  if (typeof v === "string") return `S${JSON.stringify(v)}`;
  if (Buffer.isBuffer(v)) return `B${v.toString("base64")}`;
  return `S${JSON.stringify(String(v))}`;
}

/**
 * Digest one table's records. Rows are read in rowid order and the
 * per-row digests are SORTED before hashing, so the table digest is
 * a property of the record SET — two databases holding the same
 * records digest identically even if their rowids were assigned in a
 * different order, and two same-count different-record sets (the
 * amendment-C case) digest differently.
 */
export function digestTableRecords(sqlite: RawDb, table: string): TableRecordDigest {
  const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  if (cols.length === 0) {
    throw new Error(`critical-record table missing from database: ${table}`);
  }
  const names = cols.map((c) => c.name);
  const rows = sqlite
    .prepare(`SELECT ${names.map((n) => `"${n}"`).join(", ")} FROM "${table}" ORDER BY rowid`)
    .raw(true)
    .all() as unknown[][];
  const rowDigests = rows.map((row) =>
    sha256Hex(names.map((n, i) => `${n}=${serializeValue(row[i])}`).join("")),
  );
  rowDigests.sort();
  return {
    table,
    rowCount: rows.length,
    digest: sha256Hex(`${rows.length}\n${rowDigests.join("\n")}`),
  };
}

/** Digests for every critical-record table, in CRITICAL_RECORD_TABLES order. */
export function digestCriticalRecords(sqlite: RawDb): TableRecordDigest[] {
  return CRITICAL_RECORD_TABLES.map((t) => digestTableRecords(sqlite, t));
}

// ── K4: ledger reconciliation ────────────────────────────────────────

export interface TravelLedgerLine {
  spaceId: string;
  /** Derived current world (TravelRepo's rule, read-only mirror). */
  currentWorld: string;
  journeys: number;
  events: number;
  fuelCharged: number;
  bonusPaid: number;
}

export interface FuelLedgerLine {
  spaceId: string;
  fuel: number;
}

export interface FinanceLedgerLine {
  spaceId: string;
  incomeCount: number;
  incomeNetCents: number;
  expenseCount: number;
  expenseCents: number;
}

export interface LedgerSummary {
  travel: TravelLedgerLine[];
  fuel: FuelLedgerLine[];
  finance: FinanceLedgerLine[];
  /** Travel event-chain inconsistencies, in plain words. */
  eventChainViolations: string[];
}

/** The event a journey's state must be supported by (travel.repo lifecycle). */
const REQUIRED_EVENT_BY_STATE: Readonly<Record<string, string>> = {
  arming: "departure_armed",
  in_transit: "departed",
  returning: "turned_back",
  arrived: "arrived",
  returned: "returned",
  cancelled: "cancelled",
};

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function summarizeLedgers(sqlite: RawDb): LedgerSummary {
  // Travel: one line per space that has journeys. The derivation
  // mirrors TravelRepo.latestRow + deriveWorld exactly (latest by
  // created_at DESC, rowid DESC; arrived → destination, else
  // origin; no journeys → the space has no line here at all).
  const travel: TravelLedgerLine[] = [];
  const violations: string[] = [];
  const journeySpaces = sqlite
    .prepare(`SELECT DISTINCT space_id FROM travel_journeys ORDER BY space_id`)
    .all() as { space_id: string }[];
  for (const { space_id } of journeySpaces) {
    const latest = sqlite
      .prepare(
        `SELECT state, origin, destination FROM travel_journeys
         WHERE space_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(space_id) as { state: string; origin: string; destination: string };
    const sums = sqlite
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(fuel_charged), 0) AS charged,
                COALESCE(SUM(bonus_amount), 0) AS bonus FROM travel_journeys WHERE space_id = ?`,
      )
      .get(space_id) as { n: number; charged: number; bonus: number };
    const eventCount = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM travel_journey_events WHERE space_id = ?`)
      .get(space_id) as { n: number };
    travel.push({
      spaceId: space_id,
      currentWorld: latest.state === "arrived" ? latest.destination : latest.origin,
      journeys: sums.n,
      events: eventCount.n,
      fuelCharged: round6(sums.charged),
      bonusPaid: round6(sums.bonus),
    });
    // Event-chain consistency: every journey's state needs its
    // supporting append-only event; a journey with no events at all
    // is a broken chain whatever its state.
    const journeys = sqlite
      .prepare(`SELECT id, state FROM travel_journeys WHERE space_id = ? ORDER BY id`)
      .all(space_id) as { id: string; state: string }[];
    for (const j of journeys) {
      const types = (
        sqlite
          .prepare(`SELECT type FROM travel_journey_events WHERE journey_id = ?`)
          .all(j.id) as { type: string }[]
      ).map((r) => r.type);
      if (types.length === 0) {
        violations.push(`journey ${j.id} (space ${space_id}) has no events — its state "${j.state}" is unsupported`);
        continue;
      }
      const required = REQUIRED_EVENT_BY_STATE[j.state];
      if (required && !types.includes(required)) {
        violations.push(
          `journey ${j.id} (space ${space_id}) is "${j.state}" but has no "${required}" event`,
        );
      }
    }
  }

  const fuel = (
    sqlite.prepare(`SELECT space_id, fuel FROM space_meta ORDER BY space_id`).all() as {
      space_id: string;
      fuel: number;
    }[]
  ).map((r) => ({ spaceId: r.space_id, fuel: r.fuel }));

  const financeSpaces = sqlite
    .prepare(
      `SELECT space_id FROM fin_income UNION SELECT space_id FROM fin_expense ORDER BY space_id`,
    )
    .all() as { space_id: string }[];
  const finance: FinanceLedgerLine[] = financeSpaces.map(({ space_id }) => {
    const inc = sqlite
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(net_cents), 0) AS total FROM fin_income WHERE space_id = ?`,
      )
      .get(space_id) as { n: number; total: number };
    const exp = sqlite
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total FROM fin_expense WHERE space_id = ?`,
      )
      .get(space_id) as { n: number; total: number };
    return {
      spaceId: space_id,
      incomeCount: inc.n,
      incomeNetCents: inc.total,
      expenseCount: exp.n,
      expenseCents: exp.total,
    };
  });

  return { travel, fuel, finance, eventChainViolations: violations };
}

/** JSON with object keys sorted recursively — for deep summary comparison. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Two ledger summaries are equal when every derived line matches. */
export function ledgerSummariesEqual(a: LedgerSummary, b: LedgerSummary): boolean {
  return stableStringify(a) === stableStringify(b);
}
