import { useState } from "react";
import { changePasscode, deleteBrain } from "../api/account.js";
import { logoutSpace } from "../api/client.js";
import {
  isBrainDeleteReady,
  isPasscodeChangeReady,
  NEW_PASSCODE_MIN_LENGTH,
} from "./AccountSettings.helpers.js";

/**
 * Account security (IM-129, Q8 → option a): passcode change + brain deletion.
 * Mounted as one section inside the Settings panel; all of its state lives
 * here so the (very large) SettingsPanel only passes the brain's gamer tag
 * and a deletion callback down.
 *
 * Deletion has NO one-click path: a destructive button first opens a
 * hard-confirm step, and the final delete button stays disabled until the
 * user types the brain's exact gamer tag AND re-enters the passcode — the
 * same two proofs the server checks (DELETE /api/space). On success the
 * local credential is cleared via the app's existing logout mechanism
 * (logoutSpace → storeSpace(null) removes `brain.spaceId`) and
 * `onBrainDeleted` lets the app drop its in-memory space, which returns the
 * user to the login screen exactly like switching brains does.
 */
export function AccountSettings({
  gamerTag,
  onBrainDeleted,
}: {
  /** This brain's gamer tag — the exact confirmation value for deletion. */
  gamerTag: string;
  /** Called after a successful deletion + local logout, so the app can
   *  clear its in-memory space and show the login screen. */
  onBrainDeleted?: () => void;
}) {
  // --- Passcode change ---
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [pcBusy, setPcBusy] = useState(false);
  const [pcMsg, setPcMsg] = useState("");
  const [pcError, setPcError] = useState("");

  const submitPasscodeChange = async () => {
    setPcBusy(true);
    setPcMsg("");
    setPcError("");
    try {
      await changePasscode(current, next);
      setCurrent("");
      setNext("");
      setConfirmNext("");
      setPcMsg("Passcode changed ✓ Use the new passcode next time you sign in.");
    } catch (err) {
      setPcError((err as Error).message);
    } finally {
      setPcBusy(false);
    }
  };

  // --- Brain deletion (danger zone) ---
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deletePasscode, setDeletePasscode] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState("");

  const cancelDelete = () => {
    setConfirmOpen(false);
    setConfirmation("");
    setDeletePasscode("");
    setDelError("");
  };

  const submitDelete = async () => {
    setDelBusy(true);
    setDelError("");
    try {
      await deleteBrain(deletePasscode, confirmation);
      // The brain is gone server-side. Clear this device's credential the
      // same way logout does, then hand back to the app shell, which drops
      // its in-memory space and renders the login screen.
      logoutSpace();
      onBrainDeleted?.();
    } catch (err) {
      // Refused (wrong passcode / wrong confirmation) — the server deleted
      // nothing; say so plainly and keep the confirm step open for a retry.
      setDelError((err as Error).message);
      setDelBusy(false);
    }
  };

  const deleteReady = isBrainDeleteReady(confirmation, gamerTag, deletePasscode);

  return (
    <>
      <section className="settings-section">
        <h3>🔑 Passcode</h3>
        <label className="settings-field">
          <span>Current passcode</span>
          <input
            type="password"
            value={current}
            disabled={pcBusy}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Your current passcode"
            autoComplete="current-password"
          />
        </label>
        <label className="settings-field">
          <span>New passcode <em>(at least {NEW_PASSCODE_MIN_LENGTH} characters)</em></span>
          <input
            type="password"
            value={next}
            disabled={pcBusy}
            onChange={(e) => setNext(e.target.value)}
            placeholder="Your new passcode"
            autoComplete="new-password"
          />
        </label>
        <label className="settings-field">
          <span>Confirm new passcode</span>
          <input
            type="password"
            value={confirmNext}
            disabled={pcBusy}
            onChange={(e) => setConfirmNext(e.target.value)}
            placeholder="Type the new passcode again"
            autoComplete="new-password"
          />
        </label>
        {confirmNext.length > 0 && confirmNext !== next && (
          <p className="settings-note" style={{ fontSize: "12px", color: "#ff9b9b", margin: "0 0 10px" }}>
            The new passcodes don't match yet.
          </p>
        )}
        <div className="row">
          <button onClick={() => void submitPasscodeChange()} disabled={pcBusy || !isPasscodeChangeReady(current, next, confirmNext)}>
            {pcBusy ? "Changing…" : "Change passcode"}
          </button>
          {pcMsg && <span className="msg">{pcMsg}</span>}
          {pcError && <span className="msg" role="alert" style={{ color: "#ff9b9b" }}>{pcError}</span>}
        </div>
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "10px 0 0" }}>
          Changing the passcode changes how you sign in with your gamer tag. Devices already
          signed in to this brain stay signed in.
        </p>
      </section>

      <section
        className="settings-section"
        style={{ border: "1px solid rgba(255, 107, 107, 0.55)", borderRadius: "8px", padding: "12px" }}
      >
        <h3 style={{ color: "#ff9b9b" }}>⚠️ Danger zone — delete this brain</h3>
        {!confirmOpen ? (
          <>
            <p style={{ fontSize: "12px", opacity: 0.85, margin: "0 0 10px" }}>
              Permanently delete this brain and everything in it — every memory, connection,
              document, and setting. This cannot be undone.
            </p>
            <button
              onClick={() => setConfirmOpen(true)}
              style={{ borderColor: "#ff6b6b", color: "#ff9b9b" }}
            >
              Delete this brain…
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: "13px", margin: "0 0 10px" }}>
              <b>This is IRREVERSIBLE.</b> Deleting this brain permanently removes{" "}
              <b>everything</b> — all memories, connections, documents, chats, and settings.
              There is no undo and no recovery. If you are sure, type your gamer tag{" "}
              <b>{gamerTag}</b> exactly as shown and re-enter your passcode.
            </p>
            <label className="settings-field">
              <span>Type your gamer tag to confirm <em>({gamerTag})</em></span>
              <input
                value={confirmation}
                disabled={delBusy}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={gamerTag}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>
            <label className="settings-field">
              <span>Re-enter your passcode</span>
              <input
                type="password"
                value={deletePasscode}
                disabled={delBusy}
                onChange={(e) => setDeletePasscode(e.target.value)}
                placeholder="Your passcode"
                autoComplete="current-password"
              />
            </label>
            <div className="row" style={{ gap: "8px", display: "flex", flexWrap: "wrap" }}>
              <button
                onClick={() => void submitDelete()}
                disabled={delBusy || !deleteReady}
                style={{ borderColor: "#ff6b6b", background: deleteReady ? "rgba(255, 107, 107, 0.2)" : undefined, color: "#ff9b9b" }}
              >
                {delBusy ? "Deleting…" : "Permanently delete this brain"}
              </button>
              <button onClick={cancelDelete} disabled={delBusy}>
                Cancel
              </button>
            </div>
            {delError && (
              <p role="alert" style={{ fontSize: "12px", color: "#ff9b9b", margin: "10px 0 0" }}>
                {delError} Nothing was deleted.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
