import type { DbHandle } from "../db/client.js";

/**
 * Durable drafts for the Telegram open-ended note flow (parity Phase 3).
 *
 * One open draft per (space_id, chat_id) — the table's PRIMARY KEY. The draft
 * lives in the database, NOT in process memory: a dictated note must survive
 * a server restart/redeploy (the bot's conversation-history map explicitly
 * accepts restart loss; a note the user believes is being saved must not).
 *
 * `text` is the accumulated verbatim note: parts are joined with a single
 * "\n" by the caller (telegram/notes.ts), so each part's own bytes — internal
 * line breaks included — are preserved exactly as sent.
 *
 * Timestamps are canonical ISO-Z strings supplied by the caller (the note
 * state machine owns the clock so expiry is testable); the DB strftime
 * defaults are only a backstop.
 */
export interface TelegramNoteDraft {
  spaceId: string;
  chatId: number;
  text: string;
  partCount: number;
  createdAt: string;
  updatedAt: string;
}

interface DraftRow {
  space_id: string;
  chat_id: number;
  text: string;
  part_count: number;
  created_at: string;
  updated_at: string;
}

const toDraft = (r: DraftRow): TelegramNoteDraft => ({
  spaceId: r.space_id,
  chatId: r.chat_id,
  text: r.text,
  partCount: r.part_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class TelegramNoteDraftsRepo {
  constructor(private readonly h: DbHandle) {}

  /** The open draft for this (space, chat), or undefined when none is active. */
  get(spaceId: string, chatId: number): TelegramNoteDraft | undefined {
    const row = this.h.sqlite
      .prepare(`SELECT * FROM telegram_note_drafts WHERE space_id = ? AND chat_id = ?`)
      .get(spaceId, chatId) as DraftRow | undefined;
    return row ? toDraft(row) : undefined;
  }

  /**
   * Start a draft. Callers check `get()` first (starting while one is active
   * is a status report, not a restart); INSERT OR IGNORE keeps a race from
   * ever clobbering an in-progress note. Returns the stored draft.
   */
  insert(
    spaceId: string,
    chatId: number,
    text: string,
    partCount: number,
    nowIso: string,
  ): TelegramNoteDraft {
    this.h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO telegram_note_drafts
           (space_id, chat_id, text, part_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(spaceId, chatId, text, partCount, nowIso, nowIso);
    return this.get(spaceId, chatId)!;
  }

  /** Replace the accumulated text/part count after an append; bumps the idle clock. */
  update(
    spaceId: string,
    chatId: number,
    text: string,
    partCount: number,
    nowIso: string,
  ): void {
    this.h.sqlite
      .prepare(
        `UPDATE telegram_note_drafts
         SET text = ?, part_count = ?, updated_at = ?
         WHERE space_id = ? AND chat_id = ?`,
      )
      .run(text, partCount, nowIso, spaceId, chatId);
  }

  /** Discard / consume a draft. Returns true if one existed. */
  remove(spaceId: string, chatId: number): boolean {
    const res = this.h.sqlite
      .prepare(`DELETE FROM telegram_note_drafts WHERE space_id = ? AND chat_id = ?`)
      .run(spaceId, chatId);
    return res.changes > 0;
  }
}
