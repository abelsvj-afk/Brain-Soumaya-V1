import { randomUUID } from "node:crypto";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { parseTolerantMs } from "../lib/time.js";
import { JourneysRepo } from "./journeys.repo.js";
import { TravelRepo } from "./travel.repo.js";
import type {
  Tour,
  TourCreateResult,
  TourLeftOut,
  TourMoveResult,
  TourSession,
  TourSessionView,
  TourStop,
  TourSuggestion,
  TravelKind,
} from "@brain/shared";

/**
 * Guided tours (Wave 2, N7): a saved Chronicle route with a voice.
 *
 * Storage is the §17 rail shape: `tours` is the read model (the route +
 * its stops, snapshotted at creation), `tour_log` is append-only — one
 * entry per structural change (created / renamed / deleted / restored) —
 * and undo is a compensating entry (restored), never a rewrite. The row
 * and its log entry commit in ONE transaction, the travel pattern.
 * `tour_sessions` is playback state: a position, not progress.
 *
 * A tour is built from a DONE Journey's linked memories (kind "node"),
 * in chronological order (occurred_at, else created_at). The narration
 * is the memory's own words, verbatim. Stops live where the memories
 * live: a person node is a People cluster; any other memory is a bead
 * on the Deep Past's Chronicle thread. The Growing Place holds the same
 * memories as plots — visiting both worlds for one memory would repeat
 * the stop, so the tour never does (T-01).
 *
 * A tour never routes to a world the traveler hasn't discovered: while
 * the People gate is closed, person stops are left out at creation and
 * the response says so plainly, once — never as locked stops inside
 * the tour (T-05). Playback re-checks each stop's memory is still live
 * and passes by archived or deleted ones with a plain line; the saved
 * tour is unchanged (T-06).
 *
 * Legs are ordinary travel (T-02): drift by default — the walking pace,
 * free — or warp for 10 fuel when the traveler wants speed. The tour
 * never charges for leaving, for narration, or for coming home. A leg
 * is a TravelRepo journey, so the cancel window, the charge, and the
 * bonuses are the travel ledger's own — the tour adds no timing, no
 * charge, and no state of its own to them.
 */

export type TourErrorCode =
  | "JOURNEY_NOT_FOUND"
  | "JOURNEY_NOT_DONE"
  | "NO_STOPS"
  | "ALL_STOPS_RESTING"
  | "TOUR_NOT_FOUND"
  | "NO_ACTIVE_SESSION";

export class TourError extends Error {
  constructor(
    readonly code: TourErrorCode,
    message: string,
    readonly leftOut?: TourLeftOut[],
  ) {
    super(message);
    this.name = "TourError";
  }
}

const TOUR_LOG_KINDS = ["created", "renamed", "deleted", "restored"] as const;
type TourLogKind = (typeof TOUR_LOG_KINDS)[number];

interface NodeRow {
  id: number;
  label: string;
  type: string;
  content: string;
  kind: string | null;
  occurred_at: string | null;
  created_at: string;
  deleted_at: string | null;
  status: string | null;
}

interface TourRow {
  id: string;
  journey_id: number;
  title: string;
  stops: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface SessionRow {
  id: string;
  tour_id: string;
  state: "playing" | "ended";
  ended_reason: "left" | "last-stop" | null;
  current_stop_index: number;
  pending_leg_journey_id: string | null;
  pending_leg_target: number | null;
  leg_attempt: number;
  skipped_note: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

/** The person rule, shared with TravelRepo.peopleGateOpen: a person is a
 *  node the brain knows as one. */
function isPersonNode(r: NodeRow): boolean {
  return r.kind === "person_entity" || r.type === "person" || r.type === "relationship_reflection";
}

const SKIP_NOTE_ARCHIVED =
  "One stop is resting in the archive now, so the tour passes it by — nothing is lost; the tour itself is unchanged.";
const SKIP_NOTE_GONE =
  "One stop is gone from the brain now, so the tour passes it by — the tour itself is unchanged.";
const SKIP_NOTE_GATE =
  "One stop lives in the People, which isn't open right now, so the tour passes it by — the tour itself is unchanged.";

export class ToursRepo {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
  ) {}

  private travel(): TravelRepo {
    return new TravelRepo(this.h, this.spaceId);
  }

  private journeys(): JourneysRepo {
    return new JourneysRepo(this.h, this.spaceId);
  }

  // --- row access (all space-scoped) ---

  private tourRowById(id: string, includeDeleted = false): TourRow | undefined {
    return this.h.sqlite
      .prepare(
        `SELECT * FROM tours WHERE space_id = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
      )
      .get(this.spaceId, id) as TourRow | undefined;
  }

  private sessionRowById(id: string): SessionRow | undefined {
    return this.h.sqlite
      .prepare(`SELECT * FROM tour_sessions WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as SessionRow | undefined;
  }

  private latestSessionRow(tourId?: string): SessionRow | undefined {
    return this.h.sqlite
      .prepare(
        `SELECT * FROM tour_sessions WHERE space_id = ? ${tourId ? "AND tour_id = ?" : ""}
         ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
      )
      .get(this.spaceId, ...(tourId ? [tourId] : [])) as SessionRow | undefined;
  }

  private playingSessionRow(tourId?: string): SessionRow | undefined {
    return this.h.sqlite
      .prepare(
        `SELECT * FROM tour_sessions WHERE space_id = ? AND state = 'playing' ${tourId ? "AND tour_id = ?" : ""}
         ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
      )
      .get(this.spaceId, ...(tourId ? [tourId] : [])) as SessionRow | undefined;
  }

  private mapTour(r: TourRow): Tour {
    return {
      id: r.id,
      journeyId: r.journey_id,
      title: r.title,
      stops: JSON.parse(r.stops) as TourStop[],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapSession(r: SessionRow): TourSession {
    return {
      tourId: r.tour_id,
      state: r.state,
      endedReason: r.ended_reason,
      currentStopIndex: r.current_stop_index,
      pendingLegJourneyId: r.pending_leg_journey_id,
      skippedNote: r.skipped_note,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    };
  }

  private view(row: SessionRow, nowMs: number): TourSessionView {
    const tour = this.tourRowById(row.tour_id, true);
    if (!tour) throw new TourError("TOUR_NOT_FOUND", "That tour couldn't be found.");
    return {
      session: this.mapSession(row),
      tour: this.mapTour(tour),
      currentWorld: this.travel().currentWorld(nowMs),
    };
  }

  private appendLog(tourId: string, kind: TourLogKind, payload: Record<string, unknown> | null, nowMs: number): void {
    if (!TOUR_LOG_KINDS.includes(kind)) throw new Error(`Refused to log a tour change outside the allow-list: ${kind}`);
    this.h.sqlite
      .prepare(`INSERT INTO tour_log (tour_id, space_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tourId, this.spaceId, kind, payload ? JSON.stringify(payload) : null, new Date(nowMs).toISOString());
  }

  /** The rail, for tests and for "what changed, and when" reads. */
  logFor(tourId: string): { kind: string; payload: Record<string, unknown> | null; createdAt: string }[] {
    const rows = this.h.sqlite
      .prepare(`SELECT kind, payload, created_at FROM tour_log WHERE space_id = ? AND tour_id = ? ORDER BY id ASC`)
      .all(this.spaceId, tourId) as { kind: string; payload: string | null; created_at: string }[];
    return rows.map((r) => ({
      kind: r.kind,
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
      createdAt: r.created_at,
    }));
  }

  // --- stop derivation ---

  private nodeRow(nodeId: number): NodeRow | undefined {
    return this.h.sqlite
      .prepare(
        `SELECT id, label, type, content, kind, occurred_at, created_at, deleted_at, status
         FROM nodes WHERE space_id = ? AND id = ?`,
      )
      .get(this.spaceId, nodeId) as NodeRow | undefined;
  }

  /** Why a stop can't be walked right now, or null when it can. A stop
   *  whose memory is gone, archived, or behind a closed gate is passed
   *  by — never shown as a locked door. */
  private skipReason(stop: TourStop, gateOpen: boolean): string | null {
    const node = this.nodeRow(stop.nodeId);
    if (!node || node.deleted_at) return SKIP_NOTE_GONE;
    if (node.status === "archived") return SKIP_NOTE_ARCHIVED;
    if (stop.world === "people" && !gateOpen) return SKIP_NOTE_GATE;
    return null;
  }

  /**
   * The route for a done Journey: its linked memories, in chronological
   * order, with their own words. Memories that can't come along are
   * returned as leftOut with the plain reason — stated once at creation,
   * never as locked stops inside the tour.
   */
  deriveStops(journeyId: number): { stops: TourStop[]; leftOut: TourLeftOut[] } {
    const journey = this.journeys().get(journeyId);
    if (!journey) throw new TourError("JOURNEY_NOT_FOUND", "That chapter couldn't be found.");
    if (journey.status !== "done")
      throw new TourError(
        "JOURNEY_NOT_DONE",
        "A tour walks a finished chapter — this one isn't done yet. Mark it done first, and it can become a tour.",
      );
    const gateOpen = this.travel().peopleGateOpen();
    const links = this.journeys().links(journeyId).filter((l) => l.kind === "node");
    const stops: TourStop[] = [];
    const leftOut: TourLeftOut[] = [];
    for (const link of links) {
      const node = this.nodeRow(link.refId);
      const label = node?.label ?? `Memory ${link.refId}`;
      if (!node || node.deleted_at) {
        leftOut.push({ nodeId: link.refId, label, reason: "That memory is gone from the brain now." });
        continue;
      }
      if (node.status === "archived") {
        leftOut.push({ nodeId: link.refId, label, reason: "That memory is resting in the archive now." });
        continue;
      }
      const person = isPersonNode(node);
      if (person && !gateOpen) {
        leftOut.push({
          nodeId: link.refId,
          label,
          reason: "That memory lives in the People, which isn't open yet.",
        });
        continue;
      }
      stops.push({
        nodeId: node.id,
        world: person ? "people" : "deep-past",
        label: node.label,
        narration: node.content,
        occurredAt: node.occurred_at ?? node.created_at,
      });
    }
    // Chronological: when it happened, else when it was captured. Ties
    // break by node id, so the same chapter always walks the same way.
    const at = (s: TourStop): number => {
      const ms = parseTolerantMs(s.occurredAt);
      return Number.isFinite(ms) ? ms : Infinity;
    };
    stops.sort((a, b) => at(a) - at(b) || a.nodeId - b.nodeId);
    return { stops, leftOut };
  }

  // --- saved tours (the rail) ---

  create(journeyId: number, title?: string, nowMs: number = Date.now()): TourCreateResult {
    const { stops, leftOut } = this.deriveStops(journeyId);
    if (stops.length === 0) {
      throw new TourError(
        "NO_STOPS",
        "There's nothing to walk on this tour yet — every memory linked here is resting, gone, or in a world that isn't open yet.",
        leftOut,
      );
    }
    const journey = this.journeys().get(journeyId)!;
    const id = randomUUID();
    const nowIso = new Date(nowMs).toISOString();
    const run = this.h.sqlite.transaction(() => {
      this.h.sqlite
        .prepare(
          `INSERT INTO tours (id, space_id, journey_id, title, stops, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, this.spaceId, journeyId, title?.trim() || journey.title, JSON.stringify(stops), nowIso, nowIso);
      this.appendLog(id, "created", { journeyId, title: title?.trim() || journey.title, stops }, nowMs);
    });
    run.immediate();
    return { tour: this.mapTour(this.tourRowById(id)!) , leftOut };
  }

  list(): Tour[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT * FROM tours WHERE space_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC`,
      )
      .all(this.spaceId) as TourRow[];
    return rows.map((r) => this.mapTour(r));
  }

  get(id: string): Tour | null {
    const r = this.tourRowById(id);
    return r ? this.mapTour(r) : null;
  }

  rename(id: string, title: string, nowMs: number = Date.now()): Tour | null {
    const row = this.tourRowById(id);
    if (!row) return null;
    const nowIso = new Date(nowMs).toISOString();
    const run = this.h.sqlite.transaction(() => {
      this.h.sqlite
        .prepare(`UPDATE tours SET title = ?, updated_at = ? WHERE id = ? AND space_id = ?`)
        .run(title, nowIso, id, this.spaceId);
      this.appendLog(id, "renamed", { title }, nowMs);
    });
    run.immediate();
    return this.get(id);
  }

  /** Delete is a log entry plus a soft delete — the row stays, so the
   *  compensating entry (restore) can bring it back. Any playing
   *  session for the tour ends, free, in the same transaction. */
  remove(id: string, nowMs: number = Date.now()): boolean {
    const row = this.tourRowById(id);
    if (!row) return false;
    const nowIso = new Date(nowMs).toISOString();
    const run = this.h.sqlite.transaction(() => {
      this.h.sqlite
        .prepare(`UPDATE tours SET deleted_at = ?, updated_at = ? WHERE id = ? AND space_id = ?`)
        .run(nowIso, nowIso, id, this.spaceId);
      this.appendLog(id, "deleted", {}, nowMs);
      this.h.sqlite
        .prepare(
          `UPDATE tour_sessions SET state = 'ended', ended_reason = 'left', ended_at = ?, pending_leg_journey_id = NULL, pending_leg_target = NULL, updated_at = ?
           WHERE space_id = ? AND tour_id = ? AND state = 'playing'`,
        )
        .run(nowIso, nowIso, this.spaceId, id);
    });
    run.immediate();
    return true;
  }

  /** The compensating entry for a delete: the tour comes back unchanged. */
  restore(id: string, nowMs: number = Date.now()): Tour | null {
    const row = this.tourRowById(id, true);
    if (!row || !row.deleted_at) return null;
    const nowIso = new Date(nowMs).toISOString();
    const run = this.h.sqlite.transaction(() => {
      this.h.sqlite
        .prepare(`UPDATE tours SET deleted_at = NULL, updated_at = ? WHERE id = ? AND space_id = ?`)
        .run(nowIso, id, this.spaceId);
      this.appendLog(id, "restored", {}, nowMs);
    });
    run.immediate();
    return this.get(id);
  }

  /** Soumaya's proposals: finished chapters with memories to walk that
   *  don't already have a tour. A live read — no stored proposal rows,
   *  no dismissal state. Ignoring one creates nothing. */
  suggestions(): TourSuggestion[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT j.* FROM journeys j WHERE j.space_id = ? AND j.status = 'done'
         AND NOT EXISTS (SELECT 1 FROM tours t WHERE t.space_id = j.space_id AND t.journey_id = j.id AND t.deleted_at IS NULL)
         ORDER BY j.updated_at DESC`,
      )
      .all(this.spaceId) as { id: number; title: string }[];
    const out: TourSuggestion[] = [];
    for (const j of rows) {
      let stops: TourStop[];
      try {
        ({ stops } = this.deriveStops(j.id));
      } catch {
        continue;
      }
      if (stops.length === 0) continue;
      out.push({
        journeyId: j.id,
        title: j.title,
        stopCount: stops.length,
        reason: `“${j.title}” is finished, and its memories run in order — they would make a good tour.`,
      });
    }
    return out;
  }

  // --- playback (a position, not progress) ---

  /** The current session, if any — playing first, else the most recently
   *  updated. Reading settles a pending leg lazily, the travel pattern:
   *  an arrived leg advances the pointer; a cancelled or returned leg
   *  clears and the tour waits where it is. */
  session(nowMs: number = Date.now()): TourSessionView | null {
    const row = this.latestSessionRow();
    if (!row) return null;
    const settled = row.state === "playing" ? this.settle(row, nowMs) : row;
    return this.view(settled, nowMs);
  }

  /** Advance the pointer past stops that can't be walked now (archived,
   *  deleted, or behind a closed gate), starting at `from`. Returns the
   *  first walkable index, or stops.length when none is left, plus the
   *  plain note for the first stop passed by (or null when none were). */
  private skipDeadStops(tour: Tour, from: number, gateOpen: boolean): { index: number; note: string | null } {
    let index = from;
    let note: string | null = null;
    while (index < tour.stops.length) {
      const reason = this.skipReason(tour.stops[index]!, gateOpen);
      if (!reason) break;
      note ??= reason;
      index++;
    }
    return { index, note };
  }

  private endSession(row: SessionRow, reason: "left" | "last-stop", nowMs: number, note: string | null = null): SessionRow {
    const nowIso = new Date(nowMs).toISOString();
    this.h.sqlite
      .prepare(
        `UPDATE tour_sessions SET state = 'ended', ended_reason = ?, ended_at = ?, pending_leg_journey_id = NULL, pending_leg_target = NULL, skipped_note = ?, updated_at = ?
         WHERE id = ? AND space_id = ?`,
      )
      .run(reason, nowIso, note, nowIso, row.id, this.spaceId);
    return this.sessionRowById(row.id)!;
  }

  /**
   * Lazy settlement for one playing session. Reads the pending leg from
   * the travel ledger (which settles it — the leg's own cancel window
   * and charge are the ledger's business, never the tour's) and moves
   * the pointer, or clears the leg, or ends the tour at its last stop.
   */
  private settle(row: SessionRow, nowMs: number): SessionRow {
    if (row.state !== "playing" || !row.pending_leg_journey_id) return row;
    const leg = this.travel().getJourney(row.pending_leg_journey_id, nowMs);
    if (!leg) {
      this.h.sqlite
        .prepare(
          `UPDATE tour_sessions SET pending_leg_journey_id = NULL, pending_leg_target = NULL, updated_at = ? WHERE id = ? AND space_id = ?`,
        )
        .run(new Date(nowMs).toISOString(), row.id, this.spaceId);
      return this.sessionRowById(row.id)!;
    }
    if (leg.state === "arrived") {
      const tour = this.mapTour(this.tourRowById(row.tour_id, true)!);
      const gateOpen = this.travel().peopleGateOpen();
      // The leg's target is where the traveler now is: a start leg
      // targets the stop they're on (the pointer stays); an advance
      // leg targets the next stop (the pointer moves there). Either
      // way, stops that can't be walked now are passed by from there.
      const target = row.pending_leg_target ?? row.current_stop_index + 1;
      const { index, note } = this.skipDeadStops(tour, target, gateOpen);
      const nowIso = new Date(nowMs).toISOString();
      if (index >= tour.stops.length) return this.endSession(row, "last-stop", nowMs, note);
      this.h.sqlite
        .prepare(
          `UPDATE tour_sessions SET current_stop_index = ?, pending_leg_journey_id = NULL, pending_leg_target = NULL, skipped_note = ?, updated_at = ?
           WHERE id = ? AND space_id = ?`,
        )
        .run(index, note, nowIso, row.id, this.spaceId);
      return this.sessionRowById(row.id)!;
    }
    if (leg.state === "cancelled" || leg.state === "returned") {
      // The traveler turned back or cancelled the leg — the tour waits
      // at the current stop, free, unchanged.
      this.h.sqlite
        .prepare(
          `UPDATE tour_sessions SET pending_leg_journey_id = NULL, pending_leg_target = NULL, updated_at = ? WHERE id = ? AND space_id = ?`,
        )
        .run(new Date(nowMs).toISOString(), row.id, this.spaceId);
      return this.sessionRowById(row.id)!;
    }
    return row;
  }

  /** Arm a leg to the stop at `targetIndex`. The client key names the
   *  session, the stop, and the attempt — a retry replays to the same
   *  leg, and a fresh attempt after a cancelled leg gets a fresh key,
   *  so a cancelled leg can never be replayed as a live one. */
  private armLeg(row: SessionRow, tour: Tour, targetIndex: number, kind: TravelKind, nowMs: number) {
    const stop = tour.stops[targetIndex]!;
    const attempt = row.leg_attempt + 1;
    const leg = this.travel().depart(
      { clientKey: `tour:${row.id}:${targetIndex}:${attempt}`, kind, destination: stop.world },
      nowMs,
    );
    this.h.sqlite
      .prepare(
        `UPDATE tour_sessions SET pending_leg_journey_id = ?, pending_leg_target = ?, leg_attempt = ?, updated_at = ? WHERE id = ? AND space_id = ?`,
      )
      .run(leg.id, targetIndex, attempt, new Date(nowMs).toISOString(), row.id, this.spaceId);
    return leg;
  }

  /**
   * Start a tour — or resume it where the traveler stepped off (the
   * tour waits, unchanged). A finished tour starts fresh from its
   * first stop. One tour plays at a time: starting another leaves the
   * first, free. When the traveler isn't already in the first stop's
   * world, the ship arms the leg there — drift by default (free, the
   * walking pace), warp when the traveler asks for speed.
   */
  start(tourId: string, kind: TravelKind = "drift", nowMs: number = Date.now()): TourMoveResult {
    const tourRow = this.tourRowById(tourId);
    if (!tourRow) throw new TourError("TOUR_NOT_FOUND", "That tour couldn't be found.");
    const tour = this.mapTour(tourRow);
    // One tour at a time: starting another leaves the first, free — and
    // a leg of the first tour still inside its cancel window is
    // cancelled free with it, so the new tour can arm its own leg. A
    // leg already in flight is left to the traveler's own travel.
    const other = this.playingSessionRow();
    if (other && other.tour_id !== tourId) {
      if (other.pending_leg_journey_id) {
        const leg = this.travel().getJourney(other.pending_leg_journey_id, nowMs);
        if (leg?.state === "arming") this.travel().cancel(leg.id, nowMs);
      }
      this.endSession(other, "left", nowMs);
    }
    let row = this.latestSessionRow(tourId);
    if (row?.state === "playing") {
      row = this.settle(row, nowMs);
      if (row.state === "playing") {
        const leg = row.pending_leg_journey_id
          ? this.travel().getJourney(row.pending_leg_journey_id, nowMs)
          : null;
        return { session: this.view(row, nowMs), leg };
      }
    }
    const gateOpen = this.travel().peopleGateOpen();
    if (row?.state === "ended" && row.ended_reason === "left") {
      // Resume where the traveler stepped off — past any stop that
      // can't be walked now. If none is left, the tour rests.
      const { index, note } = this.skipDeadStops(tour, row.current_stop_index, gateOpen);
      if (index >= tour.stops.length) {
        row = this.endSession(row, "last-stop", nowMs, note);
        return { session: this.view(row, nowMs), leg: null };
      }
      const nowIso = new Date(nowMs).toISOString();
      this.h.sqlite
        .prepare(
          `UPDATE tour_sessions SET state = 'playing', ended_reason = NULL, ended_at = NULL, current_stop_index = ?, pending_leg_journey_id = NULL, pending_leg_target = NULL, skipped_note = ?, updated_at = ?
           WHERE id = ? AND space_id = ?`,
        )
        .run(index, note, nowIso, row.id, this.spaceId);
      row = this.sessionRowById(row.id)!;
    } else {
      // Fresh start (new tour, or one that ran to its last stop).
      const { index, note } = this.skipDeadStops(tour, 0, gateOpen);
      if (index >= tour.stops.length) {
        throw new TourError(
          "ALL_STOPS_RESTING",
          "Every stop on this tour is resting in the archive, gone, or out of reach right now — there's nowhere to walk yet.",
        );
      }
      const id = randomUUID();
      const nowIso = new Date(nowMs).toISOString();
      this.h.sqlite
        .prepare(
          `INSERT INTO tour_sessions (id, space_id, tour_id, state, current_stop_index, skipped_note, started_at, updated_at)
           VALUES (?, ?, ?, 'playing', ?, ?, ?, ?)`,
        )
        .run(id, this.spaceId, tourId, index, note, nowIso, nowIso);
      row = this.sessionRowById(id)!;
    }
    // The ship carries the traveler to the stop they're on, when they
    // aren't already in its world. Same world → no leg, no charge.
    const currentWorld = this.travel().currentWorld(nowMs);
    const stop = tour.stops[row.current_stop_index]!;
    const leg = stop.world !== currentWorld ? this.armLeg(row, tour, row.current_stop_index, kind, nowMs) : null;
    return { session: this.view(this.sessionRowById(row.id)!, nowMs), leg };
  }

  /**
   * Walk to the next stop. Same world → the pointer moves at once, no
   * leg, no charge. Another world → the ship arms the leg (drift by
   * default, warp when asked). At the last stop the tour ends, free —
   * the tour rests there.
   */
  advance(tourId: string, kind: TravelKind = "drift", nowMs: number = Date.now()): TourMoveResult {
    const tourRow = this.tourRowById(tourId);
    if (!tourRow) throw new TourError("TOUR_NOT_FOUND", "That tour couldn't be found.");
    const tour = this.mapTour(tourRow);
    let row = this.playingSessionRow(tourId);
    if (!row) throw new TourError("NO_ACTIVE_SESSION", "That tour isn't playing right now — start it first.");
    row = this.settle(row, nowMs);
    if (row.state !== "playing") return { session: this.view(row, nowMs), leg: null };
    const gateOpen = this.travel().peopleGateOpen();
    const { index, note } = this.skipDeadStops(tour, row.current_stop_index + 1, gateOpen);
    if (index >= tour.stops.length) {
      row = this.endSession(row, "last-stop", nowMs, note);
      return { session: this.view(row, nowMs), leg: null };
    }
    const nowIso = new Date(nowMs).toISOString();
    const currentWorld = this.travel().currentWorld(nowMs);
    const stop = tour.stops[index]!;
    if (stop.world === currentWorld) {
      this.h.sqlite
        .prepare(
          `UPDATE tour_sessions SET current_stop_index = ?, pending_leg_journey_id = NULL, pending_leg_target = NULL, skipped_note = ?, updated_at = ?
           WHERE id = ? AND space_id = ?`,
        )
        .run(index, note, nowIso, row.id, this.spaceId);
      return { session: this.view(this.sessionRowById(row.id)!, nowMs), leg: null };
    }
    const leg = this.armLeg(row, tour, index, kind, nowMs);
    if (note) {
      this.h.sqlite
        .prepare(`UPDATE tour_sessions SET skipped_note = ? WHERE id = ? AND space_id = ?`)
        .run(note, row.id, this.spaceId);
    }
    return { session: this.view(this.sessionRowById(row.id)!, nowMs), leg };
  }

  /**
   * Step off the tour: free, instant, unpunished. A leg still inside
   * its cancel window is cancelled free; a leg already in flight is
   * left to the traveler's own travel — arrive or turn back home as
   * usual. The saved tour is untouched, and the tour waits where the
   * traveler left it.
   */
  leave(tourId: string, nowMs: number = Date.now()): TourSessionView {
    const row = this.playingSessionRow(tourId);
    if (!row) throw new TourError("NO_ACTIVE_SESSION", "That tour isn't playing right now.");
    if (row.pending_leg_journey_id) {
      const leg = this.travel().getJourney(row.pending_leg_journey_id, nowMs);
      if (leg?.state === "arming") this.travel().cancel(leg.id, nowMs);
    }
    return this.view(this.endSession(row, "left", nowMs), nowMs);
  }
}
