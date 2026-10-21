import { useEffect, useRef, useState } from "react";
import type { Fuel } from "@brain/shared";
import { playSfx } from "../graph/sfx.js";
import { pushToast } from "./Toasts.js";

/**
 * Always-on-screen fuel gauge — a futuristic "engine core" tube on the left edge that
 * you never have to open a menu to read. It fills to the current level, pulses when
 * Soumaya is burning fuel on a job, FLASHES green as it rises / amber-red as it drops,
 * floats the ±delta, and glows red when low. Pure SVG/CSS, no assets. Lives outside the
 * top header so the notch/status bar of an installed PWA can't hide it.
 */
export function FuelGauge({
  fuel,
  pops,
  busy,
  onClick,
}: {
  fuel: Fuel | null;
  pops: { id: number; text: string; spend?: boolean }[];
  /** Soumaya is actively working (spending) — drives the live "engine burn" pulse. */
  busy?: boolean;
  /** Tap the gauge to open the "Ways to earn Fuel" cheat-sheet. */
  onClick?: () => void;
}) {
  const [flash, setFlash] = useState<null | "up" | "down">(null);
  const prev = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!fuel) return;
    const p = prev.current;
    prev.current = fuel.fuel;
    if (p !== null && Math.abs(fuel.fuel - p) > 0.05) {
      setFlash(fuel.fuel > p ? "up" : "down");
      // Timer lives in a ref (not the effect cleanup) so a later small-change render
      // can't cancel it and leave the flash class stuck on.
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 900);
    }
  }, [fuel?.fuel]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  // Hitting a full tank was never marked as a moment — only the real FALSE → TRUE
  // edge fires (never a mount that starts already full), so it doesn't spam while
  // sitting at capacity, but does celebrate again each time you actually refill.
  const wasAtCap = useRef<boolean | null>(null);
  useEffect(() => {
    if (!fuel) return;
    const atCap = fuel.fuel >= fuel.capacity;
    if (wasAtCap.current === false && atCap) {
      playSfx("milestone");
      pushToast("Fuel tank full — Soumaya's ready for anything. ⛽", "⛽", 4000);
    }
    wasAtCap.current = atCap;
  }, [fuel?.fuel, fuel?.capacity]);

  if (!fuel) return null;
  const pct = Math.max(0, Math.min(1, fuel.fuel / fuel.capacity));
  const low = pct < 0.2;

  // aria-value* (valuenow/min/max) are only valid on the range-widget roles
  // (meter/progressbar/slider/spinbutton) — they used to stay attached even
  // when this became role="button" for the tappable variant, which is
  // invalid ARIA for a button. The number is already in aria-label either way.
  const isMeter = !onClick;
  return (
    <div
      className={`fuel-gauge${flash ? ` flash-${flash}` : ""}${low ? " low" : ""}${busy ? " burning" : ""}${onClick ? " tappable" : ""}`}
      role={onClick ? "button" : "meter"}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      aria-label={`Fuel ${Math.round(fuel.fuel)} of ${fuel.capacity}${onClick ? " — tap for ways to earn Fuel" : ""}`}
      aria-valuenow={isMeter ? Math.round(fuel.fuel) : undefined}
      aria-valuemin={isMeter ? 0 : undefined}
      aria-valuemax={isMeter ? fuel.capacity : undefined}
      title={`⛽ Fuel ${Math.round(fuel.fuel)}/${fuel.capacity} — tap for ways to earn it.`}
    >
      <span className="fg-ic">⛽</span>
      <div className="fg-tube">
        <div className="fg-fill" style={{ height: `${pct * 100}%` }}>
          <span className="fg-flow" />
        </div>
      </div>
      <span className="fg-val">{Math.round(fuel.fuel)}</span>
      {/* IM-09: capacity + per-job cost, visible — they used to live only in a
          60-word hover title (undiscoverable on touch). */}
      <span className="fg-meta">of {fuel.capacity}</span>
      <span className="fg-meta fg-cost">{fuel.jobCost}/job</span>
      <div className="fg-pops">
        {pops.map((p) => (
          <span key={p.id} className={`fg-pop ${p.spend ? "spend" : "gain"}`}>
            {p.text}
          </span>
        ))}
      </div>
    </div>
  );
}
