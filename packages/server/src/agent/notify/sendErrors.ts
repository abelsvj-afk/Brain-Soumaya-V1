/**
 * Send-outcome classification for proactive delivery (Batch A, RE-01/RE-02).
 *
 * The notification boundary's contract (boundary.ts) has always been:
 * resolve = delivered; throw = definite failure. Two outcomes do not fit
 * that binary, and this module names them so every layer classifies the
 * same way:
 *
 * - AmbiguousSendError: the send was attempted but NO response came back
 *   (network failure, timeout, connection reset). Telegram may or may not
 *   have received the message, so it is neither a clean success nor a
 *   definite failure. The boundary records it with the outbox's existing
 *   ambiguous mechanism (markAmbiguous): terminal, the cap claim is
 *   RETAINED, and the message is never auto-retried — Telegram has no
 *   idempotency key, so a retry could deliver a duplicate.
 *
 * - NoRecipientsError: the send reached zero recipients — the space has
 *   no linked chat, or no delivery channel is configured at all. That is
 *   a KNOWN non-delivery (nothing was sent to anyone), so the boundary
 *   drops the outbox row and RELEASES the cap claim, and callers that own
 *   a firing decision (the reminder tool) can defer instead of consuming.
 *
 * Any other thrown error is a definite failure: a response WAS received
 * (HTTP error status, or a body saying ok:false) and it said no. The
 * boundary's existing retry/backoff path owns those.
 *
 * This module is a leaf (no imports) so the sender (telegram/bot.ts), the
 * boundary, the router, and the tools can all share the classification
 * without import cycles.
 */

export class AmbiguousSendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AmbiguousSendError";
  }
}

export class NoRecipientsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NoRecipientsError";
  }
}
