import type { GraphNode } from "@brain/shared";
import type { AppContext } from "../context.js";
import type { DbHandle } from "../db/client.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { TelegramNoteDraftsRepo, type TelegramNoteDraft } from "../repositories/telegramNoteDrafts.repo.js";
import { linkCognitiveAnchor } from "../analysis/cognitive.js";

/**
 * Open-ended Telegram notes (parity Phase 3) — ALL of the note logic lives in
 * this module so telegram/bot.ts only carries minimal wiring (command
 * dispatch for /note, /done, /cancel + one interception call in the message
 * path, placed AFTER the pending-approval check).
 *
 * The flow (owner decisions D2/D3): /note starts a draft; while it is active,
 * subsequent NON-COMMAND messages append VERBATIM (exact text, line breaks
 * included); /done saves the note into the brain exactly as written — the
 * extraction pipeline is bypassed entirely, so nothing is rewritten,
 * summarised, or re-typed; /cancel discards it. Owner-typed commands act
 * immediately — there is no approval step for the note flow.
 *
 * PRECEDENCE (pinned by tests):
 * 1. Commands always win over note text: any message starting with "/" is
 *    never appended (handleNoteAppend refuses it; the bot dispatches real
 *    commands before the interception call, so e.g. /digest mid-note runs
 *    the digest).
 * 2. A pending write-approval answer wins over note append: the bot calls
 *    maybeConfirmPending BEFORE the note interception, so a "yes"/"no" that
 *    confirms/denies a pending approval never lands in the note. (A "yes"
 *    with NO approval pending is ordinary text and does append.)
 * 3. When NO draft is active, this module never touches a message:
 *    handleNoteAppend returns null and the bot's normal path runs.
 *
 * Bounds & expiry:
 * - At most NOTE_MAX_PARTS parts and NOTE_MAX_CHARS total characters per
 *   note. An append that would cross a bound is refused (draft kept open,
 *   nothing appended) with a message naming the limit.
 * - A draft idle for more than NOTE_IDLE_EXPIRY_MS (24h, elapsed time —
 *   never calendar-day math) is stale: on the next contact it is discarded
 *   and the user is warned (see expireStaleDraft).
 */

// ---------------------------------------------------------------------------
// Bounds (stated, user-facing)
// ---------------------------------------------------------------------------

/** Max messages that may be appended to one note. */
export const NOTE_MAX_PARTS = 50;
/** Max total characters in one note (parts plus the "\n" joins). */
export const NOTE_MAX_CHARS = 20_000;
/** Idle expiry: a draft untouched for 24h is discarded on next contact. */
export const NOTE_IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;
/** Node label = first non-empty line, truncated to this many characters. */
export const NOTE_LABEL_MAX_CHARS = 80;

/** Separator between dictated parts inside the stored note text. */
const PART_SEPARATOR = "\n";

const iso = (nowMs: number): string => new Date(nowMs).toISOString();

function isExpired(draft: TelegramNoteDraft, nowMs: number): boolean {
  const updated = Date.parse(draft.updatedAt);
  if (Number.isNaN(updated)) return false; // unparseable clock: never eat a note on a guess
  return nowMs - updated > NOTE_IDLE_EXPIRY_MS;
}

/**
 * Discard a stale (24h-idle) draft, if one exists. Returns the discarded
 * draft so the caller can warn the user; null when there was nothing stale.
 * The bot calls this on every linked update BEFORE dispatch, so the warning
 * rides the next contact whatever that contact turns out to be (a fresh
 * /note, a /done, or a normal chat message — which then flows on normally,
 * since the draft is gone).
 */
export function expireStaleDraft(
  handle: DbHandle,
  spaceId: string,
  chatId: number,
  nowMs: number,
): TelegramNoteDraft | null {
  const repo = new TelegramNoteDraftsRepo(handle);
  const draft = repo.get(spaceId, chatId);
  if (!draft || !isExpired(draft, nowMs)) return null;
  repo.remove(spaceId, chatId);
  return draft;
}

/** The user-facing warning for a draft discarded by expireStaleDraft. */
export function expiredDraftWarning(draft: TelegramNoteDraft): string {
  return (
    `⌛ Your unfinished note from earlier was discarded — it sat untouched for over 24 hours ` +
    `(${draft.partCount} part${draft.partCount === 1 ? "" : "s"}, ${draft.text.length} characters). ` +
    `Send /note to start a fresh one.`
  );
}

// ---------------------------------------------------------------------------
// Verbatim save
// ---------------------------------------------------------------------------

/** Label for a saved note: its first non-empty line, truncated sanely. */
export function noteLabel(rawText: string): string {
  for (const line of rawText.split("\n")) {
    const t = line.trim();
    if (t.length > 0) {
      return t.length > NOTE_LABEL_MAX_CHARS ? `${t.slice(0, NOTE_LABEL_MAX_CHARS - 1)}…` : t;
    }
  }
  return "Telegram note";
}

/**
 * People-mention linking, mirroring ingestion/pipeline.ts §4c: a note that
 * names an already-tracked person (label or alias, plain substring match)
 * gets a `supports` edge to them. Non-destructive by construction — it only
 * ever CREATES edges; the note's content is never read back or rewritten.
 */
function linkMentionedPeople(handle: DbHandle, spaceId: string, node: GraphNode): void {
  const people = handle.sqlite
    .prepare(
      `SELECT id, label, aliases FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind = 'person_entity'`,
    )
    .all(spaceId) as { id: number; label: string; aliases: string | null }[];
  if (people.length === 0) return;
  const lower = `${node.label}\n${node.content}`.toLowerCase();
  const edges = new EdgesRepo(handle, spaceId);
  for (const p of people) {
    const tokens = [p.label.toLowerCase()];
    if (p.aliases) {
      try {
        const parsed: unknown = JSON.parse(p.aliases);
        if (Array.isArray(parsed)) tokens.push(...parsed.map((a) => String(a).toLowerCase()));
      } catch {
        /* malformed aliases degrade to label-only, same as the pipeline */
      }
    }
    if (!tokens.some((t) => t.length > 0 && lower.includes(t))) continue;
    if (p.id === node.id || edges.exists(node.id, p.id)) continue;
    edges.create({ source: node.id, target: p.id, relationship: "supports" });
  }
}

/**
 * Save a finished note VERBATIM as one memory node. Bypasses the extraction
 * pipeline entirely: `content` is the raw text byte-for-byte (line breaks
 * included). The node is embedded through the space's existing embedding
 * provider (NodesRepo.create stores vector + FTS alongside the row), so
 * memory_search / Browse / Search / the galaxy all find it like any memory.
 *
 * Marking: tags ["note", "telegram"] and the raw `origin` column set to
 * "telegram" (the relational column is free TEXT; the GraphNode TS union
 * only names "user"|"agent", so the provenance is stamped at the SQL layer
 * after the typed create — the row is the record).
 *
 * Cognitive linking is best-effort and edge-only: it may ATTACH the note to
 * people/goals, it can never rewrite its content.
 */
export async function saveTelegramNote(
  ctx: AppContext,
  spaceId: string,
  rawText: string,
): Promise<GraphNode> {
  const label = noteLabel(rawText);
  const embedding = await ctx.embeddings.embed(rawText);
  const nodesRepo = new NodesRepo(ctx.handle, spaceId);
  const node = nodesRepo.create(
    {
      label,
      type: "daily",
      content: rawText,
      tags: ["note", "telegram"],
      origin: "user",
    },
    embedding,
  );
  ctx.handle.sqlite
    .prepare(`UPDATE nodes SET origin = 'telegram' WHERE id = ? AND space_id = ?`)
    .run(node.id, spaceId);
  try {
    linkMentionedPeople(ctx.handle, spaceId, node);
  } catch {
    /* best-effort: linking must never fail the save */
  }
  try {
    linkCognitiveAnchor(ctx, spaceId, node.id, node.label, embedding);
  } catch {
    /* best-effort, same contract as the ingest pipeline */
  }
  return nodesRepo.getById(node.id) ?? node;
}

// ---------------------------------------------------------------------------
// State machine — commands
// ---------------------------------------------------------------------------

/** True when the (trimmed) message is one of the note commands. */
export function isNoteCommand(trimmedText: string): boolean {
  return (
    trimmedText === "/note" ||
    trimmedText.startsWith("/note ") ||
    trimmedText === "/done" ||
    trimmedText === "/cancel"
  );
}

function statusText(draft: TelegramNoteDraft): string {
  return (
    `${draft.partCount} part${draft.partCount === 1 ? "" : "s"}, ` +
    `${draft.text.length} character${draft.text.length === 1 ? "" : "s"} so far`
  );
}

/**
 * Handle /note, /done and /cancel. Returns the reply to send, or null when
 * the message is not a note command (the caller then continues its normal
 * dispatch — this is what keeps commands and chat untouched by note code).
 */
export async function handleNoteCommand(
  ctx: AppContext,
  spaceId: string,
  chatId: number,
  trimmedText: string,
  nowMs: number,
): Promise<string | null> {
  if (!isNoteCommand(trimmedText)) return null;
  const repo = new TelegramNoteDraftsRepo(ctx.handle);
  // A stale draft never answers a command as if it were live (the bot's
  // per-update expiry pass normally discards + warns first; this keeps
  // direct callers honest too).
  const existing = repo.get(spaceId, chatId);
  if (existing && isExpired(existing, nowMs)) repo.remove(spaceId, chatId);
  const draft = existing && !isExpired(existing, nowMs) ? existing : undefined;

  if (trimmedText === "/cancel") {
    if (!draft) return "No note in progress — nothing to discard.";
    repo.remove(spaceId, chatId);
    return `🗑️ Note discarded (${statusText(draft)}). Nothing was saved.`;
  }

  if (trimmedText === "/done") {
    if (!draft) return "No note in progress — send /note to start one.";
    if (draft.partCount === 0 || draft.text.trim().length === 0) {
      return "Your note is still empty — send the words first, then /done. (Or /cancel to drop it.)";
    }
    let node: GraphNode;
    try {
      node = await saveTelegramNote(ctx, spaceId, draft.text);
    } catch (err) {
      // Keep the draft: a failed save must not lose dictated words.
      console.error("[telegram] note save failed:", err);
      return "I couldn't save that note just now — your draft is still open, try /done again in a moment.";
    }
    repo.remove(spaceId, chatId);
    return (
      `✅ Note saved as “${node.label}” — ${statusText(draft)}, exactly as you wrote it. ` +
      `It's in your brain now (searchable, tags: note, telegram).`
    );
  }

  // /note (bare, or with the first part riding on the command line).
  if (draft) {
    return (
      `📝 A note is already in progress (${statusText(draft)}). ` +
      `Keep sending to add to it, /done to save it, /cancel to discard it. ` +
      `Typed messages only — voice notes can't join a note yet. ` +
      `If you leave it untouched for 24 hours, the draft is discarded.`
    );
  }
  const initial = trimmedText.slice("/note".length).trim();
  if (initial.length > NOTE_MAX_CHARS) {
    return (
      `That first part alone is ${initial.length} characters — a note can hold at most ` +
      `${NOTE_MAX_CHARS}. Note not started; try a shorter opening or split it up after /note.`
    );
  }
  const started = repo.insert(spaceId, chatId, initial, initial ? 1 : 0, iso(nowMs));
  return initial
    ? `📝 Note started — part 1 saved (${statusText(started)}). Keep sending, /done to save, /cancel to discard. Typed messages only — voice notes can't join a note yet. If you leave the draft untouched for 24 hours, it's discarded.`
    : "📝 Note started — send your note in as many messages as you like; I'll keep every word exactly as sent. Typed messages only — voice notes can't join a note yet. /done saves it, /cancel discards it. If you leave the draft untouched for 24 hours, it's discarded.";
}

// ---------------------------------------------------------------------------
// State machine — append interception
// ---------------------------------------------------------------------------

/**
 * The one interception in the bot's message path. Call it AFTER command
 * dispatch and AFTER the pending-approval check (see PRECEDENCE above).
 *
 * Returns the acknowledgement to send when the message was consumed as a
 * note part (or refused by a bound), or null when the message is NOT note
 * business — no active draft, or a command — in which case the caller runs
 * its normal path and the message is untouched by note code.
 *
 * `rawText` is the message exactly as received (the bot's command parsing
 * trims its own copy; appends use the raw bytes so dictation is verbatim).
 */
export async function handleNoteAppend(
  ctx: AppContext,
  spaceId: string,
  chatId: number,
  rawText: string,
  nowMs: number,
): Promise<string | null> {
  if (rawText.trim().startsWith("/")) return null; // commands always win
  if (rawText.length === 0) return null;
  const repo = new TelegramNoteDraftsRepo(ctx.handle);
  const draft = repo.get(spaceId, chatId);
  if (!draft) return null; // no draft: note code must not touch the message
  if (isExpired(draft, nowMs)) {
    repo.remove(spaceId, chatId);
    return expiredDraftWarning(draft);
  }
  if (draft.partCount >= NOTE_MAX_PARTS) {
    return (
      `📝 This note is full — it already has the maximum ${NOTE_MAX_PARTS} parts ` +
      `(${draft.text.length} characters). That last message was NOT added. ` +
      `/done to save it as-is, or /cancel to discard it.`
    );
  }
  const joinedLength = draft.text.length === 0 ? rawText.length : draft.text.length + PART_SEPARATOR.length + rawText.length;
  if (joinedLength > NOTE_MAX_CHARS) {
    return (
      `📝 That message would push the note past its ${NOTE_MAX_CHARS}-character limit ` +
      `(currently ${draft.text.length}) — it was NOT added. ` +
      `/done to save what you have, or /cancel to discard it.`
    );
  }
  const newText = draft.text.length === 0 ? rawText : draft.text + PART_SEPARATOR + rawText;
  const newCount = draft.partCount + 1;
  repo.update(spaceId, chatId, newText, newCount, iso(nowMs));
  return (
    `📝 Part ${newCount} added — ${newText.length} characters so far ` +
    `(${newCount}/${NOTE_MAX_PARTS} parts). Send more, /done to save, /cancel to discard.`
  );
}
