import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { EconomyRepo, FUEL_CAP, EARN_JOURNEY_COMPLETE, EARN_JOURNEY_DRIFT } from "../economy.js";
import {
  TravelRepo,
  DRIFT_BONUS_MIN_ELAPSED_MS,
  DRIFT_BONUS_DAILY_CAP,
} from "../repositories/travel.repo.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { TravelKind } from "@brain/shared";

/**
 * P2-4 (Worlds Phase 2): journey bonuses. Acceptance: C1 exactly once,
 * C2 atomicity (arrival + outcome + credit in one transaction — asserted
 * here through observable state), C3 the drift gate (honesty floor,
 * space-local daily cap, bonus-only — travel is never gated), C4 the
 * outcome the client displays comes from the server's record.
 * Time is injected at repo level; balances use a small tolerance for
 * EconomyRepo's real-time regen (same convention as travel.test.ts).
 */
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const past = (deadlineIso: string) => Date.parse(deadlineIso) + 1000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const travel = (space = "spaceA") => new TravelRepo(handle, space);
const econ = (space = "spaceA") => new EconomyRepo(handle, space);

function setTimezone(space: string, tz: string) {
  econ(space).get(); // ensure the space_meta row exists
  handle.sqlite.prepare(`UPDATE space_meta SET timezone = ? WHERE space_id = ?`).run(tz, space);
}

/** Drive one journey to arrival at a destination. Returns the journey id.
 *  `transitMs` is the server-elapsed time between departure settlement
 *  and arrival — what the drift honesty floor reads. */
function completeJourney(
  t: TravelRepo,
  key: string,
  kind: TravelKind,
  destination: string,
  departMs: number,
  transitMs: number,
): string {
  const j = t.depart({ clientKey: key, kind, destination }, departMs);
  const settled = t.settle(j.id, past(j.cancelDeadline));
  const departedMs = Date.parse(settled!.departedAt!);
  const arrived = t.arrive(j.id, departedMs + transitMs);
  expect(arrived?.state).toBe("arrived");
  return j.id;
}

describe("C1 — exactly once", () => {
  it("a warp arrival credits +5 once; a retried arrival returns the recorded outcome and never re-pays", () => {
    const t = travel();
    const id = completeJourney(t, "w1", "warp", "great-station", T0, 60_000);
    const afterFirst = econ().get();
    const outcome = t.bonusOutcome(id);
    expect(outcome?.credited).toBe(true);
    expect(outcome?.amount).toBe(EARN_JOURNEY_COMPLETE);
    expect(outcome?.reason).toBeNull();

    const retry = t.arrive(id, T0 + 3_600_000);
    expect(retry?.state).toBe("arrived");
    expect(econ().get()).toBeCloseTo(afterFirst, 1); // no second credit (regen aside)
    expect(t.bonusOutcome(id)?.amount).toBe(EARN_JOURNEY_COMPLETE);
    expect(t.eventsFor(id).filter((e) => e.type === "arrived")).toHaveLength(1);
  });

  it("creditJourneyBonus (the P2-1 contract) returns the recorded outcome without re-paying", () => {
    const t = travel();
    const id = completeJourney(t, "w2", "warp", "great-station", T0, 60_000);
    const before = econ().get();
    const res = t.creditJourneyBonus(id, "warp");
    expect(res.credited).toBe(true);
    expect(res.amount).toBe(EARN_JOURNEY_COMPLETE);
    expect(econ().get()).toBeCloseTo(before, 1);
  });

  it("a legacy arrival with no recorded outcome is decided once by creditJourneyBonus", () => {
    const t = travel();
    // A pre-P2-4 arrival: insert the arrived row directly, marker unset.
    handle.sqlite
      .prepare(
        `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline, departed_at, arrived_at, ended_at)
         VALUES ('legacy-1', 'spaceA', 'legacy-k', 'warp', 'home', 'great-station', 'arrived', 10, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date(T0).toISOString(),
        new Date(T0 + 10_000).toISOString(),
        new Date(T0 + 11_000).toISOString(),
        new Date(T0 + 71_000).toISOString(),
        new Date(T0 + 71_000).toISOString(),
      );
    const before = econ().get();
    const first = t.creditJourneyBonus("legacy-1", "warp");
    expect(first.credited).toBe(true);
    expect(first.amount).toBe(EARN_JOURNEY_COMPLETE);
    expect(econ().get()).toBeCloseTo(before + EARN_JOURNEY_COMPLETE, 1);
    const second = t.creditJourneyBonus("legacy-1", "warp");
    expect(second.amount).toBe(EARN_JOURNEY_COMPLETE);
    expect(econ().get()).toBeCloseTo(before + EARN_JOURNEY_COMPLETE, 1);
  });
});

describe("C3 — the drift gate (bonus only, never the travel)", () => {
  it("an honest drift (≥30s server elapsed) credits +3", () => {
    const t = travel();
    const id = completeJourney(t, "d1", "drift", "great-station", T0, DRIFT_BONUS_MIN_ELAPSED_MS);
    const outcome = t.bonusOutcome(id);
    expect(outcome?.credited).toBe(true);
    expect(outcome?.amount).toBe(EARN_JOURNEY_DRIFT);
  });

  it("a scripted instant drift arrives fine and earns 0, with the plain reason", () => {
    const t = travel();
    const before = econ().get();
    const id = completeJourney(t, "d2", "drift", "great-station", T0, 1_000);
    const outcome = t.bonusOutcome(id);
    expect(outcome?.credited).toBe(false);
    expect(outcome?.amount).toBe(0);
    expect(outcome?.reason).toMatch(/half a minute/);
    expect(econ().get()).toBeCloseTo(before, 1); // drift was free; no bonus moved
    expect(t.currentWorld(T0 + 3_600_000)).toBe("great-station"); // the travel itself worked
  });

  it(`the ${DRIFT_BONUS_DAILY_CAP}-per-day cap: a third eligible drift earns 0 with the cap reason and still travels`, () => {
    const t = travel();
    const a = completeJourney(t, "d3a", "drift", "great-station", T0, 31_000);
    const b = completeJourney(t, "d3b", "drift", "home", T0 + 120_000, 31_000);
    expect(t.bonusOutcome(a)?.amount).toBe(EARN_JOURNEY_DRIFT);
    expect(t.bonusOutcome(b)?.amount).toBe(EARN_JOURNEY_DRIFT);
    const c = completeJourney(t, "d3c", "drift", "great-station", T0 + 240_000, 31_000);
    const outcome = t.bonusOutcome(c);
    expect(outcome?.credited).toBe(false);
    expect(outcome?.amount).toBe(0);
    expect(outcome?.reason).toMatch(/still free/);
  });

  it("the cap counts the space's own local day (America/New_York), not UTC", () => {
    setTimezone("spaceA", "America/New_York");
    const t = travel();
    // Oct 22 in New York (EDT, UTC-4): two eligible drifts that evening.
    const evening = Date.parse("2026-10-22T23:00:00.000Z"); // 19:00 ET, Oct 22
    const a = completeJourney(t, "etz-a", "drift", "great-station", evening, 31_000);
    const b = completeJourney(t, "etz-b", "drift", "home", evening + 120_000, 31_000);
    expect(t.bonusOutcome(a)?.amount).toBe(EARN_JOURNEY_DRIFT);
    expect(t.bonusOutcome(b)?.amount).toBe(EARN_JOURNEY_DRIFT);
    // 2026-10-23T01:00Z is Oct 23 in UTC but still Oct 22 in New York:
    // the cap must still hold (a UTC boundary would wrongly pay here).
    const c = completeJourney(t, "etz-c", "drift", "great-station", Date.parse("2026-10-23T00:58:00.000Z"), 31_000);
    expect(t.bonusOutcome(c)?.amount).toBe(0);
    expect(t.bonusOutcome(c)?.reason).toMatch(/still free/);
    // After New York midnight (04:00Z) the cap resets and a drift pays.
    const d = completeJourney(t, "etz-d", "drift", "home", Date.parse("2026-10-23T04:28:00.000Z"), 31_000);
    expect(t.bonusOutcome(d)?.amount).toBe(EARN_JOURNEY_DRIFT);
  });

  it("another space's drift bonuses don't consume this space's cap", () => {
    const a = travel("spaceA");
    const b = travel("spaceB");
    completeJourney(a, "x1", "drift", "great-station", T0, 31_000);
    completeJourney(a, "x2", "drift", "home", T0 + 120_000, 31_000);
    const idB = completeJourney(b, "x3", "drift", "great-station", T0 + 240_000, 31_000);
    expect(b.bonusOutcome(idB)?.amount).toBe(EARN_JOURNEY_DRIFT);
  });
});

describe("edges", () => {
  it("a turned-back journey pays nothing on its return arrival", () => {
    const t = travel();
    const j = t.depart({ clientKey: "tb1", kind: "drift", destination: "great-station" }, T0);
    t.settle(j.id, past(j.cancelDeadline));
    t.turnBack(j.id, T0 + 20_000);
    const returned = t.arrive(j.id, T0 + 90_000);
    expect(returned?.state).toBe("returned");
    const outcome = t.bonusOutcome(j.id);
    expect(outcome?.credited).toBe(false);
    expect(outcome?.amount).toBe(0);
    expect(outcome?.reason).toBeNull();
  });

  it("at the fuel cap the bonus is still recorded; the balance saturates", () => {
    const t = travel();
    const j = t.depart({ clientKey: "cap1", kind: "warp", destination: "great-station" }, T0);
    t.settle(j.id, past(j.cancelDeadline)); // warp charged here
    econ().add(FUEL_CAP); // top the tank back to the cap before arrival
    expect(econ().get()).toBe(FUEL_CAP);
    const arrived = t.arrive(j.id, T0 + 120_000);
    expect(arrived?.state).toBe("arrived");
    const outcome = t.bonusOutcome(j.id);
    expect(outcome?.credited).toBe(true);
    expect(outcome?.amount).toBe(EARN_JOURNEY_COMPLETE); // recorded in full
    expect(outcome?.balance).toBe(FUEL_CAP); // balance saturated, no banking
  });

  it("bonusOutcome is null for an unknown journey", () => {
    expect(travel().bonusOutcome("nope")).toBeNull();
  });
});

describe("HTTP contract — the arrive response carries the bonus sibling", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await buildContext({
      dbPath: ":memory:",
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
    });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "bonus-tester", passcode: "secret123", name: "bonus-tester" }),
    });
    spaceId = ((await res.json()) as { id: string }).id;
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it(
    "a drift arriving right after its window pays 0 with the server's plain reason (real elapsed < 30s)",
    async () => {
      const dep = await fetch(`${base}/api/travel/depart`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-space-id": spaceId },
        body: JSON.stringify({ clientKey: "http-bonus-1", kind: "drift", destination: "great-station" }),
      });
      const journey = ((await dep.json()) as any).journey;
      // Poll arrival until the server's cancel window has closed; the
      // first non-409 answer is the arrival itself.
      let arrived: any = null;
      for (let i = 0; i < 40 && !arrived; i++) {
        const res = await fetch(`${base}/api/travel/arrive`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-space-id": spaceId },
          body: JSON.stringify({ journeyId: journey.id }),
        });
        if (res.status === 200) arrived = await res.json();
        else await new Promise((r) => setTimeout(r, 500));
      }
      expect(arrived?.journey?.state).toBe("arrived");
      expect(arrived?.bonus?.credited).toBe(false);
      expect(arrived?.bonus?.amount).toBe(0);
      expect(arrived?.bonus?.reason).toMatch(/half a minute/);
      expect(typeof arrived?.bonus?.balance).toBe("number");
    },
    30_000,
  );
});
