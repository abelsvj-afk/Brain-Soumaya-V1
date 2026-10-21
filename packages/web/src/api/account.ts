/**
 * Account-security API calls (IM-129): passcode change + brain deletion.
 * Split out of client.ts like the other domain modules (features.ts, mind.ts, …)
 * and built on the same transport — `afetch` attaches the current brain's
 * `x-space-id` header and enforces a timeout. Both calls are ACTIONS, not
 * reads: they throw with the server's real error message on any failure so
 * the UI can never mistake a refused change/deletion for a successful one.
 */
import { API, afetch } from "./http.js";

/** Change this brain's login passcode. Requires the CURRENT passcode as
 *  proof — the server returns 401 when it is wrong (nothing changes) and
 *  400 when the new passcode is below the 8-character minimum. The space id
 *  (the bearer credential other devices hold) does NOT change. */
export async function changePasscode(currentPasscode: string, newPasscode: string): Promise<void> {
  const res = await afetch(`${API}/space/passcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPasscode, newPasscode }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `Couldn't change the passcode (${res.status})`);
  }
}

/** Permanently delete this brain and ALL of its data. The server requires
 *  BOTH the passcode re-entered (401 when wrong) AND `confirmation` exactly
 *  equal to the brain's gamer tag (400 when mismatched) — either failure
 *  deletes nothing. DELETE-with-body follows the same afetch pattern as the
 *  other DELETE calls in the client; the body carries the two proofs. */
export async function deleteBrain(passcode: string, confirmation: string): Promise<void> {
  const res = await afetch(`${API}/space`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode, confirmation }),
  });
  const body = (await res.json().catch(() => ({}))) as { deleted?: boolean; error?: string };
  if (!res.ok || !body.deleted) {
    throw new Error(body.error ?? `Couldn't delete this brain (${res.status})`);
  }
}
