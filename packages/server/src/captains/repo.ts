import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { localDateKey } from "../npcs/repo.js";
import {
  CAPTAIN_START_CREDITS,
  CAPTAIN_START_FUEL,
  type CaptainBark,
  type CaptainDefinition,
  type CaptainId,
  type CaptainLegKind,
  type CaptainMemoryEntry,
  type CaptainMemoryKind,
  type CaptainWorld,
  type ChronicleLine,
  type NpcActKind,
} from "@brain/shared";

/**
 * Captain persistence (NPC-Player Layer L1): the state row, the
 * captain's OWN memory stream, and its stored bark lines. The acts
 * themselves live in the shared append-only npc_log (NpcRepo) — one
 * log for the whole framework, so the Chronicle can read harbor and
 * captain acts in one query.
 *
 * Everything here is space-scoped: another space's captain rows are
 * invisible, and brain deletion removes them (SPACE_SCOPED_TABLES).
 * Counts are per space-local day — never a UTC boundary.
 *
 * P1 adds, in the same space-scoped row (no new table — spec §1
 * F04/F23, so erasure completeness is unchanged in shape):
 *  - the home anchor (kind + label), written ONCE at row creation
 *    from the definition and carried byte-identical through every
 *    whole-row patch forever after (write-once — A8-1);
 *  - the open leg's fields, all set together at departure or all
 *    null together at arrival (spec §5.1). `legTo` is only ever
 *    written by the engine's departure transaction, copied from a
 *    held plan — that rule is A7 made structural.
 */

export interface CaptainStateRow {
  captainId: CaptainId;
  homeWorld: CaptainWorld;
  /** The stored home anchor (write-once from the definition). */
  homeAnchorKind: CaptainDefinition["homeAnchor"]["kind"];
  homeAnchorLabel: string;
  currentWorld: CaptainWorld | null;
  sessionKey: string | null;
  sessionWorld: CaptainWorld | null;
  sessionStartedAt: string | null;
  sessionEndsAt: string | null;
  lastMeetingVisitKey: string | null;
  lastGreetVisitKey: string | null;
  fuel: number;
  credits: number;
  stopped: boolean;
  lastAdvancedAt: string | null;
  /** The open leg (all fields set together or all null together). */
  legFrom: CaptainWorld | null;
  legTo: CaptainWorld | null;
  legKind: CaptainLegKind | null;
  /** Advance-step start instants (epoch ms) of departure/arrival. */
  legDepartedStepMs: number | null;
  legArrivesStepMs: number | null;
  /** Advance steps the leg takes (its pace, fixed at creation). */
  legSteps: number | null;
  /** The session this leg is travelling to (sessionKey of the
   *  planned visit at the destination), when the leg was opened
   *  from a day plan; null for decider legs. */
  legVisitKey: string | null;
}

interface StateDbRow {
  home_world: string;
  home_anchor_kind: string;
  home_anchor_label: string;
  current_world: string | null;
  session_key: string | null;
  session_world: string | null;
  session_started_at: string | null;
  session_ends_at: string | null;
  last_meeting_visit_key: string | null;
  last_greet_visit_key: string | null;
  fuel: number;
  credits: number;
  stopped: number;
  last_advanced_at: string | null;
  leg_from: string | null;
  leg_to: string | null;
  leg_kind: string | null;
  leg_departed_step: string | null;
  leg_arrives_step: string | null;
  leg_steps: number | null;
  leg_visit_key: string | null;
}

function toRow(captainId: CaptainId, r: StateDbRow): CaptainStateRow {
  return {
    captainId,
    homeWorld: r.home_world as CaptainWorld,
    homeAnchorKind: r.home_anchor_kind as CaptainStateRow["homeAnchorKind"],
    homeAnchorLabel: r.home_anchor_label,
    currentWorld: (r.current_world as CaptainWorld | null) ?? null,
    sessionKey: r.session_key,
    sessionWorld: (r.session_world as CaptainWorld | null) ?? null,
    sessionStartedAt: r.session_started_at,
    sessionEndsAt: r.session_ends_at,
    lastMeetingVisitKey: r.last_meeting_visit_key,
    lastGreetVisitKey: r.last_greet_visit_key,
    fuel: r.fuel,
    credits: r.credits,
    stopped: r.stopped === 1,
    lastAdvancedAt: r.last_advanced_at,
    legFrom: (r.leg_from as CaptainWorld | null) ?? null,
    legTo: (r.leg_to as CaptainWorld | null) ?? null,
    legKind: (r.leg_kind as CaptainLegKind | null) ?? null,
    legDepartedStepMs: r.leg_departed_step ? Date.parse(r.leg_departed_step) : null,
    legArrivesStepMs: r.leg_arrives_step ? Date.parse(r.leg_arrives_step) : null,
    legSteps: r.leg_steps,
    legVisitKey: r.leg_visit_key,
  };
}

const STATE_COLUMNS = `home_world, home_anchor_kind, home_anchor_label, current_world, session_key,
  session_world, session_started_at, session_ends_at, last_meeting_visit_key,
  last_greet_visit_key, fuel, credits, stopped, last_advanced_at,
  leg_from, leg_to, leg_kind, leg_departed_step, leg_arrives_step, leg_steps, leg_visit_key`;

const CAPTAIN_SPEAK_KINDS: readonly NpcActKind[] = ["speak", "greet"] as const;

export class CaptainRepo {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
  ) {}

  // --- state ---

  state(captainId: CaptainId): CaptainStateRow | null {
    const row = this.h.sqlite
      .prepare(
        `SELECT ${STATE_COLUMNS}
         FROM npc_player_state WHERE space_id = ? AND npc_id = ?`,
      )
      .get(this.spaceId, captainId) as StateDbRow | undefined;
    return row ? toRow(captainId, row) : null;
  }

  /** Create the state row on first touch: at home in fiction, away
   *  from the public worlds in fact, cursor at now — a captain's life
   *  starts when someone first looks, and its past is not backfilled.
   *  The anchor is written here, once, from the definition — the
   *  residence fence (spec §4): a row's home is its definition's
   *  anchor world, never a caller's say-so. */
  ensureState(def: CaptainDefinition, nowMs: number): CaptainStateRow {
    const existing = this.state(def.id);
    if (existing) return existing;
    this.h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO npc_player_state
           (npc_id, space_id, home_world, home_anchor_kind, home_anchor_label, fuel, credits, last_advanced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        def.id,
        this.spaceId,
        def.homeWorld,
        def.homeAnchor.kind,
        def.homeAnchor.label,
        CAPTAIN_START_FUEL,
        CAPTAIN_START_CREDITS,
        new Date(nowMs).toISOString(),
      );
    const created = this.state(def.id);
    if (!created) throw new Error(`Captain state for ${def.id} did not persist.`);
    return created;
  }

  private patch(captainId: CaptainId, fields: Partial<CaptainStateRow>): void {
    const cur = this.state(captainId);
    if (!cur) throw new Error(`No captain state row for ${captainId} to patch.`);
    const next = { ...cur, ...fields };
    // The anchor is write-once (A8-1): no patch may move it. The
    // merge above starts from the stored row, and the anchor fields
    // are forced back to the stored values here, so even a caller
    // that passes different anchor fields cannot move home.
    next.homeAnchorKind = cur.homeAnchorKind;
    next.homeAnchorLabel = cur.homeAnchorLabel;
    next.homeWorld = cur.homeWorld;
    this.h.sqlite
      .prepare(
        `UPDATE npc_player_state SET
           home_world = ?, home_anchor_kind = ?, home_anchor_label = ?,
           current_world = ?, session_key = ?, session_world = ?,
           session_started_at = ?, session_ends_at = ?, last_meeting_visit_key = ?,
           last_greet_visit_key = ?, fuel = ?, credits = ?, stopped = ?, last_advanced_at = ?,
           leg_from = ?, leg_to = ?, leg_kind = ?, leg_departed_step = ?, leg_arrives_step = ?,
           leg_steps = ?, leg_visit_key = ?
         WHERE space_id = ? AND npc_id = ?`,
      )
      .run(
        next.homeWorld,
        next.homeAnchorKind,
        next.homeAnchorLabel,
        next.currentWorld,
        next.sessionKey,
        next.sessionWorld,
        next.sessionStartedAt,
        next.sessionEndsAt,
        next.lastMeetingVisitKey,
        next.lastGreetVisitKey,
        next.fuel,
        next.credits,
        next.stopped ? 1 : 0,
        next.lastAdvancedAt,
        next.legFrom,
        next.legTo,
        next.legKind,
        next.legDepartedStepMs !== null ? new Date(next.legDepartedStepMs).toISOString() : null,
        next.legArrivesStepMs !== null ? new Date(next.legArrivesStepMs).toISOString() : null,
        next.legSteps,
        next.legVisitKey,
        this.spaceId,
        captainId,
      );
  }

  /** Apply a state patch atomically from the caller's perspective. */
  update(captainId: CaptainId, fields: Partial<CaptainStateRow>): void {
    this.patch(captainId, fields);
  }

  setStopped(captainId: CaptainId, stopped: boolean): void {
    this.patch(captainId, { stopped });
  }

  setCursor(captainId: CaptainId, nowMs: number): void {
    this.patch(captainId, { lastAdvancedAt: new Date(nowMs).toISOString() });
  }

  // --- memory stream (the captain's own; design §6) ---

  addMemory(
    captainId: CaptainId,
    kind: CaptainMemoryKind,
    text: string,
    importance: number,
    tags: string[],
    nowMs: number = Date.now(),
  ): CaptainMemoryEntry {
    const createdAt = new Date(nowMs).toISOString();
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_player_memory (npc_id, space_id, kind, text, importance, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(captainId, this.spaceId, kind, text, importance, JSON.stringify(tags), createdAt);
    return {
      id: Number(res.lastInsertRowid),
      captainId,
      kind,
      text,
      importance,
      tags,
      createdAt,
    };
  }

  memory(captainId: CaptainId, kind?: CaptainMemoryKind, limit = 500): CaptainMemoryEntry[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, kind, text, importance, tags, created_at FROM npc_player_memory
         WHERE space_id = ? AND npc_id = ?${kind ? " AND kind = ?" : ""} ORDER BY id ASC LIMIT ?`,
      )
      .all(this.spaceId, captainId, ...(kind ? [kind] : []), limit) as {
      id: number;
      kind: string;
      text: string;
      importance: number;
      tags: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      captainId,
      kind: r.kind as CaptainMemoryKind,
      text: r.text,
      importance: r.importance,
      tags: JSON.parse(r.tags) as string[],
      createdAt: r.created_at,
    }));
  }

  /** Meetings she remembers, oldest first (the "have we met" truth). */
  meetings(captainId: CaptainId): CaptainMemoryEntry[] {
    return this.memory(captainId, "meeting");
  }

  /** The owner wipe (design §6.5): her memory of meeting YOU is
   *  erasable, and the erasure is total — rows gone, markers gone,
   *  so the next meeting is honestly a first meeting. */
  wipeMeetings(captainId: CaptainId): void {
    this.h.sqlite
      .prepare(`DELETE FROM npc_player_memory WHERE space_id = ? AND npc_id = ? AND kind = 'meeting'`)
      .run(this.spaceId, captainId);
    this.patch(captainId, { lastMeetingVisitKey: null, lastGreetVisitKey: null });
  }

  // --- barks (design §13: stored lines, source-transparent) ---

  addBark(
    captainId: CaptainId,
    dayKey: string,
    context: CaptainBark["context"],
    text: string,
    basedOn: number[],
    nowMs: number = Date.now(),
  ): CaptainBark {
    const createdAt = new Date(nowMs).toISOString();
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_player_barks (npc_id, space_id, day_key, context, text, source, based_on, created_at)
         VALUES (?, ?, ?, ?, ?, 'template', ?, ?)`,
      )
      .run(captainId, this.spaceId, dayKey, context, text, JSON.stringify(basedOn), createdAt);
    return {
      id: Number(res.lastInsertRowid),
      captainId,
      dayKey,
      context,
      text,
      source: "template",
      basedOn,
      createdAt,
    };
  }

  barksForDay(captainId: CaptainId, dayKey: string, limit = 10): CaptainBark[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, day_key, context, text, based_on, created_at FROM npc_player_barks
         WHERE space_id = ? AND npc_id = ? AND day_key = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(this.spaceId, captainId, dayKey, limit) as {
      id: number;
      day_key: string;
      context: string;
      text: string;
      based_on: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      captainId,
      dayKey: r.day_key,
      context: r.context as CaptainBark["context"],
      text: r.text,
      source: "template" as const,
      basedOn: JSON.parse(r.based_on) as number[],
      createdAt: r.created_at,
    }));
  }

  hasBarkForDay(captainId: CaptainId, dayKey: string, context: CaptainBark["context"]): boolean {
    const row = this.h.sqlite
      .prepare(
        `SELECT 1 AS x FROM npc_player_barks WHERE space_id = ? AND npc_id = ? AND day_key = ? AND context = ? LIMIT 1`,
      )
      .get(this.spaceId, captainId, dayKey, context) as { x: number } | undefined;
    return !!row;
  }

  // --- budget counts over the shared log (per space-local day) ---

  private countKindsOnDay(captainId: CaptainId, nowMs: number, kinds: readonly NpcActKind[] | null): number {
    const tz = spaceTimezone(this.h.sqlite, this.spaceId);
    const today = localDateKey(tz, nowMs);
    const rows = this.h.sqlite
      .prepare(`SELECT kind, created_at FROM npc_log WHERE space_id = ? AND npc_id = ?`)
      .all(this.spaceId, captainId) as { kind: string; created_at: string }[];
    return rows.filter(
      (r) =>
        localDateKey(tz, Date.parse(r.created_at)) === today &&
        (kinds === null || kinds.includes(r.kind as NpcActKind)),
    ).length;
  }

  actsToday(captainId: CaptainId, nowMs: number = Date.now()): number {
    return this.countKindsOnDay(captainId, nowMs, null);
  }

  speaksToday(captainId: CaptainId, nowMs: number = Date.now()): number {
    return this.countKindsOnDay(captainId, nowMs, CAPTAIN_SPEAK_KINDS);
  }

  // --- the Chronicle read model (design §8.1) ---

  /** The newest log lines across the given NPCs, newest first —
   *  pure read; the Chronicle writes nothing of its own. */
  chronicle(npcIds: readonly string[], names: ReadonlyMap<string, string>, limit = 30): ChronicleLine[] {
    if (npcIds.length === 0) return [];
    const placeholders = npcIds.map(() => "?").join(", ");
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, npc_id, kind, act, cause, created_at FROM npc_log
         WHERE space_id = ? AND npc_id IN (${placeholders}) ORDER BY id DESC LIMIT ?`,
      )
      .all(this.spaceId, ...npcIds, limit) as {
      id: number;
      npc_id: string;
      kind: string;
      act: string;
      cause: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      npcId: r.npc_id as ChronicleLine["npcId"],
      npcName: names.get(r.npc_id) ?? r.npc_id,
      kind: r.kind as NpcActKind,
      line: r.act,
      cause: r.cause,
      createdAt: r.created_at,
    }));
  }
}
