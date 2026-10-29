import { useEffect, useState } from "react";
import { getSpaceId } from "../api/client.js";
import { getOwnerStatus } from "../api/account.js";

/**
 * Settings → Account: whether this brain has owner access (the worlds'
 * progression gates are lifted for it). The status is the server's verdict.
 * When it is off, the owner needs this brain's key to put in the server's
 * OWNER_SPACE_IDS secret — so the key can be copied from here. It is the same
 * key this device already holds and `/space/me` already returns; nothing new
 * is exposed, and it is never shown on screen, only copied on request.
 */
export default function OwnerAccess() {
  const [owner, setOwner] = useState<boolean | null | "loading">("loading");
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  useEffect(() => {
    let alive = true;
    void getOwnerStatus().then((v) => alive && setOwner(v));
    return () => {
      alive = false;
    };
  }, []);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(getSpaceId() ?? "");
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <section className="settings-section">
      <h3>🛡️ Owner access</h3>
      {owner === "loading" && <p className="settings-note">Checking…</p>}
      {owner === null && <p className="settings-note">Couldn't check owner access right now.</p>}
      {owner === true && (
        <p className="settings-note">
          ✓ On — the worlds' progression gates (People, Eternity) are open for this brain. Fuel still applies.
        </p>
      )}
      {owner === false && (
        <>
          <p className="settings-note">
            Off — the worlds' gates apply to this brain. To switch it on, add this brain's key to the server's
            OWNER_SPACE_IDS secret.
          </p>
          <button type="button" onClick={() => void copyKey()}>
            Copy my brain key
          </button>
          {copied === "ok" && <p className="settings-note">Copied. Treat it like a password — it opens this brain.</p>}
          {copied === "failed" && <p className="settings-note">Couldn't copy on this device.</p>}
        </>
      )}
    </section>
  );
}
