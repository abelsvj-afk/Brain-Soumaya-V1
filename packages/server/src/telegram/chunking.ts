/**
 * Telegram message chunking (Parity Phase 4).
 *
 * Telegram's sendMessage rejects text over 4096 characters. Long tool
 * answers (tab lists, weekly reviews) blew past that once the loop could
 * answer per-tab questions, and the bot's single-message send either
 * failed or forced truncation. This helper splits a long message into
 * ordered chunks that each fit the limit, preferring sane boundaries:
 * paragraph breaks first, then line breaks, then sentence ends, then
 * spaces — a hard cut only when a single token exceeds the limit.
 * Concatenating the chunks (with the boundary whitespace consumed at
 * each split) preserves all content except that whitespace; no chunk is
 * ever dropped and order is never changed.
 */

/** Telegram's hard sendMessage text limit. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Split `text` into ordered chunks of at most `limit` chars each. */
export function chunkTelegramText(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  const max = Math.max(1, Math.floor(limit) || TELEGRAM_MESSAGE_LIMIT);
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    // Boundary search, most-preferred first. A boundary must sit in the
    // latter half of the window so chunks stay substantial (a break at
    // position 3 would emit a sliver and loop pointlessly).
    const minBreak = Math.floor(max / 2);
    let cut = -1;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const idx = window.lastIndexOf(sep);
      if (idx >= minBreak) {
        cut = idx + sep.length;
        break;
      }
    }
    if (cut <= 0) cut = max; // one unbroken run longer than the limit: hard cut
    const piece = rest.slice(0, cut).trimEnd();
    if (piece.length > 0) chunks.push(piece);
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** Send one logical message as as many Telegram messages as it needs. */
export async function sendChunked(
  send: (chatId: number, text: string) => Promise<void>,
  chatId: number,
  text: string,
): Promise<void> {
  for (const chunk of chunkTelegramText(text)) {
    await send(chatId, chunk);
  }
}
