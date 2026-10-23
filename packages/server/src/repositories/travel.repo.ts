import { randomUUID } from "node:crypto";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { EconomyRepo } from "../economy.js";
import {
  TRAVEL_CANCEL_WINDOW_SECONDS,
  WARP_COST,
  type TravelJourney,
  type TravelJourneyState,
  type TravelKind,
} from "@brain/shared";

/**
 * Worlds travel (Phase 2, P2-2): the server-side journey ledger and travel
 * state machine. The server — never the client — owns the cancel window,
 * the fuel charge, and every state transition; each transition and its
 * append-only event commit in ONE transaction.
 *
 * Lifecycle: depart() arms a cancellable intent (`arming`, event
 * `departure_armed`). The first action/read at or after the cancel deadline
 * SETTLES the journey lazily (the fuel-regen pattern): the warp charge (if
 * any) and the `departed` event commit together with the move to
 * `in_transit`; if the balance can no longer pay, the journey collapses to
 * a no-charge `cancelled` instead. From `in_transit` a journey is arrived
 * or turned back (`returning` → `returned`). P2-2 credits NO bonuses —
 * arrivals only record the facts P2-4 will pay on.
 *
 * Every transition re-reads and re-validates the journey INSIDE its own
 * immediate transaction and writes through a guarded update (the expected
 * state in the WHERE clause, exactly-one-row-checked): concurrent acts on
 * separate connections observe each other's committed state and return
 * it — they never both apply a transition, and an event is appended only
 * for a transition that actually committed.
 *
 * The current world is DERIVED from the latest journey (never a stored
 * pointer): arrived → its destination; returned/cancelled → its origin;
 * an active journey → its origin; no journeys → "home".
 *
 * (Unrelated to `JourneysRepo` — those journeys are life chapters.)
 */

/** World keys a Phase 2 journey may target. Server-side allow-list: a
 *  client-invented destination would corrupt the derived current world. */
export const TRAVEL_WORLD_KEYS: readonly string[] = ["home", "great-station"];
export const HOME_WORLD = "home";

export type TravelErrorCode =
  | "INVALID_CLIENT_KEY"
  | "INVALID_KIND"
  | "UNKNOWN_DESTINATION"
  | "ACTIVE_JOURNEY_EXISTS"
  | "JOURNEY_NOT_DEPARTED";

export class TravelError extends Error {
  constructor(
    readonly code: TravelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TravelError";
  }
}

interface JourneyRow {
  id: string;
  client_key: string;
  kind: TravelKind;
  origin: string;
  destination: string;
  state: TravelJourneyState;
  fuel_charged: number;
  created_at: string;
  cancel_deadline: string;
  departed_at: string | null;
  arrived_at: string | null;
  ended_at: string | null;
}

export interface TravelEvent {
  type: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

const TERMINAL: ReadonlySet<TravelJourneyState> = new Set(["arrived", "returned", "cancelled"]);

export class TravelRepo {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
  ) {}

  // --- row access (all space-scoped: another space's journeys are invisible) ---

  private rowById(id: string): JourneyRow | undefined {
    return this.h.sqlite
      .prepare(`SELECT * FROM travel_journeys WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as JourneyRow | undefined;
  }

  private rowByKey(clientKey: string): JourneyRow | undefined {
    return this.h.sqlite
      .prepare(`SELECT * FROM travel_journeys WHERE space_id = ? AND client_key = ?`)
      .get(this.spaceId, clientKey) as JourneyRow | undefined;
  }

  private activeRow(): JourneyRow | undefined {
    return this.h.sqlite
      .prepare(
        `SELECT * FROM travel_journeys WHERE space_id = ? AND state IN ('arming','in_transit','returning') ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(this.spaceId) as JourneyRow | undefined;
  }

  private latestRow(): JourneyRow | undefined {
    return this.h.sqlite
      .prepare(`SELECT * FROM travel_journeys WHERE space_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(this.spaceId) as JourneyRow | undefined;
  }

  private addEvent(journeyId: string, type: string, detail: Record<string, unknown> | null, nowMs: number): void {
    this.h.sqlite
      .prepare(`INSERT INTO travel_journey_events (journey_id, space_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(journeyId, this.spaceId, type, detail ? JSON.stringify(detail) : null, new Date(nowMs).toISOString());
  }

  private map(r: JourneyRow, nowMs: number): TravelJourney {
    return {
      id: r.id,
      kind: r.kind,
      origin: r.origin,
      destination: r.destination,
      state: r.state,
      fuelCharged: r.fuel_charged,
      cancellable: r.state === "arming" && nowMs < Date.parse(r.cancel_deadline),
      createdAt: r.created_at,
      cancelDeadline: r.cancel_deadline,
      departedAt: r.departed_at ?? undefined,
      arrivedAt: r.arrived_at ?? undefined,
      endedAt: r.ended_at ?? undefined,
    };
  }

  /** World derivation from a latest-row snapshot (no settling, no writes). */
  private deriveWorld(latest: JourneyRow | undefined): string {
    if (!latest) return HOME_WORLD;
    if (latest.state === "arrived") return latest.destination;
    return latest.origin; // active, returned, or cancelled: you are where you started this journey
  }

  currentWorld(nowMs: number = Date.now()): string {
    this.settleActive(nowMs);
    return this.deriveWorld(this.latestRow());
  }

  // --- settlement: the cancel window closes here, and only here ---

  /**
   * If the journey is still `arming` and its deadline has passed, close the
   * window in ONE transaction: charge (warp) + `departed` event + the move
   * to `in_transit` commit together — or, when the balance can no longer
   * pay, the journey becomes a no-charge `cancelled` with the reason in
   * its event. Returns the journey's current view either way.
   */
  settle(journeyId: string, nowMs: number = Date.now()): TravelJourney | null {
    const run = this.h.sqlite.transaction((): TravelJourney | null => {
      const r = this.rowById(journeyId);
      if (!r) return null;
      if (r.state !== "arming" || nowMs < Date.parse(r.cancel_deadline)) return this.map(r, nowMs);
      const nowIso = new Date(nowMs).toISOString();
      if (r.kind === "warp") {
        // Same connection: the debit joins this transaction.
        const paid = new EconomyRepo(this.h, this.spaceId).spendWarp();
        if (!paid) {
          this.h.sqlite
            .prepare(`UPDATE travel_journeys SET state = 'cancelled', ended_at = ? WHERE id = ?`)
            .run(nowIso, r.id);
          this.addEvent(r.id, "cancelled", { reason: "insufficient_at_window_close" }, nowMs);
          return this.map(this.rowById(r.id)!, nowMs);
        }
      }
      this.h.sqlite
        .prepare(`UPDATE travel_journeys SET state = 'in_transit', fuel_charged = ?, departed_at = ? WHERE id = ?`)
        .run(r.kind === "warp" ? WARP_COST : 0, nowIso, r.id);
      this.addEvent(r.id, "departed", { fuelCharged: r.kind === "warp" ? WARP_COST : 0 }, nowMs);
      return this.map(this.rowById(r.id)!, nowMs);
    });
    return run.immediate();
  }

  /** Settle the space's arming journey if one is past its deadline. */
  settleActive(nowMs: number = Date.now()): void {
    const active = this.activeRow();
    if (active && active.state === "arming") this.settle(active.id, nowMs);
  }

  // --- the travel acts ---

  /**
   * Arm a departure. Admission is atomic: the idempotency lookup, the
   * active-journey check, origin derivation, and creation (journey +
   * `departure_armed` event) run inside ONE immediate transaction, backed
   * by the partial unique index — two competing departures cannot both
   * be admitted. A retry with the same client key returns the original
   * journey, whatever parameters the retry carries.
   */
  depart(
    input: { clientKey: string; kind: TravelKind; destination: string },
    nowMs: number = Date.now(),
  ): TravelJourney {
    if (!input.clientKey) throw new TravelError("INVALID_CLIENT_KEY", "A departure needs a client key.");
    this.settleActive(nowMs);
    const admit = this.h.sqlite.transaction((): TravelJourney => {
      const existing = this.rowByKey(input.clientKey);
      if (existing) return this.map(existing, nowMs);
      // Validation guards CREATION only (audit F-01): a same-key retry
      // returns the original journey regardless of changed parameters —
      // including invalid ones — so kind and destination are checked
      // here, after the idempotency lookup, never before it.
      if (input.kind !== "warp" && input.kind !== "drift")
        throw new TravelError("INVALID_KIND", "A journey is either a warp or a drift.");
      if (!TRAVEL_WORLD_KEYS.includes(input.destination))
        throw new TravelError("UNKNOWN_DESTINATION", "That destination isn't on the chart yet.");
      if (this.activeRow())
        throw new TravelError("ACTIVE_JOURNEY_EXISTS", "A journey is already in progress — finish or cancel it first.");
      const origin = this.deriveWorld(this.latestRow());
      const id = randomUUID();
      const createdAt = new Date(nowMs).toISOString();
      const cancelDeadline = new Date(nowMs + TRAVEL_CANCEL_WINDOW_SECONDS * 1000).toISOString();
      this.h.sqlite
        .prepare(
          `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline)
           VALUES (?, ?, ?, ?, ?, ?, 'arming', 0, ?, ?)`,
        )
        .run(id, this.spaceId, input.clientKey, input.kind, origin, input.destination, createdAt, cancelDeadline);
      this.addEvent(id, "departure_armed", { kind: input.kind, destination: input.destination }, nowMs);
      return this.map(this.rowById(id)!, nowMs);
    });
    try {
      return admit.immediate();
    } catch (e) {
      // Database backstop fired (a competing admission committed first):
      // answer from the committed state, never a raw constraint error.
      const existing = this.rowByKey(input.clientKey);
      if (existing) return this.map(existing, nowMs);
      if (this.activeRow())
        throw new TravelError("ACTIVE_JOURNEY_EXISTS", "A journey is already in progress — finish or cancel it first.");
      throw e;
    }
  }

  /**
   * Guarded state change, called ONLY inside a transition transaction that
   * has just re-read the row: the UPDATE carries the expected current state
   * in its WHERE clause, so if a concurrent request already moved the
   * journey, this matches zero rows and nothing is written — the caller
   * then returns the actual committed state instead of appending an event
   * for a transition that never happened. Returns true iff exactly one
   * row changed.
   */
  private guardedUpdate(
    journeyId: string,
    fromState: TravelJourneyState,
    setSql: string,
    params: unknown[],
  ): boolean {
    const res = this.h.sqlite
      .prepare(`UPDATE travel_journeys SET ${setSql} WHERE id = ? AND state = ?`)
      .run(...params, journeyId, fromState);
    return res.changes === 1;
  }

  /** Cancel while the window is open: free, final, no charge ever. After
   *  settlement the journey has departed — the honest current state is
   *  returned instead of an error. The transition re-reads and re-validates
   *  inside its own immediate transaction (review 22): a concurrent act
   *  that committed first is observed, never overwritten. */
  cancel(journeyId: string, nowMs: number = Date.now()): TravelJourney | null {
    if (!this.settle(journeyId, nowMs)) return null;
    const run = this.h.sqlite.transaction((): TravelJourney | null => {
      const r = this.rowById(journeyId);
      if (!r) return null;
      if (r.state !== "arming") return this.map(r, nowMs);
      const nowIso = new Date(nowMs).toISOString();
      if (!this.guardedUpdate(journeyId, "arming", `state = 'cancelled', ended_at = ?`, [nowIso]))
        return this.map(this.rowById(journeyId)!, nowMs);
      this.addEvent(journeyId, "cancelled", { via: "cancel" }, nowMs);
      return this.map(this.rowById(journeyId)!, nowMs);
    });
    return run.immediate();
  }

  /** Turn back mid-transit: no refund, no second charge; the journey ends
   *  when it arrives back (`returning` → `returned`). Before departure it
   *  is simply a cancel. Same in-transaction re-validation as cancel(). */
  turnBack(journeyId: string, nowMs: number = Date.now()): TravelJourney | null {
    if (!this.settle(journeyId, nowMs)) return null;
    const run = this.h.sqlite.transaction((): TravelJourney | null => {
      const r = this.rowById(journeyId);
      if (!r) return null;
      const nowIso = new Date(nowMs).toISOString();
      if (r.state === "arming") {
        if (!this.guardedUpdate(journeyId, "arming", `state = 'cancelled', ended_at = ?`, [nowIso]))
          return this.map(this.rowById(journeyId)!, nowMs);
        this.addEvent(journeyId, "cancelled", { via: "turn_back" }, nowMs);
        return this.map(this.rowById(journeyId)!, nowMs);
      }
      if (r.state !== "in_transit") return this.map(r, nowMs);
      if (!this.guardedUpdate(journeyId, "in_transit", `state = 'returning'`, []))
        return this.map(this.rowById(journeyId)!, nowMs);
      this.addEvent(journeyId, "turned_back", {}, nowMs);
      return this.map(this.rowById(journeyId)!, nowMs);
    });
    return run.immediate();
  }

  /**
   * Arrive. Before actual departure (`arming`, window still open) arrival
   * is rejected — JOURNEY_NOT_DEPARTED, no mutation, no event, no charge:
   * fast-forwarding the window would let a stray request force a charge
   * and erase the user's cancel protection. The transition re-reads and
   * re-validates inside its own immediate transaction (review 22): two
   * concurrent arrivals produce exactly ONE `arrived` event — the second
   * observes the committed state and returns it. (P2-4's duplicate-bonus
   * protection builds on exactly this.)
   */
  arrive(journeyId: string, nowMs: number = Date.now()): TravelJourney | null {
    if (!this.settle(journeyId, nowMs)) return null;
    const run = this.h.sqlite.transaction((): TravelJourney | null => {
      const r = this.rowById(journeyId);
      if (!r) return null;
      if (r.state === "arming")
        throw new TravelError(
          "JOURNEY_NOT_DEPARTED",
          "This journey hasn't departed yet — its cancel window is still open.",
        );
      if (TERMINAL.has(r.state)) return this.map(r, nowMs);
      const nowIso = new Date(nowMs).toISOString();
      if (r.state === "returning") {
        if (
          !this.guardedUpdate(journeyId, "returning", `state = 'returned', arrived_at = ?, ended_at = ?`, [
            nowIso,
            nowIso,
          ])
        )
          return this.map(this.rowById(journeyId)!, nowMs);
        this.addEvent(journeyId, "returned", { kind: r.kind }, nowMs);
      } else {
        const durationSeconds = r.departed_at
          ? Math.max(0, Math.round((nowMs - Date.parse(r.departed_at)) / 1000))
          : null;
        if (
          !this.guardedUpdate(journeyId, "in_transit", `state = 'arrived', arrived_at = ?, ended_at = ?`, [
            nowIso,
            nowIso,
          ])
        )
          return this.map(this.rowById(journeyId)!, nowMs);
        this.addEvent(journeyId, "arrived", { kind: r.kind, durationSeconds }, nowMs);
      }
      return this.map(this.rowById(journeyId)!, nowMs);
    });
    return run.immediate();
  }

  getJourney(journeyId: string, nowMs: number = Date.now()): TravelJourney | null {
    return this.settle(journeyId, nowMs);
  }

  /** The state P2-3 renders: where the brain is, and its active journey. */
  getState(nowMs: number = Date.now()): { currentWorld: string; activeJourney: TravelJourney | null } {
    this.settleActive(nowMs);
    const active = this.activeRow();
    return {
      currentWorld: this.deriveWorld(this.latestRow()),
      activeJourney: active ? this.map(active, nowMs) : null,
    };
  }

  /** The append-only record for one journey (tests; future "World Changes"). */
  eventsFor(journeyId: string): TravelEvent[] {
    const rows = this.h.sqlite
      .prepare(`SELECT type, detail, created_at FROM travel_journey_events WHERE space_id = ? AND journey_id = ? ORDER BY id ASC`)
      .all(this.spaceId, journeyId) as { type: string; detail: string | null; created_at: string }[];
    return rows.map((r) => ({
      type: r.type,
      detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null,
      createdAt: r.created_at,
    }));
  }
}
