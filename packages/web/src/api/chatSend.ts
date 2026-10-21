/**
 * Chat send-path contract + client timeout (Screenshot Fixes Package A,
 * Findings 1 & 8). Split out of client.ts so ChatDock can import the caps
 * without the whole client module (and so tests can pin them directly).
 *
 * The caps mirror the server's ChatBody contract
 * (packages/server/src/api/routes/chat.ts) EXACTLY:
 *   question 1–2000 chars · history ≤16 entries, each text ≤4000 ·
 *   attachments ≤3, name 1–200, text 1–20000.
 * The client used to enforce NONE of them, so ordinary use (a long previous
 * reply riding in history, an image-only PDF's empty extraction, a pasted
 * long question) produced server 400s whose raw text then leaked into the
 * error banner. Sanitizing here — on the ONE path every send and every
 * retry goes through — makes those 400s unreachable from this client.
 */
export const CHAT_QUESTION_MAX = 2000;
export const CHAT_HISTORY_MAX_ENTRIES = 16;
export const CHAT_HISTORY_ENTRY_MAX = 4000;
export const CHAT_ATTACHMENT_MAX = 3;
export const CHAT_ATTACHMENT_NAME_MAX = 200;
export const CHAT_ATTACHMENT_TEXT_MAX = 20000;

/**
 * Client cap for one chat request. The server's turn deadline is 9s
 * (CHAT_TURN_DEADLINE_MS in chat/graphrag.ts) after which it ALWAYS
 * completes the turn (degraded if necessary) — so a healthy request answers
 * in ≲9s + response time. 15s leaves ~6s of network slack on a slow phone
 * connection while still surfacing an outcome (reply or banner) long
 * before the old 60s cap, while the user is still looking at the screen.
 */
export const CHAT_TIMEOUT_MS = 15_000;

export interface ChatHistoryEntry {
  role: "you" | "soumaya";
  text: string;
}

export interface ChatAttachmentInput {
  name: string;
  text: string;
}

export interface SanitizedChatPayload {
  question: string;
  history: ChatHistoryEntry[];
  attachments: ChatAttachmentInput[];
}

/**
 * Bring an outbound chat payload inside the server contract BEFORE it is
 * sent. Pure and total: every send and every retry passes through here
 * (askChat applies it internally), so a retry can never replay a stored
 * raw body into the same 400 — it reconstructs the same corrected body a
 * fresh send would produce.
 *
 * Rules (truncate, never silently drop content the user can see):
 * - question: truncated to 2000 chars (the composer also caps input at
 *   2000 with a visible counter, so this is a backstop for voice input).
 * - history: the LAST 16 entries, each text truncated to 4000 chars —
 *   entries are truncated, not dropped, so the thread still reads.
 * - attachments: at most 3; name truncated to 200 chars; text truncated
 *   to 20000 chars. An attachment whose extracted text is EMPTY is
 *   excluded here as a backstop — the truthful, visible behaviour lives
 *   at pick/stage time in ChatDock, which refuses to stage a file with
 *   no readable text and tells the user why.
 */
export function sanitizeChatPayload(input: {
  question: string;
  history?: ChatHistoryEntry[];
  attachments?: ChatAttachmentInput[];
}): SanitizedChatPayload {
  const question = (input.question ?? "").slice(0, CHAT_QUESTION_MAX);
  const history = (input.history ?? [])
    .slice(-CHAT_HISTORY_MAX_ENTRIES)
    .map((m) => ({ role: m.role, text: (m.text ?? "").slice(0, CHAT_HISTORY_ENTRY_MAX) }));
  const attachments = (input.attachments ?? [])
    .filter((a) => (a.text ?? "").trim().length > 0)
    .slice(0, CHAT_ATTACHMENT_MAX)
    .map((a) => ({
      name: (a.name ?? "").slice(0, CHAT_ATTACHMENT_NAME_MAX).trim() || "attachment",
      text: a.text.slice(0, CHAT_ATTACHMENT_TEXT_MAX),
    }));
  return { question, history, attachments };
}

/**
 * A chat failure with PLAIN-LANGUAGE, user-safe copy (Finding 1). askChat
 * throws only this (or rethrows a caller abort): the server's raw error
 * string is deliberately discarded at the transport boundary, so it can
 * never reach the banner. Status is kept for callers that branch on it —
 * the message is the only part rendered.
 */
export class ChatRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

/** Plain-language copy for a failed chat request, by HTTP status. The
 *  server's own error text is never consulted — it may be a contract
 *  string, a stack-flavoured message, anything; the user sees this. */
export function chatErrorForStatus(status: number): ChatRequestError {
  if (status === 400)
    return new ChatRequestError(
      "That message couldn't be sent as-is — please shorten it or remove an attachment and try again.",
      status,
    );
  if (status === 401 || status === 403)
    return new ChatRequestError("Your session needs a refresh — please sign in again.", status);
  if (status === 429)
    return new ChatRequestError("Soumaya is getting a lot of requests right now — give it a moment and try again.", status);
  if (status >= 500)
    return new ChatRequestError("Soumaya's server hit a problem just now — try again in a moment.", status);
  return new ChatRequestError("Couldn't reach Soumaya just now — try again.", status);
}

export function chatTimeoutError(): ChatRequestError {
  return new ChatRequestError("Soumaya took too long to answer — your message is still here, try again.");
}
