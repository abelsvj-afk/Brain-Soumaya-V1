import { useEffect, useState } from "react";
import { getThoughts, type Thought } from "../api/client.js";

/**
 * The Mind Space (Cognitive Layer Phase 2) — an ambient overlay that floats your
 * live working-memory thoughts as glowing motes drifting at the edges of the
 * galaxy, so "what you're thinking now" is present around you, not buried in a tab.
 * Motes brighten with a thought's strength and fade as it decays; the layer is
 * purely decorative (pointer-events: none) so it never blocks the 3D view.
 *
 * Self-contained: it reads its own on/off flag from localStorage and re-reads on a
 * `mindspace-toggle` window event (dispatched by the Mind panel), and polls the
 * working-memory API directly — no prop-drilling through the app tree.
 */

const KEY = "mindspace.ambient";
export function mindSpaceEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setMindSpaceEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("mindspace-toggle"));
}

/**
 * Deterministic placement out on the PERIMETER of the view (never the centre — that's
 * where the focused body sits). Motes ring the edge, faded + shimmering so they read as
 * fleeting real-time thoughts, not fixed labels. Clamped so they stay on-screen and off
 * the very top (header). Two animations run in parallel: a slow wander + a light shimmer.
 */
function moteStyle(t: Thought, idx: number): React.CSSProperties {
  const golden = 137.508; // even angular spread
  const angle = ((t.id * golden + idx * 47) % 360) * (Math.PI / 180);
  const radius = 33 + ((t.id * 7) % 9); // 33%..41% out — on a ring, pulled slightly in from the edge
  let cx = 50 + Math.cos(angle) * radius;
  let cy = 50 + Math.sin(angle) * radius * 0.86;
  cx = Math.min(87, Math.max(8, cx)); // keep on-screen
  cy = Math.min(85, Math.max(15, cy)); // clear the header
  return {
    left: `${cx}%`,
    top: `${cy}%`,
    // Faded / ephemeral; strength only nudges it a little.
    opacity: 0.2 + t.strength * 0.32,
    // Two animations: [wander, shimmer].
    animationDelay: `${((t.id * 7 + idx * 3) % 20) * -1}s, ${((t.id * 3) % 5) * -0.6}s`,
    animationDuration: `${16 + ((t.id * 5) % 10)}s, ${2.3 + ((t.id % 7) * 0.3)}s`,
    "--mote-glow": `${6 + t.strength * 16}px`,
  } as React.CSSProperties;
}

export function MindSpace({ hidden }: { hidden?: boolean }) {
  const [on, setOn] = useState(mindSpaceEnabled());
  const [thoughts, setThoughts] = useState<Thought[]>([]);

  useEffect(() => {
    const sync = () => setOn(mindSpaceEnabled());
    window.addEventListener("mindspace-toggle", sync);
    return () => window.removeEventListener("mindspace-toggle", sync);
  }, []);

  useEffect(() => {
    if (!on) {
      setThoughts([]);
      return;
    }
    const load = () => getThoughts().then(setThoughts).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [on]);

  // Vanish while a menu/panel is open so drifting motes never sit over what you're reading.
  if (!on || hidden || thoughts.length === 0) return null;

  return (
    <div className="mindspace-layer" aria-hidden>
      {thoughts.slice(0, 12).map((t, i) => (
        <span key={t.id} className="mindspace-mote" style={moteStyle(t, i)}>
          <span className="mindspace-dot" />
          <span className="mindspace-text">{t.text}</span>
        </span>
      ))}
    </div>
  );
}
