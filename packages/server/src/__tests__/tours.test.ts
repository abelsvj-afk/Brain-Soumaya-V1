import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { EconomyRepo, WARP_COST } from "../economy.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { ToursRepo, TourError } from "../repositories/tours.repo.js";
import { TravelRepo } from "../repositories/travel.repo.js";

/**
 * Guided tours (Wave 2, N7): a saved Chronicle route with a voice.
 * Time is INJECTED everywhere at repo level — no test sleeps, and no
 * client timing is ever trusted. The cancel window is 10 s; settling
 * past it moves an armed leg to in_transit (and charges a warp).
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

const tours = (space = "spaceA") => new ToursRepo(handle, space);
const travel = (space = "spaceA") => new TravelRepo(handle, space);
const econ = (space = "spaceA") => new EconomyRepo(handle, space);
const journeys = (space = "spaceA") => new JourneysRepo(handle, space);

function makeNode(
  space: string,
  over: { id?: number; label?: string; content?: string; kind?: string | null; type?: string; status?: string; occurredAt?: string } = {},
): number {
  const id =
    over.id ??
    Number(
      handle.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'n', 'knowledge', 'c')`)
        .run(space).lastInsertRowid,
    );
  if (over.id !== undefined) {
    handle.sqlite
      .prepare(
        `INSERT INTO nodes (id, space_id, label, type, content, kind, status, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        over.id,
        space,
        over.label ?? `Memory ${over.id}`,
        over.type ?? "daily",
        over.content ?? `The words of memory ${over.id}.`,
        over.kind ?? null,
        over.status ?? "active",
        over.occurredAt ?? "2026-01-01T00:00:00.000Z",
      );
  } else {
    handle.sqlite
      .prepare(`UPDATE nodes SET label = ?, content = ?, kind = ?, status = ?, occurred_at = ? WHERE id = ? AND space_id = ?`)
      .run(
        over.label ?? `Memory ${id}`,
        over.content ?? `The words of memory ${id}.`,
        over.kind ?? null,
        over.status ?? "active",
        over.occurredAt ?? "2026-01-01T00:00:00.000Z",
        id,
        space,
      );
  }
  return id;
}

function makeJourney(space: string, status: "active" | "done" = "done", title = "The move"): number {
  return journeys(space).create({ title, status }).id;
}

function linkAll(space: string, journeyId: number, nodeIds: number[]): void {
  for (const n of nodeIds) expect(journeys(space).link(journeyId, "node", n)).not.toBeNull();
}

/** The minimal open People gate: 3 people × 2 memories, one shared. */
function seedPeopleGate(space: string): void {
  for (const id of [1, 2, 3]) makeNode(space, { id, label: `Person ${id}`, kind: "person_entity" });
  for (const id of [10, 11, 12, 13, 14, 15]) makeNode(space, { id, label: `Memory ${id}` });
  const edge = (s: number, t: number) =>
    handle.sqlite.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, 'relates_to')`).run(space, s, t);
  edge(10, 1); edge(11, 1); edge(12, 2); edge(13, 2); edge(14, 3); edge(15, 3); edge(15, 1);
}

/** Drive one travel journey to arrival. Returns the arrived journey. */
function flyTo(destination: string, kind: "drift" | "warp" = "drift", key = `fly-${destination}-${Math.random()}`) {
  const j = travel().depart({ clientKey: key, kind, destination }, T0);
  const settled = travel().getJourney(j.id, past(j.cancelDeadline))!;
  expect(settled.state).toBe("in_transit");
  return travel().arrive(j.id, past(j.cancelDeadline) + 1000)!;
}

describe("C1 — a tour walks a done Journey's memories, in order, in their own words", () => {
  it("creates from a done journey: chronological stops, verbatim narration, journey title by default", () => {
    const j = makeJourney("spaceA");
    const late = makeNode("spaceA", { label: "The new flat", content: "We moved in June.", occurredAt: "2026-06-01T00:00:00.000Z" });
    const early = makeNode("spaceA", { label: "Packing boxes", content: "We packed in March.", occurredAt: "2026-03-01T00:00:00.000Z" });
    linkAll("spaceA", j, [late, early]);
    const { tour, leftOut } = tours().create(j);
    expect(leftOut).toEqual([]);
    expect(tour.title).toBe("The move");
    expect(tour.stops.map((s) => s.label)).toEqual(["Packing boxes", "The new flat"]);
    expect(tour.stops[0]!.narration).toBe("We packed in March.");
    expect(tour.stops[0]!.world).toBe("deep-past");
    expect(tours().logFor(tour.id).map((e) => e.kind)).toEqual(["created"]);
  });

  it("refuses a journey that isn't done", () => {
    const j = makeJourney("spaceA", "active");
    linkAll("spaceA", j, [makeNode("spaceA")]);
    expect(() => tours().create(j)).toThrowError(TourError);
    try {
      tours().create(j);
    } catch (e) {
      expect((e as TourError).code).toBe("JOURNEY_NOT_DONE");
    }
  });

  it("refuses a done journey with no memories to walk", () => {
    const j = makeJourney("spaceA");
    expect(() => tours().create(j)).toThrowError(TourError);
    try {
      tours().create(j);
    } catch (e) {
      expect((e as TourError).code).toBe("NO_STOPS");
    }
    expect(tours().list()).toEqual([]);
  });

  it("non-memory links never form stops", () => {
    const j = makeJourney("spaceA");
    const n = makeNode("spaceA");
    const expenseId = Number(
      handle.sqlite.prepare(`INSERT INTO fin_expense (space_id, date, amount_cents) VALUES (?, '2026-01-01', 500)`).run("spaceA").lastInsertRowid,
    );
    journeys().link(j, "node", n);
    journeys().link(j, "expense", expenseId);
    const { tour } = tours().create(j);
    expect(tour.stops).toHaveLength(1);
    expect(tour.stops[0]!.nodeId).toBe(n);
  });
});

describe("C2 — a tour never routes to an undiscovered world", () => {
  it("a person stop is left out while the People gate is closed, stated plainly once", () => {
    const j = makeJourney("spaceA");
    const person = makeNode("spaceA", { label: "Shaqavia", kind: "person_entity" });
    const memory = makeNode("spaceA", { label: "The move", occurredAt: "2026-05-01T00:00:00.000Z" });
    linkAll("spaceA", j, [person, memory]);
    expect(travel().peopleGateOpen()).toBe(false);
    const { tour, leftOut } = tours().create(j);
    expect(tour.stops.map((s) => s.label)).toEqual(["The move"]);
    expect(leftOut).toHaveLength(1);
    expect(leftOut[0]!.nodeId).toBe(person);
    expect(leftOut[0]!.reason).toMatch("People");
    // Never a locked stop inside the tour.
    expect(tour.stops.every((s) => s.world === "deep-past")).toBe(true);
  });

  it("a person stop becomes a People stop once the gate opens", () => {
    seedPeopleGate("spaceA");
    expect(travel().peopleGateOpen()).toBe(true);
    const j = makeJourney("spaceA");
    linkAll("spaceA", j, [1, 10]);
    const { tour, leftOut } = tours().create(j);
    expect(leftOut).toEqual([]);
    expect(tour.stops.find((s) => s.nodeId === 1)?.world).toBe("people");
    expect(tour.stops.find((s) => s.nodeId === 10)?.world).toBe("deep-past");
  });

  it("an archived memory is left out, not shown as a locked stop", () => {
    const j = makeJourney("spaceA");
    const archived = makeNode("spaceA", { label: "The old flat", status: "archived" });
    const live = makeNode("spaceA", { label: "The new flat" });
    linkAll("spaceA", j, [archived, live]);
    const { tour, leftOut } = tours().create(j);
    expect(tour.stops.map((s) => s.label)).toEqual(["The new flat"]);
    expect(leftOut[0]!.reason).toMatch("archive");
  });

  it("nothing walkable at all → NO_STOPS, with the reasons attached", () => {
    const j = makeJourney("spaceA");
    const person = makeNode("spaceA", { label: "Shaqavia", kind: "person_entity" });
    linkAll("spaceA", j, [person]);
    try {
      tours().create(j);
      expect.unreachable();
    } catch (e) {
      expect((e as TourError).code).toBe("NO_STOPS");
      expect((e as TourError).leftOut).toHaveLength(1);
    }
  });
});

describe("C3 — the rail: rename, delete, restore are log entries", () => {
  it("rename / delete / restore, each logged; delete hides, restore brings it back unchanged", () => {
    const j = makeJourney("spaceA");
    linkAll("spaceA", j, [makeNode("spaceA")]);
    const { tour } = tours().create(j);
    const renamed = tours().rename(tour.id, "The move, retold");
    expect(renamed?.title).toBe("The move, retold");
    expect(tours().remove(tour.id)).toBe(true);
    expect(tours().list()).toEqual([]);
    expect(tours().get(tour.id)).toBeNull();
    const restored = tours().restore(tour.id);
    expect(restored?.title).toBe("The move, retold");
    expect(restored?.stops).toEqual(tour.stops);
    expect(tours().logFor(tour.id).map((e) => e.kind)).toEqual(["created", "renamed", "deleted", "restored"]);
    expect(tours().remove("nope")).toBe(false);
    expect(tours().restore(tour.id)).toBeNull(); // already restored, not deleted
  });
});

describe("C4 — proposals: Soumaya suggests, the traveler decides", () => {
  it("a done journey without a tour is suggested; after creation it is gone; active journeys never are", () => {
    const done = makeJourney("spaceA", "done", "The move");
    linkAll("spaceA", done, [makeNode("spaceA")]);
    const active = makeJourney("spaceA", "active", "Still going");
    linkAll("spaceA", active, [makeNode("spaceA")]);
    const empty = makeJourney("spaceA", "done", "Empty chapter");
    let sug = tours().suggestions();
    expect(sug.map((s) => s.journeyId)).toEqual([done]);
    expect(sug[0]!.stopCount).toBe(1);
    expect(sug[0]!.reason).toMatch("finished");
    expect(sug.find((s) => s.journeyId === empty)).toBeUndefined();
    tours().create(done);
    sug = tours().suggestions();
    expect(sug).toEqual([]);
  });
});

describe("C5 — playback: flown, not clicked through; leaving is free", () => {
  it("start arms a drift leg to the first stop when the traveler isn't there; arrival keeps the pointer on that stop", () => {
    const j = makeJourney("spaceA");
    const n = makeNode("spaceA", { label: "First stop" });
    linkAll("spaceA", j, [n]);
    const { tour } = tours().create(j);
    const before = econ().get();
    const { session, leg } = tours().start(tour.id, "drift", T0);
    expect(session.session.state).toBe("playing");
    expect(session.session.currentStopIndex).toBe(0);
    expect(leg).not.toBeNull();
    expect(leg!.kind).toBe("drift");
    expect(leg!.destination).toBe("deep-past");
    // Arrival at the first stop: the pointer stays — the traveler IS at the stop.
    const settled = travel().getJourney(leg!.id, past(leg!.cancelDeadline))!;
    expect(settled.state).toBe("in_transit");
    travel().arrive(leg!.id, past(leg!.cancelDeadline) + 1000);
    const read = tours().session(past(leg!.cancelDeadline) + 1000)!;
    expect(read.session.currentStopIndex).toBe(0);
    expect(read.session.pendingLegJourneyId).toBeNull();
    expect(read.currentWorld).toBe("deep-past");
    expect(econ().get()).toBeCloseTo(before, 1); // drift is free
  });

  it("start arms no leg when the traveler is already in the first stop's world", () => {
    const j = makeJourney("spaceA");
    linkAll("spaceA", j, [makeNode("spaceA")]);
    const { tour } = tours().create(j);
    flyTo("deep-past");
    const { leg } = tours().start(tour.id, "drift", T0 + 60_000);
    expect(leg).toBeNull();
  });

  it("advance walks stop by stop across worlds, and ends free at the last stop", () => {
    seedPeopleGate("spaceA");
    // The seeded person sorts after the memories, so the route runs deep-past first.
    handle.sqlite.prepare(`UPDATE nodes SET occurred_at = '2026-03-01T00:00:00.000Z' WHERE id = 1 AND space_id = 'spaceA'`).run();
    const j = makeJourney("spaceA");
    const m1 = makeNode("spaceA", { id: 20, label: "First memory", occurredAt: "2026-01-01T00:00:00.000Z" });
    const m2 = makeNode("spaceA", { id: 21, label: "Second memory", occurredAt: "2026-02-01T00:00:00.000Z" });
    linkAll("spaceA", j, [1, m1, m2]); // person 1 → people; memories → deep-past
    const { tour } = tours().create(j);
    expect(tour.stops.map((s) => s.world)).toEqual(["deep-past", "deep-past", "people"]);
    // Start: leg to deep-past (stop 0), arrive, pointer stays 0.
    const started = tours().start(tour.id, "drift", T0);
    const leg0 = started.leg!;
    travel().getJourney(leg0.id, past(leg0.cancelDeadline));
    travel().arrive(leg0.id, past(leg0.cancelDeadline) + 1000);
    // Advance to stop 1: same world, no leg, no charge.
    const adv1 = tours().advance(tour.id, "drift", past(leg0.cancelDeadline) + 2000);
    expect(adv1.leg).toBeNull();
    expect(adv1.session.session.currentStopIndex).toBe(1);
    // Advance to stop 2: another world — a leg is armed.
    const adv2 = tours().advance(tour.id, "drift", past(leg0.cancelDeadline) + 3000);
    expect(adv2.leg).not.toBeNull();
    expect(adv2.leg!.destination).toBe("people");
    expect(adv2.session.session.currentStopIndex).toBe(1); // pointer moves on arrival, not on arming
    travel().getJourney(adv2.leg!.id, past(adv2.leg!.cancelDeadline));
    travel().arrive(adv2.leg!.id, past(adv2.leg!.cancelDeadline) + 1000);
    const read = tours().session(past(adv2.leg!.cancelDeadline) + 1000)!;
    expect(read.session.currentStopIndex).toBe(2);
    // Advance past the last stop: the tour ends, free.
    const adv3 = tours().advance(tour.id, "drift", past(adv2.leg!.cancelDeadline) + 2000);
    expect(adv3.session.session.state).toBe("ended");
    expect(adv3.session.session.endedReason).toBe("last-stop");
    expect(adv3.leg).toBeNull();
  });

  it("leaving is free: an arming leg is cancelled free, the tour waits, resume picks up where you left off", () => {
    const j = makeJourney("spaceA");
    const m1 = makeNode("spaceA", { id: 30, label: "First", occurredAt: "2026-01-01T00:00:00.000Z" });
    const m2 = makeNode("spaceA", { id: 31, label: "Second", occurredAt: "2026-02-01T00:00:00.000Z" });
    linkAll("spaceA", j, [m1, m2]);
    const { tour } = tours().create(j);
    const before = econ().get();
    const started = tours().start(tour.id, "drift", T0);
    const leg = started.leg!;
    // Step off while the leg is still arming: the leg is cancelled free.
    const left = tours().leave(tour.id, T0 + 1000);
    expect(left.session.state).toBe("ended");
    expect(left.session.endedReason).toBe("left");
    expect(travel().getJourney(leg.id, T0 + 1000)?.state).toBe("cancelled");
    expect(econ().get()).toBeCloseTo(before, 1);
    // The saved tour is untouched, and resuming picks up at stop 0.
    expect(tours().get(tour.id)?.stops).toHaveLength(2);
    const resumed = tours().start(tour.id, "drift", T0 + 2000);
    expect(resumed.session.session.state).toBe("playing");
    expect(resumed.session.session.currentStopIndex).toBe(0);
  });

  it("leaving mid-flight leaves the leg to the traveler's own travel — the tour still ends free", () => {
    const j = makeJourney("spaceA");
    linkAll("spaceA", j, [makeNode("spaceA"), makeNode("spaceA")]);
    const { tour } = tours().create(j);
    const started = tours().start(tour.id, "drift", T0);
    const leg = started.leg!;
    travel().getJourney(leg.id, past(leg.cancelDeadline)); // in_transit
    const left = tours().leave(tour.id, past(leg.cancelDeadline) + 1000);
    expect(left.session.state).toBe("ended");
    expect(travel().getJourney(leg.id, past(leg.cancelDeadline) + 1000)?.state).toBe("in_transit");
    // The traveler can still arrive home on their own leg.
    expect(travel().arrive(leg.id, past(leg.cancelDeadline) + 2000)?.state).toBe("arrived");
  });

  it("a cancelled leg clears and the tour waits; advancing again re-arms with a fresh leg", () => {
    seedPeopleGate("spaceA");
    handle.sqlite.prepare(`UPDATE nodes SET occurred_at = '2026-03-01T00:00:00.000Z' WHERE id = 1 AND space_id = 'spaceA'`).run();
    const j = makeJourney("spaceA");
    const m1 = makeNode("spaceA", { id: 50, label: "First", occurredAt: "2026-01-01T00:00:00.000Z" });
    linkAll("spaceA", j, [m1, 1]); // deep-past, then people
    const { tour } = tours().create(j);
    const started = tours().start(tour.id, "drift", T0);
    const leg0 = started.leg!;
    travel().getJourney(leg0.id, past(leg0.cancelDeadline));
    travel().arrive(leg0.id, past(leg0.cancelDeadline) + 1000);
    // Arm the leg to People, then cancel it inside the window: the tour waits.
    const adv1 = tours().advance(tour.id, "drift", past(leg0.cancelDeadline) + 2000);
    const leg1 = adv1.leg!;
    expect(leg1.destination).toBe("people");
    expect(travel().cancel(leg1.id, past(leg0.cancelDeadline) + 3000)?.state).toBe("cancelled");
    const read = tours().session(past(leg0.cancelDeadline) + 3000)!;
    expect(read.session.currentStopIndex).toBe(0);
    expect(read.session.pendingLegJourneyId).toBeNull();
    expect(read.session.state).toBe("playing");
    // Advancing again arms a fresh leg — never the cancelled one.
    const adv2 = tours().advance(tour.id, "drift", past(leg0.cancelDeadline) + 4000);
    expect(adv2.leg).not.toBeNull();
    expect(adv2.leg!.id).not.toBe(leg1.id);
    expect(adv2.leg!.destination).toBe("people");
    expect(adv2.session.session.currentStopIndex).toBe(0);
  });

  it("a warp leg charges exactly 10 at the window close, and only once", () => {
    seedPeopleGate("spaceA");
    handle.sqlite.prepare(`UPDATE nodes SET occurred_at = '2026-03-01T00:00:00.000Z' WHERE id = 1 AND space_id = 'spaceA'`).run();
    const j = makeJourney("spaceA");
    linkAll("spaceA", j, [makeNode("spaceA"), 1]); // deep-past, then people
    const { tour } = tours().create(j);
    const started = tours().start(tour.id, "drift", T0);
    const leg0 = started.leg!;
    travel().getJourney(leg0.id, past(leg0.cancelDeadline));
    travel().arrive(leg0.id, past(leg0.cancelDeadline) + 1000);
    const before = econ().get();
    const adv = tours().advance(tour.id, "warp", past(leg0.cancelDeadline) + 2000);
    expect(adv.leg).not.toBeNull();
    expect(adv.leg!.kind).toBe("warp");
    const settled = travel().getJourney(adv.leg!.id, past(adv.leg!.cancelDeadline))!;
    expect(settled.state).toBe("in_transit");
    expect(settled.fuelCharged).toBe(WARP_COST);
    expect(econ().get()).toBeCloseTo(before - WARP_COST, 1);
    // A retried read charges nothing more.
    travel().getJourney(adv.leg!.id, past(adv.leg!.cancelDeadline) + 5000);
    expect(econ().get()).toBeCloseTo(before - WARP_COST, 1);
  });

  it("starting another tour leaves the first, free", () => {
    const j1 = makeJourney("spaceA", "done", "Tour one");
    linkAll("spaceA", j1, [makeNode("spaceA")]);
    const j2 = makeJourney("spaceA", "done", "Tour two");
    linkAll("spaceA", j2, [makeNode("spaceA")]);
    const t1 = tours().create(j1).tour;
    const t2 = tours().create(j2).tour;
    tours().start(t1.id, "drift", T0);
    const second = tours().start(t2.id, "drift", T0 + 1000);
    expect(second.session.session.tourId).toBe(t2.id);
    const first = tours().session(T0 + 1000);
    expect(first?.session.tourId).toBe(t2.id); // latest session is the second tour
  });

  it("a stop archived after creation is passed by with a plain note; the saved tour is unchanged", () => {
    const j = makeJourney("spaceA");
    const m1 = makeNode("spaceA", { id: 40, label: "First", occurredAt: "2026-01-01T00:00:00.000Z" });
    const m2 = makeNode("spaceA", { id: 41, label: "Second", occurredAt: "2026-02-01T00:00:00.000Z" });
    linkAll("spaceA", j, [m1, m2]);
    const { tour } = tours().create(j);
    const started = tours().start(tour.id, "drift", T0);
    const leg0 = started.leg!;
    travel().getJourney(leg0.id, past(leg0.cancelDeadline));
    travel().arrive(leg0.id, past(leg0.cancelDeadline) + 1000);
    // Archive the second memory, then walk to it.
    handle.sqlite.prepare(`UPDATE nodes SET status = 'archived' WHERE id = ? AND space_id = ?`).run(m2, "spaceA");
    const adv = tours().advance(tour.id, "drift", past(leg0.cancelDeadline) + 2000);
    expect(adv.session.session.state).toBe("ended");
    expect(adv.session.session.endedReason).toBe("last-stop");
    expect(adv.session.session.skippedNote).toMatch("archive");
    expect(tours().get(tour.id)?.stops).toHaveLength(2); // saved tour unchanged
  });

  it("deleting a tour ends its playing session, free", () => {
    const j = makeJourney("spaceA");
    linkAll("spaceA", j, [makeNode("spaceA")]);
    const { tour } = tours().create(j);
    tours().start(tour.id, "drift", T0);
    expect(tours().remove(tour.id)).toBe(true);
    expect(tours().session(T0 + 1000)?.session.state).toBe("ended");
    expect(tours().session(T0 + 1000)?.session.endedReason).toBe("left");
  });
});
