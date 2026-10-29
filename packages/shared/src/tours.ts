/**
 * Guided tours (Wave 2, N7 — design note docs/worlds/guided-tours-design-note.md,
 * Rev 123). A tour is a saved Chronicle route with a voice: a done Journey's
 * linked memories, in chronological order, with narration in the brain's own
 * plain words — nothing invented, nothing editorialized.
 *
 * Settled ground this module obeys:
 * - A tour is a visit, not a lesson. It never grades, never summarizes, never
 *   tells the traveler what anything means.
 * - A tour never starts unasked. Soumaya proposes; the traveler decides.
 *   Silence is never approval.
 * - Leaving a tour is free, instant, and unpunished. There is no "incomplete"
 *   state — a tour is not a task, so there is no progress to lose.
 * - Saved-tour changes go through the §17 rail shape (append-only log;
 *   undo is a compensating entry). Playback changes nothing saved.
 * - Fuel buys speed/spectacle, never access. Tour legs are ordinary travel
 *   (drift free, warp 10); home is free; slow free drift always exists.
 * - No UTC anywhere user-facing. Stop dates travel as raw stored strings;
 *   the client formats them in the viewer's own local time.
 * - Q1 (voice): text-first; audio follows when the read-aloud work lands.
 * - Q2 (cross-world): adopted — the route already is what it is; the ship
 *   flies it. Q3 (proposer): the ship only; Eternity does not propose tours.
 */

/** One stop on a tour: a memory, where it lives, and its own words. */
export interface TourStop {
  /** The memory's node id in the brain. */
  nodeId: number;
  /** World key the stop lives in ("deep-past" for a memory bead, "people"
   *  for a person cluster). Never a world the traveler hasn't discovered. */
  world: string;
  /** The memory's label, verbatim. */
  label: string;
  /** The memory's own words (its content), verbatim — the narration. */
  narration: string;
  /** When the memory happened, as stored (occurred_at, else created_at).
   *  Raw string; the client formats it in local time, or omits it. */
  occurredAt?: string;
}

/** A saved tour: a route plus its voice. The stops are a snapshot taken at
 *  creation — the tour is a saved route, and editing the brain never
 *  rewrites it (M2). Playback re-checks each stop's memory is still live
 *  and passes by archived or deleted ones with a plain line. */
export interface Tour {
  id: string;
  /** The done Journey this tour walks. */
  journeyId: number;
  title: string;
  stops: TourStop[];
  createdAt: string;
  updatedAt: string;
}

export type TourSessionState = "playing" | "ended";
/** How a session ended. "left" = the traveler stepped off (free, any time).
 *  "last-stop" = the route ran out — the tour rests there. */
export type TourEndedReason = "left" | "last-stop" | null;

/** Playback state for one tour. This is a position, not progress: no counts
 *  of done stops, no percentages, no score — the tour is not a task. */
export interface TourSession {
  tourId: string;
  state: TourSessionState;
  endedReason: TourEndedReason;
  /** Index into the tour's stops of the stop the traveler is on. */
  currentStopIndex: number;
  /** The travel journey carrying the traveler to the next stop, if one is
   *  armed or in flight. Null when the next stop is in the world the
   *  traveler is already in, or when no leg is running. */
  pendingLegJourneyId: string | null;
  /** Plain line when playback passed by a stop whose memory now rests in
   *  the archive or is gone. Null when nothing was passed by. */
  skippedNote: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** A session with its tour attached, plus the world the traveler is in —
 *  everything the panel needs in one read. */
export interface TourSessionView {
  session: TourSession;
  tour: Tour;
  /** The traveler's current world, server-derived from the journey ledger. */
  currentWorld: string;
}

/** A tour Soumaya proposes: a finished chapter whose memories run in
 *  order. A proposal is a live read, never a stored row — ignoring one
 *  creates nothing, and silence is never approval. */
export interface TourSuggestion {
  journeyId: number;
  title: string;
  stopCount: number;
  /** Plain-language reason, in the ship's voice. */
  reason: string;
}

/** What creating a tour returns: the tour, plus the memories that could
 *  not come along and why — stated once, plainly, never as locked stops
 *  inside the tour. */
export interface TourLeftOut {
  nodeId: number;
  label: string;
  reason: string;
}

export interface TourCreateResult {
  tour: Tour;
  leftOut: TourLeftOut[];
}

/** What starting or advancing a tour returns: the session, and the travel
 *  leg if one was armed (null when the stop is in the world the traveler
 *  is already in, or when the tour ended at its last stop). */
export interface TourMoveResult {
  session: TourSessionView;
  /** The armed leg, or null. The travel panel owns the leg from here:
   *  its cancel window, its arrival, its turn-back. */
  leg: import("./types.js").TravelJourney | null;
}
