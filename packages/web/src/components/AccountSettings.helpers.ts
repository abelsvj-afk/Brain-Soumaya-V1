/**
 * Pure gating logic for the account-security forms (IM-129), split out of
 * AccountSettings.tsx (same pattern as App.helpers.ts) so the safety gates
 * are unit-testable without rendering anything.
 */

/** Minimum length for a NEW passcode — mirrors the server's
 *  NEW_PASSCODE_MIN_LENGTH (packages/server/src/auth/spaces.ts). The server
 *  stays authoritative (it re-checks and returns 400); this only lets the
 *  form refuse early with a clearer message. */
export const NEW_PASSCODE_MIN_LENGTH = 8;

/** The passcode-change submit stays disabled until: the current passcode is
 *  present, the new passcode meets the minimum, and the confirmation field
 *  matches the new passcode exactly. */
export function isPasscodeChangeReady(current: string, next: string, confirm: string): boolean {
  return current.length > 0 && next.length >= NEW_PASSCODE_MIN_LENGTH && confirm === next;
}

/**
 * The final brain-deletion action stays disabled until BOTH proofs are
 * present and exact:
 *  - `confirmation` is EXACTLY the brain's gamer tag (case-sensitive — the
 *    same comparison the server makes in SpacesRepo.deleteSpace), and
 *  - the passcode has been re-entered (non-empty; the server verifies it
 *    against the stored hash and returns 401 on a mismatch).
 * An empty/unknown gamer tag can never satisfy the gate.
 */
export function isBrainDeleteReady(confirmation: string, gamerTag: string, passcode: string): boolean {
  return gamerTag.length > 0 && confirmation === gamerTag && passcode.length > 0;
}
