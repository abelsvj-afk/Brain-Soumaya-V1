import { useEffect, useRef } from "react";
import { getNpc } from "../api/npcs.js";
import { newestLogId, pickEternityPlayback, type EternityPlayback } from "../graph/eternityAutonomy.js";

/**
 * While the visitor is in Eternity, ask the server for his state every few minutes (reading him runs one lazy,
 * throttled autonomous tick there) and play any fresh act he chose, once. The server is the only authority —
 * this hook decides nothing. A failed read is silent: he simply does nothing that time.
 */
export const ETERNITY_POLL_MS = 5 * 60 * 1000;
const SEEN_KEY = "eternity.autonomy.seen";

function readSeen(): number {
  try {
    return Number(sessionStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeSeen(id: number): void {
  try {
    sessionStorage.setItem(SEEN_KEY, String(id));
  } catch {
    /* private mode — the in-memory ref still prevents a replay this session */
  }
}

export function useEternityAutonomy(active: boolean, onPlay: (p: EternityPlayback) => void): void {
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const seenRef = useRef<number>(readSeen());

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const poll = async () => {
      const npc = await getNpc("eternity");
      if (!alive || !npc || npc.stopped) return;
      const play = pickEternityPlayback(npc.recentLog, seenRef.current, Date.now());
      seenRef.current = Math.max(seenRef.current, newestLogId(npc.recentLog));
      writeSeen(seenRef.current);
      if (play) onPlayRef.current(play);
    };
    // A few seconds after arriving, so the scene is built before he moves.
    const first = window.setTimeout(() => void poll(), 6000);
    const every = window.setInterval(() => void poll(), ETERNITY_POLL_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [active]);
}
