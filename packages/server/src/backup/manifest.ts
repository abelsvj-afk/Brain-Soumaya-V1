/**
 * G0 backup — manifest shape, the bucketed live-object assertion, and
 * standalone snapshot verification (G0 spec §1, §4; B0 v1.1 amendments
 * A and C).
 *
 * Verification tiers kept distinct (amendment C): (1) manifest
 * reconciliation — identities + row counts; (2) structural integrity —
 * SQLite integrity_check + foreign_key_check. Tier 3 (critical-record
 * reconciliation) belongs to the restore drill (B4), not to B1.
 */
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { RawDb } from "../db/vec.js";
import {
  BACKUP_INVENTORY_VERSION,
  BACKUP_TABLE_INVENTORY,
  INCLUDED_TABLES,
  MUST_BE_NONEMPTY_TABLES,
} from "./inventory.js";

export interface BackupManifest {
  backupId: string;
  /** ISO-Z creation time (stored in UTC; display localization is B3). */
  createdAt: string;
  appCommit: string;
  /** PRAGMA user_version of the source database at snapshot time. */
  schemaVersion: number;
  inventoryVersion: number;
  snapshotBytes: number;
  snapshotSha256: string;
  /** Row counts for every INCLUDED inventory table (never the excluded cache). */
  tableCounts: Record<string, number>;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

// ── Bucketed live-object assertion (B0 v1.1 amendment A) ──────────────

export interface LiveObjectClassification {
  included: string[];
  excluded: string[];
  /** FTS5 / sqlite-vec shadow objects, accounted for via their parent virtual table. */
  shadows: string[];
  /** SQLite-internal objects (sqlite_*), allowed by explicit rule. */
  internal: string[];
  /** Application-owned objects in NO bucket — the backup must fail loudly. */
  unrecognized: string[];
}

interface MasterRow {
  name: string;
  type: string;
  sql: string | null;
}

/**
 * Classify every table/view in the live database into exactly one bucket.
 * NEVER a raw sqlite_master diff: shadow objects belong to their parent
 * virtual tables, and sqlite_* internals are allowed by rule. Anything
 * else unrecognized is returned in `unrecognized` for the caller to fail
 * on — fail-closed is the point of the assertion.
 */
export function classifyLiveObjects(sqlite: RawDb): LiveObjectClassification {
  const rows = sqlite
    .prepare(`SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view')`)
    .all() as MasterRow[];
  const virtualParents = rows
    .filter((r) => (r.sql ?? "").toUpperCase().startsWith("CREATE VIRTUAL TABLE"))
    .map((r) => r.name);
  const out: LiveObjectClassification = {
    included: [],
    excluded: [],
    shadows: [],
    internal: [],
    unrecognized: [],
  };
  for (const row of rows) {
    const cls = BACKUP_TABLE_INVENTORY[row.name];
    if (row.name.startsWith("sqlite_")) {
      out.internal.push(row.name);
    } else if (cls === "must-be-nonempty" || cls === "may-be-empty") {
      out.included.push(row.name);
    } else if (cls === "excluded") {
      out.excluded.push(row.name);
    } else if (virtualParents.some((p) => isShadowOf(row.name, p))) {
      out.shadows.push(row.name);
    } else {
      out.unrecognized.push(row.name);
    }
  }
  return out;
}

/**
 * Shadow objects of a virtual table are a FINITE, enumerable set — the
 * bucket must match that set exactly, never a bare name prefix. A prefix
 * rule would silently bucket any future application table named
 * `<virtual-parent>_*` (e.g. a `vec_nodes_v2` rebuild table) as a shadow
 * and defeat the fail-closed point of this assertion (review P1, found
 * empirically with `sources_fts_rogue` / `vec_nodes_archive`).
 * FTS5 shadows: _data, _idx, _content, _docsize, _config.
 * vec0 shadows: _info, _chunks, _rowids, _vector_chunks<digits>.
 * (Enumerated against a fresh brain: 41 shadow objects, all in this set.)
 */
const SHADOW_SUFFIXES: ReadonlySet<string> = new Set([
  "_data",
  "_idx",
  "_content",
  "_docsize",
  "_config",
  "_info",
  "_chunks",
  "_rowids",
]);

function isShadowOf(name: string, parent: string): boolean {
  if (!name.startsWith(`${parent}_`)) return false;
  const suffix = name.slice(parent.length);
  return SHADOW_SUFFIXES.has(suffix) || /^_vector_chunks\d+$/.test(suffix);
}

// ── Counting ──────────────────────────────────────────────────────────

/**
 * Row counts for every included inventory table. A listed table missing
 * from the database is schema drift and throws (fail loudly), naming it.
 */
export function countIncludedTables(sqlite: RawDb): Record<string, number> {
  const present = new Set(
    (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`).all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const counts: Record<string, number> = {};
  for (const table of INCLUDED_TABLES) {
    if (!present.has(table)) {
      throw new Error(`inventory table missing from database: ${table}`);
    }
    const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
    counts[table] = row.n;
  }
  return counts;
}

// ── Standalone snapshot verification (spec §4, tiers 1 + 2) ───────────

export interface SnapshotVerification {
  ok: boolean;
  failures: string[];
  /** PRAGMA integrity_check result ("ok" when clean). */
  integrity: string;
  foreignKeyViolations: number;
  countsChecked: number;
}

export interface VerifyOptions {
  /**
   * Enforce the MUST-BE-NONEMPTY wiped-DB guard. Defaults to true; the
   * all-29 production preflight (amendment B) gates enforcement in
   * production, so callers there pass the preflight outcome explicitly.
   */
  enforceMustNonempty?: boolean;
}

function openSnapshot(path: string): RawDb {
  const sqlite = new BetterSqlite3(path, { readonly: true });
  try {
    // vec0 tables cannot even be COUNTed without the extension loaded.
    sqliteVec.load(sqlite);
  } catch {
    // If the extension cannot load, counts for vec_* tables fail below
    // and are reported as verification failures, not hidden.
  }
  return sqlite as RawDb;
}

export function verifySnapshotFile(
  snapshotPath: string,
  manifest: BackupManifest,
  opts: VerifyOptions = {},
): SnapshotVerification {
  const enforceMust = opts.enforceMustNonempty ?? true;
  const failures: string[] = [];
  let integrity = "unavailable";
  let foreignKeyViolations = 0;
  let countsChecked = 0;
  const done = (): SnapshotVerification => ({
    ok: failures.length === 0,
    failures,
    integrity,
    foreignKeyViolations,
    countsChecked,
  });
  // Verification NEVER throws (review P2-1): a missing or corrupt file is
  // a failed verification with the reason recorded, not an exception —
  // B4's flipped-byte corruption cases (G0-AC-06) call this function on
  // deliberately damaged files, where a header-page flip surfaces as an
  // open/pragma throw rather than an integrity_check row.
  // Tier 1a: the file on disk is the file the manifest describes.
  try {
    const actualSha = sha256File(snapshotPath);
    if (actualSha !== manifest.snapshotSha256) {
      failures.push(
        `snapshot SHA-256 mismatch: manifest ${manifest.snapshotSha256}, file ${actualSha}`,
      );
    }
    const actualBytes = fs.statSync(snapshotPath).size;
    if (actualBytes !== manifest.snapshotBytes) {
      failures.push(`snapshot byte size mismatch: manifest ${manifest.snapshotBytes}, file ${actualBytes}`);
    }
  } catch (err) {
    failures.push(`snapshot file unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return done();
  }
  let sqlite: RawDb;
  try {
    sqlite = openSnapshot(snapshotPath);
  } catch (err) {
    failures.push(`snapshot cannot be opened: ${err instanceof Error ? err.message : String(err)}`);
    return done();
  }
  try {
    // Tier 2: structural integrity.
    const integrityRow = sqlite.pragma("integrity_check", { simple: true });
    integrity = typeof integrityRow === "string" ? integrityRow : String(integrityRow);
    if (integrity !== "ok") {
      failures.push(`integrity_check failed: ${integrity}`);
    }
    const fkRows = sqlite.pragma("foreign_key_check") as unknown[];
    foreignKeyViolations = fkRows.length;
    if (foreignKeyViolations > 0) {
      failures.push(`foreign_key_check found ${foreignKeyViolations} violation(s)`);
    }
    // Tier 1b: counts reconcile with the manifest.
    let counts: Record<string, number> | null = null;
    try {
      counts = countIncludedTables(sqlite);
    } catch (err) {
      failures.push(`count failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (counts) {
      for (const table of INCLUDED_TABLES) {
        countsChecked++;
        if (counts[table] !== manifest.tableCounts[table]) {
          failures.push(
            `count mismatch for ${table}: manifest ${manifest.tableCounts[table]}, snapshot ${counts[table]}`,
          );
        }
      }
      // Wiped-DB guard (G0-AC-04): a MUST table at zero means the
      // snapshot is of a wiped/corrupt database, never a MAY table.
      if (enforceMust) {
        for (const table of MUST_BE_NONEMPTY_TABLES) {
          if (counts[table] === 0) {
            failures.push(`must-be-nonempty table is empty in snapshot: ${table}`);
          }
        }
      }
    }
  } catch (err) {
    failures.push(`verification error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    sqlite.close();
  }
  return done();
}

export function newManifest(args: {
  backupId: string;
  createdAt: string;
  appCommit: string;
  schemaVersion: number;
  snapshotPath: string;
  tableCounts: Record<string, number>;
}): BackupManifest {
  return {
    backupId: args.backupId,
    createdAt: args.createdAt,
    appCommit: args.appCommit,
    schemaVersion: args.schemaVersion,
    inventoryVersion: BACKUP_INVENTORY_VERSION,
    snapshotBytes: fs.statSync(args.snapshotPath).size,
    snapshotSha256: sha256File(args.snapshotPath),
    tableCounts: args.tableCounts,
  };
}
