import { useEffect, useRef, useState } from "react";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import { useTravel } from "../hooks/useTravel.js";
import { WORLD_CHART, buildRouteBoard } from "../lib/routeBoard.js";
import WorldCredits from "./WorldCredits.js";

/**
 * The travel surface (Phase 2, P2-3): route board + journey controls,
 * bound entirely to the server's state through useTravel. It shows
 * what the server says — a departure is "preparing" until the server
 * settles it, an arrival exists only when the server confirms it, and
 * the cancel countdown is the server's deadline drawn for display.
 * While the worlds flag is off this renders nothing and fetches
 * nothing (the hook is disabled), which is the dark-shipping contract.
 */
/** Transit presentation durations (D-11 bands: short 10–20s, long
 *  30–60s — upper targets, never compulsory waits). Warp takes the
 *  short band, drift the long one. A route travelled before may be
 *  skipped immediately; reduced-motion travellers are never held. */
export const TRANSIT_MS = { warp: 12_000, drift: 45_000 } as const;

export default function TravelPanel({
  enabled = WORLDS_TRAVEL_ENABLED,
  focusWorld = null,
  onTransit,
}: {
  enabled?: boolean;
  /** Called once when a journey leaves the cancel window and the ship is
   *  actually under way — the host closes the sheet so the flight (drawn by
   *  the scene layer) is what you see, not a text status behind a scrim. */
  onTransit?: () => void;
  /** A world the map sent the traveller here for: its route entry is
   *  highlighted and scrolled into view. The panel itself is unchanged
   *  — departure still goes through the server, as always. */
  focusWorld?: string | null;
}) {
  const travel = useTravel(enabled);
  const [showCredits, setShowCredits] = useState(false);
  const [elapsedJourneyId, setElapsedJourneyId] = useState<string | null>(null);
  const activeJourney = travel.state?.activeJourney ?? null;

  // A map handoff focuses one route entry (highlight + scroll). The
  // highlight is view-only; it never changes what the panel offers.
  useEffect(() => {
    if (!focusWorld) return;
    document.getElementById(`route-${focusWorld}`)?.scrollIntoView?.({ block: "nearest" });
  }, [focusWorld]);

  // The transit presentation clock: presentation only — the server
  // accepts arrival whenever it is asked; this clock decides when the
  // Arrive affordance appears on a first traversal.
  useEffect(() => {
    if (!activeJourney || activeJourney.state !== "in_transit") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setElapsedJourneyId(activeJourney.id);
      return;
    }
    const id = activeJourney.id;
    const timer = window.setTimeout(
      () => setElapsedJourneyId(id),
      TRANSIT_MS[activeJourney.kind],
    );
    return () => window.clearTimeout(timer);
  }, [activeJourney]);

  // Once per journey: hand the screen to the flight.
  const transitNotified = useRef<string | null>(null);
  const underWay = activeJourney && (activeJourney.state === "in_transit" || activeJourney.state === "returning");
  useEffect(() => {
    if (!underWay || !activeJourney || transitNotified.current === activeJourney.id) return;
    transitNotified.current = activeJourney.id;
    onTransit?.();
  }, [underWay, activeJourney, onTransit]);

  if (!enabled) return null;

  const { state, error, busy, cancelSecondsLeft } = travel;
  const journey = state?.activeJourney ?? null;
  const worldName = (key: string) => WORLD_CHART.find((w) => w.key === key)?.name ?? key;

  return (
    <section aria-label="Travel" className="travel-panel">
      <header>
        <h3>Travel</h3>
        {state && (
          <span className="travel-fuel">
            Fuel {Math.floor(state.fuel.fuel)} / {state.fuel.capacity}
          </span>
        )}
      </header>

      {error && (
        <p role="alert" className="travel-error">
          {error}
        </p>
      )}

      {/* Bonus feedback (P2-4): rendered ONLY from the server's bonus
          outcome for the arrival — a credit line when it paid, the
          server's plain reason when a drift was gated, nothing at all
          otherwise. Never a local guess, never a fake celebration. */}
      {travel.lastBonus?.credited && (
        <p className="travel-bonus">+{travel.lastBonus.amount} fuel — journey bonus</p>
      )}
      {travel.lastBonus && !travel.lastBonus.credited && travel.lastBonus.reason && (
        <p className="travel-note">{travel.lastBonus.reason}</p>
      )}

      {!state && !error && <p>Checking the chart…</p>}

      {state && !journey && (
        <ul className="route-board">
          {buildRouteBoard(state).map((entry) => (
            <li
              key={entry.world}
              id={`route-${entry.world}`}
              className={`route-entry${entry.world === focusWorld && !entry.isCurrent ? " route-focused" : ""}`}
            >
              <div>
                <strong>{entry.name}</strong>
                <span> {entry.blurb}</span>
              </div>
              {entry.isCurrent ? (
                <span className="route-current">You are here</span>
              ) : (
                <div className="route-options">
                  {entry.options.map((opt) => (
                    <button
                      key={opt.kind}
                      type="button"
                      disabled={busy || !opt.affordable}
                      onClick={() => void travel.depart(opt.kind, entry.world)}
                    >
                      {opt.label}
                      {opt.cost > 0 ? ` · ${opt.cost} fuel` : " · free"}
                    </button>
                  ))}
                  {entry.options.some((o) => !o.affordable) && (
                    <span className="route-note">Not enough fuel to warp — drifting is always free.</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {state && journey?.state === "arming" && (
        <div className="journey-status">
          <p>
            Preparing to {journey.kind === "warp" ? "warp" : "drift"} to{" "}
            {worldName(journey.destination)}…
          </p>
          {cancelSecondsLeft !== null && (
            <p>
              You can still change your mind — {cancelSecondsLeft}s left to cancel free.
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => void travel.cancel()}>
            Cancel — no charge
          </button>
        </div>
      )}

      {state && journey?.state === "in_transit" && (
        <div className="journey-status">
          <p>
            {journey.kind === "warp" ? "Warping" : "Drifting"} to {worldName(journey.destination)}…
          </p>
          <div className="route-options">
            {travel.hasTraversed(journey.origin, journey.destination) ? (
              <button type="button" disabled={busy} onClick={() => void travel.arrive()}>
                Skip the trip
              </button>
            ) : elapsedJourneyId === journey.id ? (
              <button type="button" disabled={busy} onClick={() => void travel.arrive()}>
                Arrive
              </button>
            ) : (
              <span className="route-note">First trip on this route — enjoy the ride.</span>
            )}
            <button type="button" disabled={busy} onClick={() => void travel.turnBack()}>
              Turn back
            </button>
          </div>
        </div>
      )}

      {state && journey?.state === "returning" && (
        <div className="journey-status">
          <p>Heading back to {worldName(journey.destination)}…</p>
          <button type="button" disabled={busy} onClick={() => void travel.arrive()}>
            Arrive
          </button>
        </div>
      )}

      <footer>
        <button type="button" onClick={() => setShowCredits((v) => !v)}>
          {showCredits ? "Hide credits" : "Credits"}
        </button>
        {showCredits && <WorldCredits />}
      </footer>
    </section>
  );
}
