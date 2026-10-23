import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE, spaces, type SpaceRow } from "../db/schema.js";

/**
 * Lightweight per-brain auth: a space is opened by name + passcode and works
 * across devices (no email/accounts). Passcodes are salted + scrypt-hashed; the
 * space id itself is an unguessable 128-bit token the client stores as its key.
 */

export interface SpacePublic {
  id: string;
  name: string;
  gamerTag: string;
}

/**
 * A curated, user-facing validation error. SpacesRepo throws ONLY this
 * type for messages that are safe (and intended) to be shown to the user
 * verbatim — registration / profile / passcode / deletion validation.
 * Every other throw from these methods (SQLite "database is locked",
 * constraint / missing-table errors, runtime failures) is unexpected:
 * callers must log its raw detail server-side and answer with a sanitized
 * generic shape instead of surfacing `err.message`. This type is the
 * distinction the space routes and the Telegram /link handler branch on.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

// Every table carrying a space_id — the first account to register claims all
// pre-multi-tenancy rows still sitting under 'legacy'. Keep in sync when adding
// a space-scoped table, or the owner's data in it stays orphaned after claim.
const TABLES_WITH_SPACE = [
  "nodes",
  "edges",
  "insights",
  "agent_logs",
  "daily_logs",
  "lore",
  "attachments",
  "instruction_profiles",
  "knowledge_docs",
  "knowledge_chunks",
  "user_persona",
  "visitor_stats",
  "codex_claims",
  "space_meta",
  "lenses",
  "codex_discoveries",
  "fin_account",
  "fin_source",
  "fin_income",
  "fin_expense",
  "fin_bill",
  "fin_bill_occurrence",
  "fin_category_override",
  "fin_goal_link",
  "fin_bucket",
  "fin_goal",
  "fin_allocation",
  "fin_paystub",
  "fin_asset",
  "fin_asset_snapshot",
  "journeys",
  "journey_link",
  "journey_mission_completions",
  "intelligence_clarifications",
  "interaction_preferences",
  "sources",
  "source_chunks",
  "node_sources",
  "source_corrections",
] as const;

function hash(passcode: string, salt: string): Buffer {
  return scryptSync(passcode, salt, 64);
}

/** Timing-safe passcode check against a stored salted scrypt hash. The ONE
 *  verification path — login, passcode change, and brain deletion all go
 *  through here so there is no second, weaker scheme to drift. */
function verifyPasscode(row: SpaceRow, passcode: string): boolean {
  const attempt = hash(passcode, row.passcodeSalt);
  const stored = Buffer.from(row.passcodeHash, "hex");
  return attempt.length === stored.length && timingSafeEqual(attempt, stored);
}

/**
 * Minimum length for a NEW passcode (registration and passcode change alike).
 * Login keeps the older zod floor of 4 so accounts created under it are never
 * locked out — but no new secret is ever set below this bar.
 */
export const NEW_PASSCODE_MIN_LENGTH = 8;

/**
 * EVERY table carrying a `space_id` column (census of db/schemaSql.ts plus
 * `notification_outbox`, which is created by a migration in db/client.ts) —
 * brain deletion removes the space's rows from all of them. Ordered so the
 * tables holding REFERENCES to nodes/knowledge_docs (edges, insights,
 * attachments, knowledge_chunks) are emptied before the tables they point at,
 * since foreign_keys enforcement is ON for the live connection.
 * NOT listed (deliberately): `settings` and `access_stats` are global, not
 * per-space; `spaces` itself is deleted separately, last.
 */
export const SPACE_SCOPED_TABLES = [
  "edges",
  "insights",
  "attachments",
  "knowledge_chunks",
  "nodes",
  "corrections",
  "agent_logs",
  "tool_approvals",
  "daily_logs",
  "space_meta",
  "streak_days",
  "telegram_links",
  "telegram_note_drafts",
  "push_subscriptions",
  "push_outbox",
  "tts_audio_cache",
  "notification_cap_claims",
  "inbox_notifications",
  "lore",
  "instruction_profiles",
  "knowledge_docs",
  "codex_claims",
  "undertakings",
  "daily_contact",
  "user_persona",
  "visitor_stats",
  "working_memory",
  "inquiries",
  "link_rejections",
  "candidate_links",
  "dismissed_names",
  "timeline_chapters",
  "lenses",
  "codex_discoveries",
  "fin_account",
  "fin_source",
  "fin_income",
  "fin_expense",
  "fin_bill",
  "fin_bill_occurrence",
  "fin_category_override",
  "fin_goal_link",
  "fin_bucket",
  "fin_goal",
  "fin_allocation",
  "fin_paystub",
  "fin_asset",
  "fin_asset_snapshot",
  "journeys",
  "journey_link",
  "journey_mission_completions",
  "intelligence_clarifications",
  "interaction_preferences",
  "episodes",
  "episode_enrichments",
  "user_model",
  "forget_requests",
  "enrichment_quota",
  "consolidation_runs",
  "consolidation_episodes",
  "contradictions",
  "w3_recon_progress",
  "w3_recon_semantic_queue",
  "notification_outbox",
  "travel_journey_events",
  "travel_journeys",
  "node_sources",
  "source_corrections",
  "source_chunks",
  "sources",
] as const;

/**
 * Derived indexes that key rows by ENTITY id rather than space_id, so a plain
 * `DELETE ... WHERE space_id` can never reach them: [index table, its key
 * column, the space-scoped entity table whose ids it mirrors]. Deletion
 * collects the space's entity ids first and removes exactly those index rows
 * — leaving them behind would keep the brain's text/vectors searchable in
 * spirit even after every relational row is gone.
 */
const DERIVED_INDEXES: ReadonlyArray<readonly [indexTable: string, keyColumn: string, entityTable: string]> = [
  ["vec_nodes", "node_id", "nodes"],
  ["nodes_fts", "rowid", "nodes"],
  ["vec_docs", "chunk_id", "knowledge_chunks"],
  ["vec_profiles", "profile_id", "instruction_profiles"],
  ["vec_journeys", "journey_id", "journeys"],
  ["vec_episodes", "episode_id", "episodes"],
  ["episodes_fts", "rowid", "episodes"],
  ["vec_source_chunks", "chunk_id", "source_chunks"],
  ["sources_fts", "rowid", "source_chunks"],
];

const toPublic = (row: SpaceRow): SpacePublic => ({ id: row.id, name: row.name, gamerTag: row.gamerTag });

export class SpacesRepo {
  constructor(private readonly h: DbHandle) {}

  getById(id: string): SpacePublic | undefined {
    const row = this.h.db.select().from(spaces).where(eq(spaces.id, id)).get();
    return row ? toPublic(row) : undefined;
  }

  getByGamerTag(gamerTag: string): SpaceRow | undefined {
    // Case-insensitive: "Alice" and "alice" are the same brain, so a different-case
    // login can't silently create a duplicate account (mobile autocapitalize, etc.).
    return this.h.db
      .select()
      .from(spaces)
      .where(sql`lower(${spaces.gamerTag}) = lower(${gamerTag})`)
      .get();
  }

  count(): number {
    const r = this.h.sqlite.prepare(`SELECT COUNT(*) AS c FROM spaces`).get() as { c: number };
    return r.c;
  }

  /**
   * Log in to an existing brain or create a new one. Returns the space (with its
   * secret id) on success, or null when the name exists but the passcode is wrong.
   *
   * The FIRST brain ever created on this deployment claims all pre-existing
   * ("legacy") data — that's how the owner keeps the memories that were already
   * in the database before multi-tenancy.
   */
  authOrCreate(gamerTag: string, passcode: string, name?: string): { space: SpacePublic; created: boolean } | null {
    const trimmedGamerTag = gamerTag.trim();
    const trimmedName = (name ?? gamerTag).trim();

    const existing = this.getByGamerTag(trimmedGamerTag);
    if (existing) {
      if (!verifyPasscode(existing, passcode)) return null;
      return { space: toPublic(existing), created: false };
    }

    const isFirst = this.count() === 0;

    // New registration validations:
    // The space id doubles as the account's bearer credential, and this route's zod
    // schema only floors passcode length at 4 (kept there so EXISTING accounts created
    // under that older floor can still log in — tightening it there would lock them out
    // with no recovery flow). A 4-character passcode is brute-forceable from a handful of
    // IPs even under the auth rate limit, so new accounts are held to a stronger floor
    // here, in the registration-only branch, without touching login for anyone already
    // holding a shorter one.
    if (passcode.length < NEW_PASSCODE_MIN_LENGTH) {
      throw new UserFacingError("Passcode must be at least 8 characters for a new brain.");
    }
    // Reject if gamerTag is case-insensitively "soumaya" (unless it is the first brain)
    if (!isFirst) {
      if (trimmedGamerTag.toLowerCase() === "soumaya") {
        throw new UserFacingError("The name/gamer tag 'Soumaya' is reserved.");
      }
      // Reject if name is case-insensitively "soumaya" (unless it is the first brain)
      if (trimmedName.toLowerCase() === "soumaya") {
        throw new UserFacingError("The name/gamer tag 'Soumaya' is reserved.");
      }
    }
    const id = randomBytes(16).toString("hex");
    const salt = randomBytes(16).toString("hex");
    const passcodeHash = hash(passcode, salt).toString("hex");
    const tx = this.h.sqlite.transaction(() => {
      this.h.db
        .insert(spaces)
        .values({ id, name: trimmedName, gamerTag: trimmedGamerTag, passcodeHash, passcodeSalt: salt })
        .run();
      if (isFirst) {
        for (const t of TABLES_WITH_SPACE) {
          // OR IGNORE: space_meta/user_persona/codex_claims key on space_id, so a
          // conflicting new-space row (shouldn't exist at creation, but cheap to
          // guard) must not abort the whole claim transaction.
          this.h.sqlite
            .prepare(`UPDATE OR IGNORE ${t} SET space_id = ? WHERE space_id = ?`)
            .run(id, DEFAULT_SPACE);
        }
      } else {
        // New tenants start with Research Mode explicitly OFF. The NULL→global
        // fallback exists for pre-migration brains; without this row, a fresh
        // space would inherit whatever the legacy owner set (fail-open to paid
        // autonomous work if that was "true").
        this.h.sqlite
          .prepare(`INSERT OR IGNORE INTO space_meta (space_id, research_enabled) VALUES (?, 'false')`)
          .run(id);
      }
    });
    tx();
    return { space: { id, name: trimmedName, gamerTag: trimmedGamerTag }, created: true };
  }

  /**
   * Update a brain's display name and/or gamer tag. Gamer tag must stay UNIQUE
   * (case-insensitive) and isn't the reserved "Soumaya"; name can be anything.
   * Throws a user-facing message on conflict/validation.
   */
  updateProfile(id: string, opts: { gamerTag?: string; name?: string }): SpacePublic {
    const cur = this.h.db.select().from(spaces).where(eq(spaces.id, id)).get();
    if (!cur) throw new UserFacingError("No such brain.");
    const next: { gamerTag?: string; name?: string } = {};

    if (opts.gamerTag !== undefined) {
      const tag = opts.gamerTag.trim();
      if (tag.length < 2 || tag.length > 40) throw new UserFacingError("Gamer tag must be 2–40 characters.");
      if (tag.toLowerCase() === "soumaya") throw new UserFacingError("The gamer tag 'Soumaya' is reserved.");
      const taken = this.getByGamerTag(tag);
      if (taken && taken.id !== id) throw new UserFacingError("That gamer tag is already taken — pick another.");
      next.gamerTag = tag;
    }
    if (opts.name !== undefined) {
      const nm = opts.name.trim();
      if (nm.length < 1 || nm.length > 40) throw new UserFacingError("Name must be 1–40 characters.");
      next.name = nm;
    }
    if (Object.keys(next).length === 0) return toPublic(cur);

    this.h.db.update(spaces).set(next).where(eq(spaces.id, id)).run();
    return toPublic({ ...cur, ...next });
  }

  /**
   * Change a brain's passcode. The caller is already authenticated by the
   * space id (requireSpace), but the id alone is NOT enough to rotate the
   * secret: the CURRENT passcode must verify against the stored hash first.
   * Returns false when the space is gone or the current passcode is wrong
   * (nothing changes in either case); throws a user-facing message when the
   * new passcode fails the same validation registration enforces.
   *
   * NOTE — credential-model residual: the space id is the bearer credential
   * and deliberately does NOT change here, so anyone already holding the id
   * (the owner's other devices) keeps working. Rotating the id would strand
   * those clients with no migration path; passcode change protects the LOGIN
   * path (gamerTag + passcode), not a leaked id. See the IM-129 design note.
   */
  changePasscode(id: string, currentPasscode: string, newPasscode: string): boolean {
    const row = this.h.db.select().from(spaces).where(eq(spaces.id, id)).get();
    if (!row) return false;
    if (!verifyPasscode(row, currentPasscode)) return false;
    if (newPasscode.length < NEW_PASSCODE_MIN_LENGTH) {
      throw new UserFacingError(`New passcode must be at least ${NEW_PASSCODE_MIN_LENGTH} characters.`);
    }
    if (newPasscode.length > 100) {
      throw new UserFacingError("New passcode must be at most 100 characters.");
    }
    const salt = randomBytes(16).toString("hex");
    const passcodeHash = hash(newPasscode, salt).toString("hex");
    this.h.db.update(spaces).set({ passcodeHash, passcodeSalt: salt }).where(eq(spaces.id, id)).run();
    return true;
  }

  /**
   * Permanently delete a brain and ALL of its data. Two independent proofs
   * are required before anything is touched:
   *   1. the passcode, verified against the stored hash (returns false when
   *      wrong — the route maps that to 401, same as a bad login), and
   *   2. `confirmation` exactly equal to the space's gamerTag. The tag is
   *      space-specific (a fixed phrase like "DELETE" proves nothing about
   *      WHICH brain is being destroyed and is typeable by rote), and the
   *      comparison is exact and case-sensitive — "type what you are about
   *      to lose" must be deliberate. A mismatch throws with NOTHING deleted.
   * On success every row is removed inside ONE transaction — every
   * space-scoped table (SPACE_SCOPED_TABLES), the derived vec/FTS index rows
   * keyed by the space's entity ids, and finally the `spaces` row itself —
   * so a failure mid-delete rolls the whole thing back and the brain
   * survives intact rather than half-erased.
   */
  deleteSpace(id: string, passcode: string, confirmation: string): boolean {
    const row = this.h.db.select().from(spaces).where(eq(spaces.id, id)).get();
    if (!row) return false;
    if (!verifyPasscode(row, passcode)) return false;
    if (confirmation !== row.gamerTag) {
      throw new UserFacingError("Confirmation does not match this brain's gamer tag — nothing was deleted.");
    }

    const sqlite = this.h.sqlite;
    const tableExists = sqlite.prepare(
      `SELECT 1 AS x FROM sqlite_master WHERE name = ?`,
    );
    const tx = sqlite.transaction(() => {
      // Derived indexes first, while the entity rows still exist to select
      // the space's ids from.
      for (const [indexTable, keyColumn, entityTable] of DERIVED_INDEXES) {
        if (!tableExists.get(indexTable)) continue;
        const ids = sqlite
          .prepare(`SELECT id FROM ${entityTable} WHERE space_id = ?`)
          .all(id) as Array<{ id: number }>;
        const del = sqlite.prepare(`DELETE FROM ${indexTable} WHERE ${keyColumn} = ?`);
        // vec0 tables bind their integer PK as BigInt (see db/vec.ts
        // deleteEmbedding); FTS5 rowids take plain numbers.
        const isVec = indexTable.startsWith("vec_");
        for (const { id: entityId } of ids) del.run(isVec ? BigInt(entityId) : entityId);
      }
      for (const t of SPACE_SCOPED_TABLES) {
        if (t === "agent_logs") {
          // agent_logs is guarded by an append-only BEFORE DELETE trigger
          // (db/client.ts) — it exists to stop the AGENT LOOP from rewriting
          // its own audit trail, not to stop the owner from destroying their
          // own brain. The audit rows belong to this space and must die with
          // it, so: lift the trigger for exactly this delete by re-reading
          // its definition from sqlite_master and restoring it verbatim
          // before commit. SQLite DDL is transactional, so a failed deletion
          // rolls the DROP back too — the trigger can never be left missing.
          const trig = sqlite
            .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_logs_no_delete'`)
            .get() as { sql: string } | undefined;
          if (trig) {
            sqlite.exec(`DROP TRIGGER agent_logs_no_delete`);
            sqlite.prepare(`DELETE FROM agent_logs WHERE space_id = ?`).run(id);
            sqlite.exec(trig.sql);
            continue;
          }
        }
        sqlite.prepare(`DELETE FROM ${t} WHERE space_id = ?`).run(id);
      }
      sqlite.prepare(`DELETE FROM spaces WHERE id = ?`).run(id);
    });
    tx();
    return true;
  }
}
