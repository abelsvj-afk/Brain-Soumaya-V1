import { randomUUID } from "node:crypto";
import { isOwnerSpace } from "../auth/owner.js";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { EconomyRepo, type JourneyBonusCreditor, type JourneyBonusResult } from "../economy.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import {
  EARN_JOURNEY_COMPLETE,
  EARN_JOURNEY_DRIFT,
  ETERNITY_CHAIN_INTERMEDIATES,
  ETERNITY_CHAIN_LEGS,
  ETERNITY_WORLD_KEY,
  NO_ETERNITY_HOLDINGS,
  PEOPLE_GATE_MIN_MEMORIES_EACH,
  PEOPLE_GATE_MIN_PEOPLE,
  PEOPLE_GATE_MIN_SHARED_MEMORIES,
  TRAVEL_CANCEL_WINDOW_SECONDS,
  warpCost,
  eternityGateOpens,
  type EternityGateHoldings,
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
 * or turned back (`returning` → `returned`). P2-2 credited no bonuses;
 * P2-4 pays them inside the arrival transition itself (see arrive()).
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

/** World keys a journey may target. Server-side allow-list: a
 *  client-invented destination would corrupt the derived current world.
 *  Phase 3 (P3-1) adds the Growing Place — the first memory-bearing world.
 *  P3-2 adds the Deep Past; P3-3 adds the People (gated — see
 *  peopleGateOpen: the key alone does not admit travel there). Wave 2
 *  adds Quiet/Archive — ungated: any traveller may visit, and an empty
 *  archive renders the still field itself (the note's C1–C3). Wave 2
 *  also adds Scale — ungated, public: the real ISS at real size.
 *  Eternity's world joins the list as a GATED world (B-01): it is on the
 *  chart, but depart() admits it only through the gate below — the
 *  allow-list alone never opens the way there. */
export const TRAVEL_WORLD_KEYS: readonly string[] = ["home", "great-station", "growing-place", "deep-past", "people", "quiet-archive", "scale", ETERNITY_WORLD_KEY];
export const HOME_WORLD = "home";

/** Plain-language refusals for the Eternity gate (B-01): a closed gate
 *  or a short chain is never an error in the traveller's record — the
 *  journey simply is not admitted, and the server says what the way
 *  needs. Nothing is charged, nothing is lost, nothing is lesser. */
export const ETERNITY_GATE_CLOSED_MESSAGE =
  "The way to Eternity's world opens only for those carrying the Witness Without a Name and two other relics — the gate has not opened for you yet.";
export const ETERNITY_CHAIN_REQUIRED_MESSAGE = `The way to Eternity's world runs through ${ETERNITY_CHAIN_INTERMEDIATES} other worlds first — travel there step by step, and the last leg opens from the far end of the chain.`;

export type TravelErrorCode =
  | "INVALID_CLIENT_KEY"
  | "INVALID_KIND"
  | "UNKNOWN_DESTINATION"
  | "PEOPLE_GATE_CLOSED"
  | "ACTIVE_JOURNEY_EXISTS"
  | "JOURNEY_NOT_DEPARTED"
  | "ETERNITY_GATE_CLOSED"
  | "ETERNITY_CHAIN_REQUIRED";

export class TravelError extends Error {
  constructor(
    readonly code: TravelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TravelError";
  }
}

/**
 * Journey bonuses (P2-4, implementing the P2-1 JourneyBonusCreditor
 * contract): paid server-side at arrival, exactly once per journey. The
 * outcome is recorded ON the journey row (bonus_credited_at /
 * bonus_amount / bonus_reason) inside the arrival transaction, so a
 * retried arrival returns the recorded outcome and never re-pays.
 *
 * The drift gate constrains the BONUS only — never the travel (D-1):
 * a drift must show at least DRIFT_BONUS_MIN_ELAPSED_MS of server-side
 * elapsed time and the space may earn at most DRIFT_BONUS_DAILY_CAP
 * drift bonuses per day, counted in the space's own timezone. A warp
 * needs no gate: it costs 10 and pays 5, so farming loses fuel by
 * construction. An ineligible arrival is not an error and never a
 * punishment: the journey completes; the bonus simply doesn't pay,
 * and the server says why in plain language.
 */
export const DRIFT_BONUS_MIN_ELAPSED_MS = 30_000;
export const DRIFT_BONUS_DAILY_CAP = 2;

const BONUS_REASON_TOO_SHORT =
  "That drift was quick — drift bonuses are for journeys of at least half a minute.";
const BONUS_REASON_DAILY_CAP =
  "Today's drift bonuses are done — drifting itself is still free.";

/** The recorded bonus outcome for one journey: the contract result
 *  plus the server's plain-language reason when nothing was paid. */
export interface TravelBonusOutcome extends JourneyBonusResult {
  reason: string | null;
}

/** YYYY-MM-DD of an instant in a timezone (the space-local day key the
 *  drift cap counts by — never a UTC boundary). Falls back to the UTC
 *  date when the zone name is unusable. */
function localDateKey(tz: string, ms: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
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
  bonus_credited_at: string | null;
  bonus_amount: number;
  bonus_reason: string | null;
}

export interface TravelEvent {
  type: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

const TERMINAL: ReadonlySet<TravelJourneyState> = new Set(["arrived", "returned", "cancelled"]);

export class TravelRepo implements JourneyBonusCreditor {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
    /**
     * Relic holdings for the Eternity gate (B-01). The relic increment
     * owns the source of truth (discovery + codex) and supplies it
     * here; the default is "holds nothing", so the gate is honestly
     * closed until that wiring lands. The provider is read inside the
     * departure transaction, so a holdings change between admission
     * and arrival cannot smuggle a traveller through.
     */
    private holdings: () => EternityGateHoldings = () => NO_ETERNITY_HOLDINGS,
  ) {}

  /** Arrived journeys for this space, newest first — the chain walk's input. */
  private arrivedRowsNewest(): JourneyRow[] {
    return this.h.sqlite
      .prepare(
        `SELECT * FROM travel_journeys WHERE space_id = ? AND state = 'arrived' ORDER BY created_at DESC, rowid DESC`,
      )
      .all(this.spaceId) as JourneyRow[];
  }

  /**
   * B-01, persistence half: once the gate has opened for a traveller
   * it stays open to them. "Opened" is derivable — an arrived journey
   * to Eternity's world — so no new table and no migration carries it:
   * the ledger itself remembers the first crossing.
   */
  eternityGateOpened(): boolean {
    const row = this.h.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM travel_journeys WHERE space_id = ? AND destination = ? AND state = 'arrived'`,
      )
      .get(this.spaceId, ETERNITY_WORLD_KEY) as { n: number };
    return row.n > 0;
  }

  /** The gate is open for this traveller: opened before, or the
   *  holdings satisfy B-01 right now (key + any two other relics). */
  eternityGateReachable(): boolean {
    // Owner access: the deployment owner's brain is exempt from the relic
    // gate (see auth/owner.ts) — it is an earned-progression gate.
    if (isOwnerSpace(this.spaceId)) return true;
    return this.eternityGateOpened() || eternityGateOpens(this.holdings());
  }

  /**
   * B-01, chain half: the journey to Eternity's world is the last leg
   * of a three-leg chain through at least two intermediate worlds. The
   * current outing — the arrived legs since the traveller last left
   * home — must hold at least two legs through at least two distinct
   * non-home worlds, and the traveller must be standing at the far end
   * of it (not home). A turn-back or a cancellation breaks the chain:
   * only arrived legs count, and the walk stops at the leg that left
   * home. Pure over the ledger rows — no new state.
   */
  eternityChainSatisfied(): boolean {
    // Owner access: no three-leg chain to walk first (auth/owner.ts). Only
    // the chain is waived — a departure to the world you are already in is
    // still refused, owner or not.
    if (isOwnerSpace(this.spaceId)) return this.deriveWorld(this.latestRow()) !== ETERNITY_WORLD_KEY;
    const latest = this.latestRow();
    if (!latest) return false;
    if (this.deriveWorld(latest) === HOME_WORLD) return false;
    if (this.deriveWorld(latest) === ETERNITY_WORLD_KEY) return false;
    const arrived = this.arrivedRowsNewest();
    let legs = 0;
    const intermediates = new Set<string>();
    for (const row of arrived) {
      legs++;
      if (row.destination !== HOME_WORLD && row.destination !== ETERNITY_WORLD_KEY)
        intermediates.add(row.destination);
      if (row.origin === HOME_WORLD) break;
    }
    return legs >= ETERNITY_CHAIN_LEGS - 1 && intermediates.size >= ETERNITY_CHAIN_INTERMEDIATES;
  }

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
      // Fuel follows distance (owner 2026-10-30): the price of THIS leg, origin → destination; a warp home is free.
      const price = r.kind === "warp" ? warpCost(r.origin, r.destination) : 0;
      if (r.kind === "warp") {
        // Same connection: the debit joins this transaction.
        const paid = new EconomyRepo(this.h, this.spaceId).spendWarp(price);
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
        .run(price, nowIso, r.id);
      this.addEvent(r.id, "departed", { fuelCharged: price }, nowMs);
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
      // The People gate (P3-3, Q1) is enforced here, on the server, never
      // by the client: a departure to People is admitted only while the
      // brain meets the threshold. A same-key retry still returns the
      // original journey (the F-01 replay contract above) — the gate
      // guards creation, not replay.
      if (input.destination === "people" && !this.peopleGateOpen())
        throw new TravelError(
          "PEOPLE_GATE_CLOSED",
          "The People isn't open yet — it appears once your brain holds at least three people with two linked memories each, and one memory shared between two of them.",
        );
      // B-01 (Eternity's gate): the allow-list admits the world onto
      // the chart, but only the gate admits a traveller to it. The
      // credential first (key + two relics, or opened before), then the
      // chain (three legs through two intermediates). Either refusal
      // writes nothing and charges nothing — the traveller simply stays
      // where they are, and the server says what the way needs.
      if (input.destination === ETERNITY_WORLD_KEY) {
        if (!this.eternityGateReachable())
          throw new TravelError("ETERNITY_GATE_CLOSED", ETERNITY_GATE_CLOSED_MESSAGE);
        if (!this.eternityChainSatisfied())
          throw new TravelError("ETERNITY_CHAIN_REQUIRED", ETERNITY_CHAIN_REQUIRED_MESSAGE);
      }
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
        // P2-4: the bonus outcome is DECIDED here — by the one call
        // that wins the arrival transition — and recorded on the row
        // in the same guarded update, so arrival, decision, and
        // credit commit or fail together. A concurrent arrival that
        // loses the race observes the recorded outcome; it never
        // re-decides and never re-pays.
        const bonus = this.decideBonus(r, nowMs);
        if (
          !this.guardedUpdate(
            journeyId,
            "in_transit",
            `state = 'arrived', arrived_at = ?, ended_at = ?, bonus_credited_at = ?, bonus_amount = ?, bonus_reason = ?`,
            [nowIso, nowIso, nowIso, bonus.amount, bonus.reason],
          )
        )
          return this.map(this.rowById(journeyId)!, nowMs);
        if (bonus.amount > 0) new EconomyRepo(this.h, this.spaceId).add(bonus.amount);
        this.addEvent(
          journeyId,
          "arrived",
          { kind: r.kind, durationSeconds, bonusAmount: bonus.amount, bonusReason: bonus.reason },
          nowMs,
        );
      }
      return this.map(this.rowById(journeyId)!, nowMs);
    });
    return run.immediate();
  }

  // --- journey bonuses (P2-4) ---

  /** Eligibility, from the ledger alone. Warp: always pays. Drift:
   *  the honesty floor on server elapsed time, then the space-local
   *  daily cap. Returns the amount and, when nothing pays, the plain
   *  reason the UI may show. */
  private decideBonus(r: JourneyRow, nowMs: number): { amount: number; reason: string | null } {
    if (r.kind === "warp") return { amount: EARN_JOURNEY_COMPLETE, reason: null };
    const departedMs = r.departed_at ? Date.parse(r.departed_at) : Number.NaN;
    if (!Number.isFinite(departedMs) || nowMs - departedMs < DRIFT_BONUS_MIN_ELAPSED_MS)
      return { amount: 0, reason: BONUS_REASON_TOO_SHORT };
    if (this.driftBonusesToday(nowMs) >= DRIFT_BONUS_DAILY_CAP)
      return { amount: 0, reason: BONUS_REASON_DAILY_CAP };
    return { amount: EARN_JOURNEY_DRIFT, reason: null };
  }

  /** Drift bonuses already credited on the space-local day of nowMs. */
  private driftBonusesToday(nowMs: number): number {
    const tz = spaceTimezone(this.h.sqlite, this.spaceId);
    const today = localDateKey(tz, nowMs);
    const rows = this.h.sqlite
      .prepare(
        `SELECT bonus_credited_at FROM travel_journeys
         WHERE space_id = ? AND kind = 'drift' AND bonus_amount > 0 AND bonus_credited_at IS NOT NULL`,
      )
      .all(this.spaceId) as { bonus_credited_at: string }[];
    return rows.filter((x) => localDateKey(tz, Date.parse(x.bonus_credited_at)) === today).length;
  }

  /** The recorded outcome for a journey (null when the journey is
   *  unknown). Before any arrival the outcome is simply "not credited"
   *  at the current balance. */
  bonusOutcome(journeyId: string): TravelBonusOutcome | null {
    const r = this.rowById(journeyId);
    if (!r) return null;
    const amount = r.bonus_amount ?? 0;
    return {
      credited: amount > 0,
      amount,
      balance: new EconomyRepo(this.h, this.spaceId).get(),
      reason: r.bonus_reason ?? null,
    };
  }

  /**
   * The P2-1 contract (JourneyBonusCreditor). Crediting itself happens
   * in arrive()'s transaction; this entry point returns the recorded
   * outcome, and for a legacy arrival that predates P2-4 (arrived, no
   * outcome recorded) it decides and records the outcome now, guarded
   * so concurrent calls credit at most once. The row is the authority
   * on kind — the parameter is accepted per the contract, and the
   * journey's own recorded kind governs.
   */
  creditJourneyBonus(journeyId: string, _kind: TravelKind): JourneyBonusResult {
    const econ = new EconomyRepo(this.h, this.spaceId);
    const existing = this.bonusOutcome(journeyId);
    if (!existing) return { credited: false, amount: 0, balance: econ.get() };
    const r = this.rowById(journeyId)!;
    if (r.bonus_credited_at || r.state !== "arrived") return existing;
    const run = this.h.sqlite.transaction(() => {
      const fresh = this.rowById(journeyId);
      if (!fresh || fresh.bonus_credited_at || fresh.state !== "arrived") return;
      const nowMs = Date.now();
      const bonus = this.decideBonus(fresh, nowMs);
      this.h.sqlite
        .prepare(
          `UPDATE travel_journeys SET bonus_credited_at = ?, bonus_amount = ?, bonus_reason = ?
           WHERE id = ? AND bonus_credited_at IS NULL`,
        )
        .run(new Date(nowMs).toISOString(), bonus.amount, bonus.reason, journeyId);
      if (bonus.amount > 0) new EconomyRepo(this.h, this.spaceId).add(bonus.amount);
    });
    run.immediate();
    return this.bonusOutcome(journeyId)!;
  }

  getJourney(journeyId: string, nowMs: number = Date.now()): TravelJourney | null {
    return this.settle(journeyId, nowMs);
  }

  /** The state P2-3 renders: where the brain is, and its active journey.
   *  `peopleGateOpen` tells the board whether the People gate stands open
   *  (Q1, P3-3) — the board offers People only when the server says so;
   *  the client never decides. `eternityReachable` tells the board
   *  whether the gate to Eternity's world stands open for this traveller
   *  (opened before, or the holdings satisfy B-01 now) — the board
   *  offers the world only then, so it never offers a journey the server
   *  would refuse. */
  getState(nowMs: number = Date.now()): {
    currentWorld: string;
    activeJourney: TravelJourney | null;
    /** Whether the People gate is open (Q1, P3-3) — the board offers
     *  People only when the server says so; the client never decides. */
    peopleGateOpen: boolean;
    eternityReachable: boolean;
  } {
    this.settleActive(nowMs);
    const active = this.activeRow();
    return {
      currentWorld: this.deriveWorld(this.latestRow()),
      activeJourney: active ? this.map(active, nowMs) : null,
      peopleGateOpen: this.peopleGateOpen(),
      eternityReachable: this.eternityGateReachable(),
    };
  }

  /**
   * The People gate (P3-3, Q1 — settled by the build-all delegation,
   * 2026-10-26): the gate is open when the brain holds at least
   * PEOPLE_GATE_MIN_PEOPLE people with at least
   * PEOPLE_GATE_MIN_MEMORIES_EACH linked memories each, plus at least
   * PEOPLE_GATE_MIN_SHARED_MEMORIES memories shared between two people.
   * A "person" is a node the brain knows as one — `kind =
   * 'person_entity'` (the tracked person) or extraction-typed `type =
   * 'person'` (the legacy `relationship_reflection` alias included, the
   * same rule the web layout applies via normalizeNodeType). A "linked
   * memory" is an incident edge to a live, non-archived, non-person node.
   * Archived people never count (P4 — the archive wins everywhere), and
   * a person linked only to another person has no linked memory.
   * This reads the database, never the client's graph window — the
   * overview caps at 300 nodes, so the window can hold fewer people than
   * the brain does.
   */
  peopleGateOpen(): boolean {
    // Owner access: the deployment owner's brain is exempt (auth/owner.ts).
    if (isOwnerSpace(this.spaceId)) return true;
    const personWhere = `(kind = 'person_entity' OR type = 'person' OR type = 'relationship_reflection')`;
    // Null-safe negation: a memory node has kind NULL, and in SQLite
    // `NOT (NULL = 'person_entity')` is NULL, not true — a bare NOT
    // would silently drop every kind-less memory from this set and the
    // gate could never open. Spell the complement out instead.
    const nonPersonWhere = `((kind IS NULL OR kind <> 'person_entity') AND type <> 'person' AND type <> 'relationship_reflection')`;
    const people = this.h.sqlite
      .prepare(
        `SELECT id FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND status IS NOT 'archived' AND ${personWhere}`,
      )
      .all(this.spaceId) as { id: number }[];
    if (people.length < PEOPLE_GATE_MIN_PEOPLE) return false;
    const personIds = new Set(people.map((p) => p.id));
    const others = this.h.sqlite
      .prepare(
        `SELECT id FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND status IS NOT 'archived' AND ${nonPersonWhere}`,
      )
      .all(this.spaceId) as { id: number }[];
    const otherIds = new Set(others.map((o) => o.id));
    const placeholders = [...personIds].map(() => "?").join(",");
    const edges = this.h.sqlite
      .prepare(
        `SELECT source, target FROM edges WHERE space_id = ? AND (source IN (${placeholders}) OR target IN (${placeholders}))`,
      )
      .all(this.spaceId, ...personIds, ...personIds) as { source: number; target: number }[];
    const memoryCounts = new Map<number, Set<number>>();
    const personsByMemory = new Map<number, Set<number>>();
    for (const e of edges) {
      for (const [personSide, otherSide] of [
        [e.source, e.target],
        [e.target, e.source],
      ] as const) {
        if (!personIds.has(personSide) || !otherIds.has(otherSide)) continue;
        const mems = memoryCounts.get(personSide) ?? new Set<number>();
        mems.add(otherSide);
        memoryCounts.set(personSide, mems);
        const persons = personsByMemory.get(otherSide) ?? new Set<number>();
        persons.add(personSide);
        personsByMemory.set(otherSide, persons);
      }
    }
    let qualifying = 0;
    for (const mems of memoryCounts.values()) {
      if (mems.size >= PEOPLE_GATE_MIN_MEMORIES_EACH) qualifying++;
    }
    let shared = 0;
    for (const persons of personsByMemory.values()) {
      if (persons.size >= 2) shared++;
    }
    return qualifying >= PEOPLE_GATE_MIN_PEOPLE && shared >= PEOPLE_GATE_MIN_SHARED_MEMORIES;
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
