import { useState } from "react";
import { authSpace } from "../api/client.js";
import { SoumayaEye } from "./SoumayaEye.js";
import { humanizeAuthError } from "./cl1a.helpers.js";

/**
 * The gate to a private brain. A gamer tag + passcode opens an existing brain (on any
 * device) or creates a new one with a custom companion name.
 *
 * IM-18: galaxy ambience + preview (star field + her eye), design-system styling
 * (the tabs used to be inline-styled with 4px corners against the card's 18px
 * glass), a fade transition into the app, and human error copy — raw HTTP
 * status text never reaches the user.
 * IM-13: SoumayaEye lives here too, not only in the Chat header.
 */
export function LoginScreen({ onAuthed }: { onAuthed: (space: { id: string; name: string }) => void }) {
  const [gamerTag, setGamerTag] = useState("");
  const [brainName, setBrainName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedGamerTag = gamerTag.trim();
    const trimmedBrainName = brainName.trim();

    if (isSignUp) {
      if (trimmedGamerTag.toLowerCase() === "soumaya") {
        setError("The name/gamer tag 'Soumaya' is reserved.");
        return;
      }
      if (trimmedBrainName.toLowerCase() === "soumaya") {
        setError("The name/gamer tag 'Soumaya' is reserved.");
        return;
      }
      if (!trimmedBrainName) {
        setError("Please enter a name for your second brain/companion.");
        return;
      }
    }

    setBusy(true);
    try {
      const res = await authSpace(trimmedGamerTag, passcode, isSignUp ? trimmedBrainName : undefined);
      // Transition into the app instead of a hard cut.
      setEntering(true);
      window.setTimeout(() => onAuthed({ id: res.id, name: res.name }), 260);
    } catch (err) {
      setError(humanizeAuthError((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`login-screen${entering ? " login-entering" : ""}`}>
      <div className="login-stars" aria-hidden="true">
        {["✦", "·", "✦", "·", "⭐", "·", "✦", "·"].map((s, i) => (
          <span key={i} className={`login-star ls-${i}`}>{s}</span>
        ))}
      </div>
      <div className="login-card">
        <div className="login-eye"><SoumayaEye state="idle" mood="thoughtful" size={44} /></div>
        <h1>
          Soumaya <span className="sep">·</span> Second Brain
        </h1>
        <p className="login-sub">
          {isSignUp
            ? "Create a new private galaxy — each memory you add becomes a star in it. Choose a unique gamer tag and name your companion."
            : "Open your private galaxy with your gamer tag and passcode."}
        </p>

        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab-btn ${!isSignUp ? "active" : ""}`}
            onClick={() => {
              setIsSignUp(false);
              setError("");
            }}
          >
            Enter My Galaxy
          </button>
          <button
            type="button"
            className={`login-tab-btn ${isSignUp ? "active" : ""}`}
            onClick={() => {
              setIsSignUp(true);
              setError("");
            }}
          >
            Create New Galaxy
          </button>
        </div>

        <form onSubmit={submit} className="login-form">
          <label>
            Gamer tag
            <input
              value={gamerTag}
              onChange={(e) => setGamerTag(e.target.value)}
              placeholder="e.g. pilot77"
              autoCapitalize="none"
              autoCorrect="off"
              minLength={2}
              maxLength={40}
              required
            />
          </label>

          {isSignUp && (
            <label>
              Brain / Companion name
              <input
                value={brainName}
                onChange={(e) => setBrainName(e.target.value)}
                placeholder="e.g. Luna"
                autoCapitalize="none"
                autoCorrect="off"
                minLength={2}
                maxLength={40}
                required
              />
            </label>
          )}

          <label>
            Passcode
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="at least 4 characters"
              minLength={4}
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button
            type="submit"
            disabled={
              busy ||
              gamerTag.trim().length < 2 ||
              (isSignUp && brainName.trim().length < 2) ||
              passcode.length < 4
            }
          >
            {busy ? "Opening…" : isSignUp ? "Create my galaxy" : "Enter my galaxy"}
          </button>
        </form>
        <p className="login-note">
          Your passcode is hashed and never stored in the clear. Keep it safe — it's the
          only way back into this brain.
        </p>
      </div>
    </div>
  );
}
