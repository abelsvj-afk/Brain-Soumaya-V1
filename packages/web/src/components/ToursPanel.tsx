import { useState } from "react";
import { WARP_COST, WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import type { Tour, TourStop } from "@brain/shared";
import { useTours } from "../hooks/useTours.js";
import { WORLD_CHART } from "../lib/routeBoard.js";

/**
 * The tours surface (Wave 2, N7): saved tours, Soumaya's suggestions,
 * and the tour now playing — bound entirely to the server's state
 * through useTours. It shows what the server says: the stops in the
 * order the chapter runs, each with its own words, and the stop the
 * traveler is on. It never grades, never counts done stops, never
 * shows a locked stop. While the worlds flag is off this renders
 * nothing and fetches nothing (the hook is disabled), which is the
 * dark-shipping contract.
 *
 * The stop list is the reduced-motion equivalent (C5): the same stops,
 * in the same order, with the same narration, as still text — no
 * flight needed to read the tour.
 */

const worldName = (key: string) => WORLD_CHART.find((w) => w.key === key)?.name ?? key;

/** A stop's date in the viewer's own local time. Never UTC. Unparseable → omitted. */
function localDate(raw?: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function StopItem({ stop, current }: { stop: TourStop; current: boolean }) {
  const date = localDate(stop.occurredAt);
  return (
    <li className={current ? "tour-stop tour-stop-current" : "tour-stop"} aria-current={current ? "true" : undefined}>
      <p className="tour-stop-where">
        {worldName(stop.world)}
        {date ? ` · ${date}` : ""}
        {current ? " · You are here" : ""}
      </p>
      <p className="tour-stop-label">{stop.label}</p>
      <p className="tour-stop-narration">{stop.narration}</p>
    </li>
  );
}

export default function ToursPanel({ enabled = WORLDS_TRAVEL_ENABLED }: { enabled?: boolean } = {}) {
  const tours = useTours(enabled);
  // "Not now" hides a suggestion for this visit only — presentation,
  // never stored: the suggestion is still there on the next visit.
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ id: string; title: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  if (!enabled) return null;

  const session = tours.session;
  const playing = session?.session.state === "playing" ? session : null;
  const ended = session?.session.state === "ended" ? session : null;
  const stops = session?.tour.stops ?? [];
  const currentIndex = session?.session.currentStopIndex ?? 0;
  const currentStop = stops[currentIndex];
  const nextStop = playing ? stops[currentIndex + 1] : undefined;
  const atLastStop = !!playing && currentIndex >= stops.length - 1;
  const legPending = !!playing && session!.session.pendingLegJourneyId !== null;
  const nextNeedsLeg = !!nextStop && nextStop.world !== session!.currentWorld;
  const visibleSuggestions = (tours.suggestions ?? []).filter((s) => !dismissed.has(s.journeyId));

  return (
    <section className="tours-panel" aria-label="Guided tours">
      <h2>Guided tours</h2>
      <p className="tours-panel-intro">
        A tour walks a finished chapter, stop by stop, in its own words. It never starts unless you ask,
        and you can step off at any point — it costs nothing, and the tour waits where you left it.
      </p>

      {tours.error && (
        <p className="tours-panel-error" role="alert">
          {tours.error} <button type="button" onClick={() => void tours.refresh()}>Try again</button>
        </p>
      )}
      {tours.loading && tours.tours === null && !tours.error && (
        <p className="tours-panel-loading">Tours are loading — your tours are unaffected.</p>
      )}

      {playing && currentStop && (
        <div className="tour-playing">
          <h3>Now walking: {playing.tour.title}</h3>
          {playing.session.skippedNote && <p className="tour-skipped-note">{playing.session.skippedNote}</p>}
          {legPending && (
            <p className="tour-leg-pending">
              The ship is on its way — follow the journey in the travel panel. The tour waits at this stop
              until you arrive.
            </p>
          )}
          <ol className="tour-stops">
            {stops.map((stop, i) => (
              <StopItem key={stop.nodeId} stop={stop} current={i === currentIndex} />
            ))}
          </ol>
          <div className="tour-controls">
            {!legPending && !atLastStop && (
              <button type="button" onClick={() => void tours.advance(playing.tour.id, "drift")}>
                Next stop
              </button>
            )}
            {!legPending && !atLastStop && nextNeedsLeg && (
              <button type="button" onClick={() => void tours.advance(playing.tour.id, "warp")}>
                Warp to the next stop · {WARP_COST} fuel
              </button>
            )}
            {!legPending && atLastStop && (
              <button type="button" onClick={() => void tours.advance(playing.tour.id, "drift")}>
                Let the tour rest here
              </button>
            )}
            <button type="button" onClick={() => void tours.leave(playing.tour.id)}>
              Leave the tour
            </button>
          </div>
        </div>
      )}

      {ended && ended.session.endedReason === "left" && (
        <div className="tour-waiting">
          <p>
            You stepped off “{ended.tour.title}” — the tour is waiting where you left it.
          </p>
          <button type="button" onClick={() => void tours.start(ended.tour.id, "drift")}>
            Resume the tour
          </button>
        </div>
      )}
      {ended && ended.session.endedReason === "last-stop" && (
        <div className="tour-resting">
          <p>That’s the last stop of “{ended.tour.title}” — the tour rests here.</p>
        </div>
      )}

      {tours.tours && tours.tours.length > 0 && (
        <div className="tours-saved">
          <h3>Your tours</h3>
          <ul>
            {tours.tours.map((tour: Tour) => (
              <li key={tour.id} className="tour-saved-item">
                <p>
                  {tour.title} · {tour.stops.length} stop{tour.stops.length === 1 ? "" : "s"}
                </p>
                {renaming?.id === tour.id ? (
                  <span>
                    <input
                      aria-label={`New title for ${tour.title}`}
                      value={renaming.title}
                      onChange={(e) => setRenaming({ id: tour.id, title: e.target.value })}
                    />
                    <button
                      type="button"
                      disabled={renaming.title.trim().length === 0}
                      onClick={() => {
                        void tours.rename(tour.id, renaming.title.trim());
                        setRenaming(null);
                      }}
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span>
                    <button type="button" onClick={() => void tours.start(tour.id, "drift")}>
                      {ended?.tour.id === tour.id && ended.session.endedReason === "left"
                        ? "Resume the tour"
                        : "Start the tour"}
                    </button>
                    <button type="button" onClick={() => setRenaming({ id: tour.id, title: tour.title })}>
                      Rename
                    </button>
                    {confirmingDelete === tour.id ? (
                      <span>
                        Delete this tour? It can be brought back.
                        <button
                          type="button"
                          onClick={() => {
                            void tours.remove(tour.id);
                            setConfirmingDelete(null);
                            setDeleted({ id: tour.id, title: tour.title });
                          }}
                        >
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmingDelete(null)}>
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmingDelete(tour.id)}>
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {deleted && (
        <p className="tours-panel-deleted">
          “{deleted.title}” is gone.{" "}
          <button
            type="button"
            onClick={() => {
              void tours.restore(deleted.id);
              setDeleted(null);
            }}
          >
            Bring it back
          </button>
        </p>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="tours-suggestions">
          <h3>Soumaya suggests</h3>
          <ul>
            {visibleSuggestions.map((s) => (
              <li key={s.journeyId} className="tour-suggestion">
                <p>
                  {s.title} · {s.stopCount} stop{s.stopCount === 1 ? "" : "s"}
                </p>
                <p>{s.reason}</p>
                <button type="button" onClick={() => void tours.create(s.journeyId)}>
                  Make this tour
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed(new Set([...dismissed, s.journeyId]))}
                >
                  Not now
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tours.tours !== null && tours.tours.length === 0 && visibleSuggestions.length === 0 && !session && (
        <p className="tours-panel-empty">
          No tours yet — when a chapter is finished, Soumaya can suggest one here.
        </p>
      )}
    </section>
  );
}
