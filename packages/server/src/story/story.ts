import type { DbHandle } from "../db/client.js";
import { STORY_ENTRY_BY_ID, storyPairIsLit, triggerFor, type TriggerHow } from "@brain/shared";
import { TravelRepo } from "../repositories/travel.repo.js";

/**
 * A brain's private progress through the story (docs/specs/lore-storage-2026-10-30.md). Content (what exists, how it connects) is shared code and is never stored here;
 * this holds ids only. There is no "missed", "locked" or total anywhere: absence of a row IS "not found yet", and nothing here can be lost.
 */

export const NOTE_MAX_CHARS = 2000;
/** How a find may be reported. Each is matched against the canon's trigger table (shared/storyTriggers.ts); all but `npc` must also match where the travel ledger puts the ship. */
const SOURCE_RE = /^(regard|listen|relic|companion|npc:[a-z-]{1,40})$/;

export class StoryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404,
  ) {
    super(message);
  }
}

export interface StoryFind {
  entryId: string;
  foundAt: string;
  source: string;
  lastRecalledAt: string | null;
  recallCount: number;
}
export interface StoryLinkRow {
  a: string;
  b: string;
  linkedAt: string;
  /** Derived from the canon at read time — true when the story itself joins the two. A wrong guess is kept privately and costs nothing. */
  lit: boolean;
}
export interface StoryNote {
  entryId: string;
  note: string;
  updatedAt: string;
}
/** Deliberately only lists: no totals, ratios or percentages are ever returned (the product rule — never a number). */
export interface StoryBook {
  finds: StoryFind[];
  links: StoryLinkRow[];
  notes: StoryNote[];
}

export class StoryRepo {
  constructor(
    private h: DbHandle,
    private spaceId: string,
  ) {}

  private requireEntry(entryId: string) {
    const entry = STORY_ENTRY_BY_ID.get(entryId);
    if (!entry || entry.retired) throw new StoryError("That is not something in the story.", 404);
    return entry;
  }

  private requireFound(entryId: string): void {
    this.requireEntry(entryId);
    const row = this.h.sqlite.prepare(`SELECT 1 AS x FROM story_finds WHERE space_id = ? AND entry_id = ?`).get(this.spaceId, entryId);
    if (!row) throw new StoryError("You have not found that yet.", 403);
  }

  book(): StoryBook {
    const db = this.h.sqlite;
    const finds = (
      db
        .prepare(`SELECT entry_id, found_at, source, last_recalled_at, recall_count FROM story_finds WHERE space_id = ? ORDER BY found_at, entry_id`)
        .all(this.spaceId) as { entry_id: string; found_at: string; source: string; last_recalled_at: string | null; recall_count: number }[]
    )
      .filter((r) => STORY_ENTRY_BY_ID.get(r.entry_id)?.retired !== true && STORY_ENTRY_BY_ID.has(r.entry_id)) // unknown/retired ids are ignored, never an error
      .map((r) => ({ entryId: r.entry_id, foundAt: r.found_at, source: r.source, lastRecalledAt: r.last_recalled_at, recallCount: r.recall_count }));
    const links = (db.prepare(`SELECT a, b, linked_at FROM story_links WHERE space_id = ? ORDER BY linked_at, a, b`).all(this.spaceId) as { a: string; b: string; linked_at: string }[]).map(
      (r) => ({ a: r.a, b: r.b, linkedAt: r.linked_at, lit: storyPairIsLit(r.a, r.b) }),
    );
    const notes = (db.prepare(`SELECT entry_id, note, updated_at FROM story_notes WHERE space_id = ? ORDER BY entry_id`).all(this.spaceId) as { entry_id: string; note: string; updated_at: string }[]).map(
      (r) => ({ entryId: r.entry_id, note: r.note, updatedAt: r.updated_at }),
    );
    return { finds, links, notes };
  }

  /**
   * Record a find. Idempotent (a replayed event changes nothing). The server is the only authority: the id must be real canon; the way it is being found must be one the
   * canon allows for that entry (a trigger); and, except for a met person's gift, the travel ledger must put the ship in the world the trigger names.
   */
  find(entryId: string, source: string, nowMs: number = Date.now()): { entryId: string; foundAt: string; isNew: boolean } {
    this.requireEntry(entryId);
    if (!SOURCE_RE.test(source)) throw new StoryError("Unknown source for a find.", 400);
    const npc = source.startsWith("npc:") ? source.slice(4) : undefined;
    const how: TriggerHow = (npc ? "npc" : source) as TriggerHow;
    const trigger = triggerFor(entryId, how, npc);
    if (!trigger) throw new StoryError("That cannot be found that way.", 403);
    if (how !== "npc" && new TravelRepo(this.h, this.spaceId).currentWorld(nowMs) !== trigger.world) throw new StoryError("You are not there.", 403);
    const db = this.h.sqlite;
    const iso = new Date(nowMs).toISOString();
    const res = db.prepare(`INSERT OR IGNORE INTO story_finds (space_id, entry_id, found_at, source) VALUES (?, ?, ?, ?)`).run(this.spaceId, entryId, iso, source);
    const row = db.prepare(`SELECT found_at FROM story_finds WHERE space_id = ? AND entry_id = ?`).get(this.spaceId, entryId) as { found_at: string };
    return { entryId, foundAt: row.found_at, isNew: res.changes > 0 };
  }

  /** A Concordance thread the player drew. Both ends must be things they have found; the pair is stored sorted, so a→b and b→a are one link. */
  link(a: string, b: string, nowMs: number = Date.now()): StoryLinkRow {
    if (a === b) throw new StoryError("A thing cannot be joined to itself.", 400);
    this.requireFound(a);
    this.requireFound(b);
    const [x, y] = a < b ? [a, b] : [b, a];
    this.h.sqlite.prepare(`INSERT OR IGNORE INTO story_links (space_id, a, b, linked_at) VALUES (?, ?, ?, ?)`).run(this.spaceId, x, y, new Date(nowMs).toISOString());
    const row = this.h.sqlite.prepare(`SELECT linked_at FROM story_links WHERE space_id = ? AND a = ? AND b = ?`).get(this.spaceId, x, y) as { linked_at: string };
    return { a: x, b: y, linkedAt: row.linked_at, lit: storyPairIsLit(x, y) };
  }

  unlink(a: string, b: string): void {
    const [x, y] = a < b ? [a, b] : [b, a];
    this.h.sqlite.prepare(`DELETE FROM story_links WHERE space_id = ? AND a = ? AND b = ?`).run(this.spaceId, x, y);
  }

  /** The player's own marginalia. Empty text removes it. Never sent to a model, an NPC or another brain. */
  setNote(entryId: string, note: string, nowMs: number = Date.now()): void {
    this.requireFound(entryId);
    const text = note.trim();
    if (text.length > NOTE_MAX_CHARS) throw new StoryError(`A note can be at most ${NOTE_MAX_CHARS} characters.`, 400);
    if (!text) {
      this.h.sqlite.prepare(`DELETE FROM story_notes WHERE space_id = ? AND entry_id = ?`).run(this.spaceId, entryId);
      return;
    }
    this.h.sqlite
      .prepare(
        `INSERT INTO story_notes (space_id, entry_id, note, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(space_id, entry_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(this.spaceId, entryId, text, new Date(nowMs).toISOString());
  }

  /** Retrieval makes memory: bump the entry's recall so it relights in the Book. */
  recall(entryId: string, nowMs: number = Date.now()): void {
    this.requireFound(entryId);
    this.h.sqlite
      .prepare(`UPDATE story_finds SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE space_id = ? AND entry_id = ?`)
      .run(new Date(nowMs).toISOString(), this.spaceId, entryId);
  }
}
