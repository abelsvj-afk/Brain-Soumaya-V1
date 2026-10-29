import { useCallback, useEffect, useState } from "react";
import type { NpcState } from "@brain/shared";
import { getNpcs, NpcClientError, resumeNpc, stopNpc } from "../api/npcs.js";

/**
 * Settings → Eternity (autonomous): the owner's window onto his autonomy (docs/specs/eternity-autonomy-2026-10-29.md).
 * Shows whether he is running, how many acts today, and his log — every act or wait with its plain cause — and the
 * kill switch. It reads the roster list (which never runs a tick), so opening Settings never makes him act.
 */
const ACT_WORDS: Record<string, string> = {
  gesture: "Gesture",
  "reorder-light": "Reordered the heavens",
  wait: "Waited",
};

export default function EternityAutonomyPanel() {
  const [npc, setNpc] = useState<NpcState | null | "loading">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const all = await getNpcs();
    setNpc(all?.find((n) => n.id === "eternity") ?? null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (stop: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setNpc(stop ? await stopNpc("eternity") : await resumeNpc("eternity"));
    } catch (e) {
      setError(e instanceof NpcClientError ? e.message : "That didn't go through — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" id="settings-eternity">
      <h3>🌌 Eternity (autonomous)</h3>
      {npc === "loading" && <p className="settings-note">Checking…</p>}
      {npc === null && <p className="settings-note">Couldn't reach him right now.</p>}
      {npc && npc !== "loading" && (
        <>
          <p className="settings-note" style={{ fontSize: "12px", opacity: 0.8 }}>
            He acts rarely, on his own, only while you are in his world, and never reads or changes your memories. Every act
            or wait is listed here with why. Status: <strong>{npc.stopped ? "stopped" : "running"}</strong> · {npc.actsToday} act
            {npc.actsToday === 1 ? "" : "s"} today.
          </p>
          <button onClick={() => void toggle(!npc.stopped)} disabled={busy}>
            {npc.stopped ? "▶ Let him act again" : "⏹ Stop him"}
          </button>
          {error && <p className="msg">{error}</p>}
          {npc.recentLog.length === 0 ? (
            <p className="settings-note">Nothing yet — he acts only while you are in Eternity.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
              {npc.recentLog.slice(0, 10).map((e) => (
                <li key={e.id} style={{ fontSize: 12 }}>
                  <strong>
                    {ACT_WORDS[e.kind] ?? e.kind}
                    {e.kind === "gesture" ? ` — ${e.act}` : ""}
                  </strong>{" "}
                  <span style={{ opacity: 0.7 }}>· {new Date(e.createdAt).toLocaleString()}</span>
                  <div style={{ opacity: 0.8 }}>{e.cause}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
