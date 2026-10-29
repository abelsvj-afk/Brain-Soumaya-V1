import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { FleetDefenseRepo } from "./repo.js";
import {
  FleetDefenseError,
  getOverview,
  offerRelease,
  startDefense,
  tickDefense,
} from "./defense.js";

/**
 * Fleet defense — the service (design note §2–§5, C1–C3).
 * Time is INJECTED everywhere — no test sleeps. Every action runs
 * against a fresh in-memory DB, so the log assertions are exact.
 *
 * C1: a defense can only ever start from a user-marked release; no
 * release, no fleet.
 * C2: losing costs nothing — after a lost defense every brain fact
 * is unchanged and the charge is still releasable.
 * C3: autonomous and helm modes switch freely mid-defense; neither
 * is privileged.
 * Plus: the linked brain record is never written by a defense, win
 * or loss; and one space's releases are invisible to another.
 */
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // 08:00 EDT

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

function seedBrain(space = "spaceA"): { nodeIds: number[] } {
  const ins = handle.sqlite.prepare(
    `INSERT INTO nodes (space_id, label, type, content, emotional_weight) VALUES (?, ?, ?, ?, ?)`,
  );
  const a = ins.run(space, "The old argument", "memory", "something that happened", -0.8)
    .lastInsertRowid as number;
  const b = ins.run(space, "A steady memory", "memory", "something else", 0.4).lastInsertRowid as number;
  handle.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, ?)`)
    .run(space, a, b, "links");
  return { nodeIds: [a, b] };
}

function brainSnapshot(space = "spaceA"): string {
  const nodes = handle.sqlite
    .prepare(`SELECT * FROM nodes WHERE space_id = ? ORDER BY id`)
    .all(space);
  const edges = handle.sqlite
    .prepare(`SELECT * FROM edges WHERE space_id = ? ORDER BY id`)
    .all(space);
  return JSON.stringify({ nodes, edges });
}

function offer(space = "spaceA", over: Record<string, unknown> = {}) {
  return offerRelease(handle, space, {
    kind: "emotion",
    size: "small",
    label: "the old argument",
    ...over,
  }, T0);
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FleetDefenseError);
    expect((e as FleetDefenseError).code).toBe(code);
    return;
  }
  throw new Error(`Expected FleetDefenseError ${code}, but nothing threw.`);
}

describe("offerRelease", () => {
  it("stores the offer and logs it in plain words", () => {
    const { nodeIds } = seedBrain();
    const release = offer("spaceA", { nodeId: nodeIds[0] });
    expect(release.status).toBe("offered");
    expect(release.kind).toBe("emotion");
    expect(release.size).toBe("small");
    expect(release.nodeId).toBe(nodeIds[0]);
    const log = new FleetDefenseRepo(handle, "spaceA").recentLog();
    expect(log[0]?.kind).toBe("offered");
    expect(log[0]?.text).toMatch(/Offered for release — the old argument/);
  });

  it("refuses an offer with no label, a bad kind, a bad size, or a bad node link", () => {
    expectCode(() => offer("spaceA", { label: "   " }), "INVALID_INPUT");
    expectCode(() => offer("spaceA", { label: "x".repeat(201) }), "INVALID_INPUT");
    expectCode(() => offer("spaceA", { kind: "grudge" }), "INVALID_INPUT");
    expectCode(() => offer("spaceA", { size: "huge" }), "INVALID_INPUT");
    expectCode(() => offer("spaceA", { nodeId: -3 }), "INVALID_INPUT");
    expectCode(() => offer("spaceA", { nodeId: 1.5 }), "INVALID_INPUT");
  });

  it("refuses a node that isn't in this brain (C1: the marking must be real)", () => {
    seedBrain();
    expectCode(() => offer("spaceA", { nodeId: 999 }), "NODE_NOT_FOUND");
    expectCode(() => offer("spaceB", { nodeId: 1 }), "NODE_NOT_FOUND");
  });
});

describe("startDefense", () => {
  it("summons exactly one wave, sized to the release, and the release is defending", () => {
    const release = offer("spaceA", { size: "steady" });
    const defense = startDefense(handle, "spaceA", release.id, T0);
    expect(defense.status).toBe("active");
    expect(defense.invaders).toHaveLength(4);
    expect(defense.invaders.map((i) => i.distance)).toEqual([6, 6, 6, 6]);
    expect(new FleetDefenseRepo(handle, "spaceA").getRelease(release.id)?.status).toBe("defending");
    const log = new FleetDefenseRepo(handle, "spaceA").recentLog();
    expect(log[0]?.kind).toBe("summoned");
    expect(log[0]?.text).toMatch(/A fleet of 4 ships came for the old argument/);
    expect(log[0]?.text).toMatch(/Defending your own galaxy is free/);
  });

  it("no release, no fleet — an unknown release cannot summon anything (C1)", () => {
    expectCode(() => startDefense(handle, "spaceA", 999, T0), "UNKNOWN_RELEASE");
  });

  it("one active defense per release — a second summoning is refused", () => {
    const release = offer();
    startDefense(handle, "spaceA", release.id, T0);
    expectCode(() => startDefense(handle, "spaceA", release.id, T0), "RELEASE_NOT_OFFERED");
  });

  it("a release in another space cannot be summoned from here", () => {
    const release = offer("spaceA");
    expectCode(() => startDefense(handle, "spaceB", release.id, T0), "UNKNOWN_RELEASE");
  });
});

describe("tickDefense", () => {
  function startSmall(space = "spaceA") {
    const release = offer(space);
    return { release, defense: startDefense(handle, space, release.id, T0) };
  }

  it("a helm tick needs a real lane", () => {
    const { defense } = startSmall();
    expectCode(() => tickDefense(handle, "spaceA", defense.id, { mode: "helm" }, T0), "INVALID_INPUT");
    expectCode(() => tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane: 0 }, T0), "INVALID_INPUT");
    expectCode(() => tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane: 4 }, T0), "INVALID_INPUT");
    expectCode(() => tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane: "1" }, T0), "INVALID_INPUT");
    expectCode(() => tickDefense(handle, "spaceA", defense.id, { mode: "watch" as never }, T0), "INVALID_INPUT");
  });

  it("an unknown defense cannot be ticked", () => {
    expectCode(() => tickDefense(handle, "spaceA", 999, { mode: "autonomous" }, T0), "UNKNOWN_DEFENSE");
  });

  it("helm and autonomous switch freely mid-defense, one tick at a time (C3)", () => {
    const { defense } = startSmall();
    let d = tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane: 1 }, T0);
    expect(d.lastMode).toBe("helm");
    expect(d.tickCount).toBe(1);
    d = tickDefense(handle, "spaceA", defense.id, { mode: "autonomous" }, T0);
    expect(d.lastMode).toBe("autonomous");
    expect(d.tickCount).toBe(2);
    d = tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane: 2 }, T0);
    expect(d.lastMode).toBe("helm");
    expect(d.tickCount).toBe(3);
    expect(d.status).toBe("active");
  });

  it("winning clears the release, writes the codex line, and never touches the brain", () => {
    const { nodeIds } = seedBrain();
    const before = brainSnapshot();
    const release = offer("spaceA", { nodeId: nodeIds[0] });
    const defense = startDefense(handle, "spaceA", release.id, T0);
    let d = defense;
    for (const lane of [1, 2, 3]) {
      d = tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane }, T0);
    }
    expect(d.status).toBe("won");
    expect(d.outcomeLine).toMatch(/the fleet dispersed and the charge was let go — the old argument/);
    expect(new FleetDefenseRepo(handle, "spaceA").getRelease(release.id)?.status).toBe("cleared");
    expect(brainSnapshot()).toBe(before);
    const log = new FleetDefenseRepo(handle, "spaceA").recentLog();
    expect(log[0]?.kind).toBe("won");
    expect(log[0]?.text).toMatch(/charge was let go/);
  });

  it("losing costs nothing: the release is offered again, the brain is unchanged, the defense can be tried again (C2)", () => {
    const { nodeIds } = seedBrain();
    const before = brainSnapshot();
    const release = offer("spaceA", { nodeId: nodeIds[0] });
    const defense = startDefense(handle, "spaceA", release.id, T0);
    let d = defense;
    // Fire lane 1 five times: the first shot takes that lane's ship,
    // the rest fly wide, and the last ship reaches the charge.
    for (const lane of [1, 1, 1, 1, 1]) {
      d = tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane }, T0);
    }
    expect(d.status).toBe("lost");
    expect(d.outcomeLine).toMatch(/can be tried again later\. Nothing was lost/);
    expect(new FleetDefenseRepo(handle, "spaceA").getRelease(release.id)?.status).toBe("offered");
    expect(brainSnapshot()).toBe(before);
    const log = new FleetDefenseRepo(handle, "spaceA").recentLog();
    expect(log[0]?.kind).toBe("lost");
    // And the same release defends again — a loss is a "not yet".
    const again = startDefense(handle, "spaceA", release.id, T0);
    expect(again.status).toBe("active");
    expect(again.invaders).toHaveLength(3);
  });

  it("a resolved defense cannot be ticked again", () => {
    const { defense } = startSmall();
    let d = defense;
    for (const lane of [1, 2, 3]) {
      d = tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane }, T0);
    }
    expect(d.status).toBe("won");
    expectCode(() => tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane: 1 }, T0), "DEFENSE_NOT_ACTIVE");
  });

  it("a cleared release cannot summon another fleet", () => {
    const release = offer();
    const defense = startDefense(handle, "spaceA", release.id, T0);
    for (const lane of [1, 2, 3]) {
      tickDefense(handle, "spaceA", defense.id, { mode: "helm", lane }, T0);
    }
    expectCode(() => startDefense(handle, "spaceA", release.id, T0), "RELEASE_NOT_OFFERED");
  });
});

describe("getOverview", () => {
  it("pairs the active defense with its release and carries the history", () => {
    const r1 = offer("spaceA", { label: "first charge" });
    const r2 = offer("spaceA", { label: "second charge", kind: "debt", size: "big" });
    const d1 = startDefense(handle, "spaceA", r1.id, T0);
    for (const lane of [1, 2, 3]) {
      tickDefense(handle, "spaceA", d1.id, { mode: "helm", lane }, T0);
    }
    const overview = getOverview(handle, "spaceA");
    expect(overview.releases).toHaveLength(2);
    expect(overview.activeDefense).toBeNull();
    expect(overview.activeRelease).toBeNull();
    expect(overview.history).toHaveLength(1);
    expect(overview.history[0]?.status).toBe("won");
    expect(overview.recentLog.length).toBeGreaterThan(0);

    const d2 = startDefense(handle, "spaceA", r2.id, T0);
    const overview2 = getOverview(handle, "spaceA");
    expect(overview2.activeDefense?.id).toBe(d2.id);
    expect(overview2.activeRelease?.label).toBe("second charge");
    expect(overview2.activeDefense?.invaders).toHaveLength(5);
  });

  it("another space sees none of this", () => {
    offer("spaceA");
    const overview = getOverview(handle, "spaceB");
    expect(overview.releases).toHaveLength(0);
    expect(overview.activeDefense).toBeNull();
    expect(overview.history).toHaveLength(0);
  });
});
