import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import {
  CAPTAIN_MAX_ACTS_PER_DAY,
  CAPTAIN_START_FUEL,
  WARP_COST,
  captainDefinition,
} from "@brain/shared";
import { NpcRepo } from "../npcs/repo.js";
import { CaptainRepo } from "./repo.js";
import { dayPlan, zonedTimeMs } from "./seed.js";
import { TemplateBarkSource } from "./barks.js";
import {
  CaptainError,
  advanceCaptain,
  askCaptain,
  getCaptainState,
  getChronicle,
  listCaptainStates,
  resumeCaptain,
  stopCaptain,
  wipeCaptainMeetings,
} from "./engine.js";
import type { CaptainDecider } from "./decider.js";

/**
 * NPC-Player Layer L1 — Presence (design §10 L1, acceptance §11).
 * Time is INJECTED everywhere — no test sleeps. The space timezone
 * defaults to America/New_York, so day plans are computed in NY
 * local days regardless of the process timezone the gate runs in.
 *
 * A1: an advance leaves the player's fuel/nodes/demand/relics/
 *     brain byte-identical — proven by snapshot, not by claim.
 * A2: same seed + interval ⇒ identical acts, on two fresh DBs.
 * A4: budgets cap the day; a stopped captain is total silence.
 * A5: the meeting cycle — first 8, later 6, wipe ⇒ first again.
 */
const TZ = "America/New_York";
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // Thu 08:00 EDT
const H = 3_600_000;
const SPACE = "spaceA";

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const captains = (space = SPACE) => new CaptainRepo(handle, space);
const npcLog = (space = SPACE) => new NpcRepo(handle, space);
const bexLog = (space = SPACE) => npcLog(space).recentLog("bex", 500);

/** Today's (2026-10-22, NY) plan for Bex and its first visit. */
function firstVisit() {
  const plan = dayPlan("bex", "2026-10-22", TZ, "great-station");
  const v = plan[0];
  if (!v) throw new Error("plan must have visits");
  return v;
}

/** Chronological visits of ≥2h across the test week, skipping any
 *  that overlap an already-picked one — the meeting/greet tests
 *  need a session long enough for a begin step plus a later step. */
function longVisits() {
  const picked: { startMs: number; endMs: number; world: string; sessionKey: string }[] = [];
  for (const key of ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]) {
    for (const v of dayPlan("bex", key, TZ, "great-station")) {
      if (v.endMs - v.startMs < 2 * H) continue;
      if (picked.some((p) => v.startMs < p.endMs && v.endMs > p.startMs)) continue;
      picked.push(v);
    }
  }
  return picked.sort((a, b) => a.startMs - b.startMs);
}

/** Send the visitor away and back so the return is a NEW visit
 *  (a new arrived journey) in `world`, completed by `byMs`. */
function revisitPlayer(world: string, byMs: number, space = SPACE): void {
  const other = world === "great-station" ? "scale" : "great-station";
  arrivePlayer(other, byMs - 30 * 60_000, space);
  arrivePlayer(world, byMs - 10 * 60_000, space);
}

/** Put Bex's cursor exactly at a visit start, then step in: the
 *  session begins on that first hourly step. */
function beginFirstSession(space = SPACE): { startMs: number; world: string } {
  const v = firstVisit();
  advanceCaptain(handle, space, "bex", v.startMs); // first touch: cursor = start
  advanceCaptain(handle, space, "bex", v.startMs + H); // one step: arrive
  return { startMs: v.startMs, world: v.world };
}

/** Drive the visitor to a world and arrive (injected time). */
function arrivePlayer(world: string, nowMs: number, space = SPACE): string {
  const t = new TravelRepo(handle, space);
  const j = t.depart({ clientKey: `k-${world}-${nowMs}`, kind: "drift", destination: world }, nowMs);
  const arrived = t.arrive(j.id, nowMs + 60_000);
  if (!arrived || arrived.state !== "arrived") throw new Error("test setup: arrival failed");
  return j.id;
}

describe("seed — the day plan (design §8.5 rhythm)", () => {
  it("is deterministic, 2–4 visits a day, 1–3 hours each, public worlds only", () => {
    for (let d = 20; d <= 31; d++) {
      const key = `2026-10-${d}`;
      const a = dayPlan("bex", key, TZ, "great-station");
      const b = dayPlan("bex", key, TZ, "great-station");
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(a.length).toBeLessThanOrEqual(4);
      for (const v of a) {
        expect(["great-station", "scale"]).toContain(v.world);
        const hours = (v.endMs - v.startMs) / H;
        expect(hours).toBeGreaterThanOrEqual(1);
        expect(hours).toBeLessThanOrEqual(3);
      }
    }
  });

  it("different captains and different days draw different plans", () => {
    const bex = dayPlan("bex", "2026-10-22", TZ, "great-station");
    const dain = dayPlan("dain", "2026-10-22", TZ, "great-station");
    expect(JSON.stringify(bex)).not.toBe(JSON.stringify(dain));
    const bexNext = dayPlan("bex", "2026-10-23", TZ, "great-station");
    expect(JSON.stringify(bex)).not.toBe(JSON.stringify(bexNext));
  });

  it("zonedTimeMs lands on local wall-clock in both gate hemispheres", () => {
    // NY in October is EDT (UTC-4): local midnight is 04:00Z.
    expect(new Date(zonedTimeMs(TZ, "2026-10-22", 0)).toISOString()).toBe("2026-10-22T04:00:00.000Z");
    // Kiritimati is UTC+14 year-round: local midnight is 10:00Z the day before.
    expect(new Date(zonedTimeMs("Pacific/Kiritimati", "2026-10-22", 0)).toISOString()).toBe(
      "2026-10-21T10:00:00.000Z",
    );
  });
});

describe("advance — sessions, determinism, the summarized jump", () => {
  it("arrives and departs on the seeded rhythm; every act carries a plain cause", () => {
    const v = firstVisit();
    beginFirstSession();
    const st = captains().state("bex");
    expect(st?.sessionKey).toBe(v.sessionKey);
    expect(st?.currentWorld).toBe(v.world);
    const arrives = bexLog().filter((e) => e.kind === "arrive");
    expect(arrives).toHaveLength(1);
    expect(arrives[0]?.cause.length).toBeGreaterThan(10);
    // Advance past the visit end: a depart closes it.
    advanceCaptain(handle, SPACE, "bex", v.endMs + 2 * H);
    const after = captains().state("bex");
    expect(after?.sessionKey).toBeNull();
    expect(bexLog().some((e) => e.kind === "depart")).toBe(true);
    // Session memories were written to HER stream.
    const sessions = captains().memory("bex", "session");
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  it("A2 — two fresh databases, same read sequence, byte-identical lives", () => {
    const runLife = (h: DbHandle) => {
      const times = [T0, T0 + 3 * H, T0 + 9 * H, T0 + 30 * H, T0 + 55 * H];
      for (const t of times) getCaptainState(h, SPACE, "bex", t);
      const log = new NpcRepo(h, SPACE)
        .recentLog("bex", 500)
        .map((e) => `${e.kind}|${e.act}|${e.cause}|${e.createdAt}`)
        .join("\n");
      const st = new CaptainRepo(h, SPACE).state("bex");
      return `${log}\nSTATE ${JSON.stringify(st)}`;
    };
    const h2 = createDb(":memory:");
    try {
      expect(runLife(handle)).toBe(runLife(h2));
    } finally {
      h2.sqlite.close();
    }
  });

  it("beyond the 72-step cap the jump is summarized, honestly, in one line", () => {
    advanceCaptain(handle, SPACE, "bex", T0); // first touch
    const tenDaysAgo = new Date(T0 - 10 * 24 * H).toISOString();
    handle.sqlite
      .prepare(`UPDATE npc_player_state SET last_advanced_at = ? WHERE npc_id = 'bex'`)
      .run(tenDaysAgo);
    advanceCaptain(handle, SPACE, "bex", T0 + H);
    const log = bexLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.kind).toBe("wait");
    expect(log[0]?.act).toContain("Was away");
    expect(log[0]?.cause).toContain("summarized");
  });

  it("a mid-session long absence closes the session inside the summary", () => {
    const { startMs } = beginFirstSession();
    const tenDaysAgo = new Date(startMs - 10 * 24 * H).toISOString();
    handle.sqlite
      .prepare(`UPDATE npc_player_state SET last_advanced_at = ? WHERE npc_id = 'bex'`)
      .run(tenDaysAgo);
    advanceCaptain(handle, SPACE, "bex", startMs + H);
    const kinds = bexLog().map((e) => e.kind);
    expect(kinds).toContain("depart");
    expect(kinds).toContain("wait"); // the summary line
    expect(captains().state("bex")?.sessionKey).toBeNull();
  });
});

describe("A1 — isolation: her life never touches the player's anything", () => {
  function playerSnapshot(space = SPACE): string {
    const nodes = handle.sqlite.prepare(`SELECT * FROM nodes WHERE space_id = ? ORDER BY id`).all(space);
    const edges = handle.sqlite.prepare(`SELECT * FROM edges WHERE space_id = ? ORDER BY id`).all(space);
    const journeys = handle.sqlite
      .prepare(`SELECT * FROM travel_journeys WHERE space_id = ? ORDER BY rowid`)
      .all(space);
    const holdings = handle.sqlite
      .prepare(`SELECT * FROM npc_relic_holdings WHERE space_id = ? ORDER BY rowid`)
      .all(space);
    // The raw space_meta row carries the player's fuel: byte-level
    // proof, with no lazy-regen materialization from the read path.
    const meta = handle.sqlite.prepare(`SELECT * FROM space_meta WHERE space_id = ?`).all(space);
    return JSON.stringify({ nodes, edges, journeys, holdings, meta });
  }

  it("advances, asks, stops and wipes leave the player snapshot byte-identical", () => {
    const ins = handle.sqlite.prepare(
      `INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, ?, ?)`,
    );
    const a = ins.run(SPACE, "First memory", "memory", "something").lastInsertRowid as number;
    const b = ins.run(SPACE, "Second memory", "memory", "something else").lastInsertRowid as number;
    handle.sqlite
      .prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, ?)`)
      .run(SPACE, a, b, "links");
    arrivePlayer("great-station", T0 - 120_000);

    const before = playerSnapshot();
    // A full day and more of her life, plus every owner control.
    for (let t = T0; t <= T0 + 30 * H; t += 3 * H) getCaptainState(handle, SPACE, "bex", t);
    askCaptain(handle, SPACE, "bex", "doing", T0 + 31 * H);
    stopCaptain(handle, SPACE, "bex", T0 + 32 * H);
    resumeCaptain(handle, SPACE, "bex", T0 + 33 * H);
    wipeCaptainMeetings(handle, SPACE, "bex", T0 + 34 * H);
    expect(playerSnapshot()).toBe(before);
  });
});

describe("travel — her own fuel, the chart's prices", () => {
  const warpDecider: CaptainDecider = {
    decide: (_def, p) => ({
      act: "travel",
      travelKind: "warp",
      toWorld: p.otherWorld,
      cause: "Test decider: warp.",
    }),
  };

  it("a warp charges HER exactly 10 and lands her in the other public world", () => {
    const { world } = beginFirstSession();
    const st0 = captains().state("bex");
    expect(st0?.fuel).toBe(CAPTAIN_START_FUEL);
    const v = firstVisit();
    advanceCaptain(handle, SPACE, "bex", v.startMs + 2 * H, { decider: warpDecider });
    const st1 = captains().state("bex");
    expect(st1?.fuel).toBe(CAPTAIN_START_FUEL - WARP_COST);
    expect(st1?.currentWorld).toBe(world === "great-station" ? "scale" : "great-station");
    const travel = bexLog().find((e) => e.kind === "travel");
    expect(travel?.act).toContain("her own");
  });

  it("below a warp's price the engine refuses the burn — fuel never goes negative", () => {
    const v = firstVisit();
    beginFirstSession();
    handle.sqlite.prepare(`UPDATE npc_player_state SET fuel = 5 WHERE npc_id = 'bex'`).run();
    advanceCaptain(handle, SPACE, "bex", v.startMs + 2 * H, { decider: warpDecider });
    const st = captains().state("bex");
    expect(st?.fuel).toBe(5);
    expect(bexLog().some((e) => e.kind === "travel")).toBe(false);
    expect(bexLog()[0]?.cause).toContain("her own ledger said no");
  });

  it("the fence refuses a decider that reaches outside the public worlds — and rolls back", () => {
    const v = firstVisit();
    beginFirstSession();
    const rogue: CaptainDecider = {
      decide: (_def, p) => ({
        act: "travel",
        travelKind: "drift",
        // A private world, smuggled past the type system.
        toWorld: "home" as never,
        cause: "rogue",
      }),
    };
    const before = bexLog().length;
    expect(() => advanceCaptain(handle, SPACE, "bex", v.startMs + 2 * H, { decider: rogue })).toThrowError(
      CaptainError,
    );
    expect(bexLog()).toHaveLength(before); // the transaction rolled back
    void rogue;
  });
});

describe("meetings (A5) and greetings", () => {
  it("first meeting importance 8, the wipe makes the next one a first again", () => {
    const [v, v2, v3] = longVisits();
    if (!v || !v2 || !v3) throw new Error("the test week needs three long visits");
    // The visitor is standing in her visit world before she arrives.
    arrivePlayer(v.world, v.startMs - 120_000);
    advanceCaptain(handle, SPACE, "bex", v.startMs); // cursor
    advanceCaptain(handle, SPACE, "bex", v.startMs + 2 * H); // arrive step + meeting step
    const meetings = captains().meetings("bex");
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.importance).toBe(8);
    expect(meetings[0]?.text).toContain("first time");

    const met = askCaptain(handle, SPACE, "bex", "met", v.startMs + 2 * H + 1000);
    expect(met.answer).toContain("We have");

    // Catch up to just before the second visit with the visitor
    // still standing in the FIRST visit's world: interim sessions
    // there dedupe on the same journey key, so no phantom second
    // meeting can sneak in.
    advanceCaptain(handle, SPACE, "bex", v2.startMs);
    expect(captains().meetings("bex")).toHaveLength(1);

    // A NEW visit by the visitor (a fresh arrival) during a later
    // session of hers records a second meeting at importance 6.
    revisitPlayer(v2.world, v2.startMs);
    advanceCaptain(handle, SPACE, "bex", v2.startMs + 3 * H);
    const meetings2 = captains().meetings("bex");
    expect(meetings2).toHaveLength(2);
    expect(meetings2[1]?.importance).toBe(6);

    // The wipe: meetings gone, and "have we met" answers honestly.
    wipeCaptainMeetings(handle, SPACE, "bex", v2.startMs + 3 * H + 500);
    expect(captains().meetings("bex")).toHaveLength(0);
    const wiped = askCaptain(handle, SPACE, "bex", "met", v2.startMs + 3 * H + 1000);
    expect(wiped.answer).toContain("haven't met");
    expect(wiped.answer).toContain("not a person");

    // And the next meeting is a FIRST meeting again (importance 8).
    // The visitor waits at home (a private world she never enters)
    // while time catches up, so nothing can be recorded early.
    arrivePlayer("home", v2.startMs + 4 * H);
    advanceCaptain(handle, SPACE, "bex", v3.startMs);
    expect(captains().meetings("bex")).toHaveLength(0);
    revisitPlayer(v3.world, v3.startMs);
    advanceCaptain(handle, SPACE, "bex", v3.startMs + 3 * H);
    const meetings3 = captains().meetings("bex");
    expect(meetings3).toHaveLength(1);
    expect(meetings3[0]?.importance).toBe(8);
  });

  it("she greets a present visitor once per visit, and the line is a stored template bark", () => {
    const [v] = longVisits();
    if (!v) throw new Error("the test week needs a long visit");
    arrivePlayer(v.world, v.startMs - 120_000);
    advanceCaptain(handle, SPACE, "bex", v.startMs);
    advanceCaptain(handle, SPACE, "bex", v.startMs + 2 * H); // arrive step + greet step
    const greets = bexLog().filter((e) => e.kind === "greet");
    expect(greets).toHaveLength(1);
    const def = captainDefinition("bex");
    expect(def?.voice.greetingLines.map((l) => l.replaceAll("{world}", v.world === "scale" ? "Scale" : "the Great Station"))).toContain(greets[0]?.act);
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(v.startMs));
    const barks = captains().barksForDay("bex", dayKey);
    const greeting = barks.find((b) => b.context === "greeting");
    expect(greeting?.source).toBe("template");
    expect(greeting?.basedOn).toContain(greets[0]?.id);
    // The day also carries her idle bark (Chronicle color).
    expect(barks.some((b) => b.context === "idle")).toBe(true);
  });

  it("no visitor present: no meeting, no greet — she still lives (arrive/wait in the log)", () => {
    const v = firstVisit();
    advanceCaptain(handle, SPACE, "bex", v.startMs);
    advanceCaptain(handle, SPACE, "bex", v.startMs + 3 * H);
    expect(captains().meetings("bex")).toHaveLength(0);
    expect(bexLog().some((e) => e.kind === "greet")).toBe(false);
    expect(bexLog().some((e) => e.kind === "arrive")).toBe(true);
  });
});

describe("owner controls (A4): stop, budgets, inactive captains", () => {
  it("a stopped captain is total silence; resume restarts the cursor without backfill", () => {
    const v = firstVisit();
    advanceCaptain(handle, SPACE, "bex", v.startMs);
    const stopped = stopCaptain(handle, SPACE, "bex", v.startMs + 30 * 60_000);
    expect(stopped.stopped).toBe(true);
    const logAtStop = bexLog().length;
    expect(bexLog()[0]?.act).toBe("Stopped.");
    advanceCaptain(handle, SPACE, "bex", v.startMs + 6 * H);
    expect(bexLog()).toHaveLength(logAtStop); // silence
    expect(() => askCaptain(handle, SPACE, "bex", "doing", v.startMs + 6 * H)).toThrowError(/stopped/);
    const resumed = resumeCaptain(handle, SPACE, "bex", v.startMs + 6 * H);
    expect(resumed.stopped).toBe(false);
    expect(bexLog()[0]?.act).toBe("Resumed.");
    // Life picks up again from the resume point.
    advanceCaptain(handle, SPACE, "bex", v.startMs + 30 * H);
    expect(bexLog().length).toBeGreaterThan(logAtStop + 1);
  });

  it("the daily act budget ends the day quietly — no error, no acts past the cap", () => {
    const v = firstVisit();
    advanceCaptain(handle, SPACE, "bex", v.startMs); // ensure the row + cursor
    const now = v.startMs + 30 * 60_000;
    for (let i = 0; i < CAPTAIN_MAX_ACTS_PER_DAY; i++) {
      npcLog().appendLog("bex", "wait", "Filler.", "Budget test fill.", now);
    }
    advanceCaptain(handle, SPACE, "bex", v.startMs + 3 * H);
    expect(bexLog().filter((e) => e.act !== "Filler.")).toHaveLength(0);
  });

  it("Dain and Veyra are defined but not flying: no state rows, plain refusals", () => {
    const list = listCaptainStates(handle, SPACE, T0);
    expect(list.map((c) => c.id)).toEqual(["dain", "veyra", "bex"]);
    const dain = list.find((c) => c.id === "dain");
    expect(dain?.active).toBe(false);
    expect(dain?.present).toBe(false);
    expect(dain?.doingLine).toContain("Not flying yet");
    const rows = handle.sqlite
      .prepare(`SELECT npc_id FROM npc_player_state WHERE space_id = ?`)
      .all(SPACE) as { npc_id: string }[];
    expect(rows.map((r) => r.npc_id)).toEqual(["bex"]); // only the active captain persists
    expect(() => askCaptain(handle, SPACE, "dain", "doing", T0)).toThrowError(/isn't flying yet/);
    expect(() => stopCaptain(handle, SPACE, "veyra", T0)).toThrowError(/isn't flying yet/);
    expect(() => getCaptainState(handle, SPACE, "nobody" as never, T0)).toThrowError(CaptainError);
  });

  it("spaces are isolated: another space's Bex has met no one and done nothing", () => {
    const [v] = longVisits();
    if (!v) throw new Error("the test week needs a long visit");
    arrivePlayer(v.world, v.startMs - 120_000);
    advanceCaptain(handle, SPACE, "bex", v.startMs); // cursor at the visit start
    advanceCaptain(handle, SPACE, "bex", v.startMs + 2 * H);
    expect(captains().meetings("bex").length).toBeGreaterThan(0);
    const other = getCaptainState(handle, "spaceB", "bex", v.startMs + 2 * H);
    expect(other.meetingsRemembered).toBe(0);
    expect(bexLog("spaceB")).toHaveLength(0);
  });
});

describe("asking + the Chronicle", () => {
  it("the three L1 questions answer from live state, as what she is", () => {
    const { startMs } = beginFirstSession();
    const doing = askCaptain(handle, SPACE, "bex", "doing", startMs + H + 1000);
    expect(doing.answer).toContain("I'm at");
    const headed = askCaptain(handle, SPACE, "bex", "headed", startMs + H + 2000);
    expect(headed.answer.length).toBeGreaterThan(20);
    const met = askCaptain(handle, SPACE, "bex", "met", startMs + H + 3000);
    expect(met.answer).toContain("haven't met");
    // Every answer is a logged speak with its plain cause.
    const speaks = bexLog().filter((e) => e.kind === "speak");
    expect(speaks).toHaveLength(3);
    expect(speaks.every((e) => e.cause.includes("You asked"))).toBe(true);
  });

  it("the Chronicle reads harbor + captain acts in one feed, newest first", () => {
    npcLog().appendLog("harbor-controller", "wait", "Waited.", "Harbor test line.", T0);
    const { startMs } = beginFirstSession();
    const lines = getChronicle(handle, SPACE, startMs + H, 30);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.map((l) => l.npcId)).toContain("harbor-controller");
    expect(lines.map((l) => l.npcId)).toContain("bex");
    expect(lines[0]?.npcName).toContain("Bex");
    const ids = lines.map((l) => l.id);
    expect([...ids].sort((x, y) => y - x)).toEqual(ids);
  });
});

describe("the bark seam (design §13, templates only)", () => {
  it("TemplateBarkSource is deterministic and grounded in the voice profile", () => {
    const def = captainDefinition("bex");
    if (!def) throw new Error("bex must be defined");
    const src = new TemplateBarkSource();
    const ctx = {
      def,
      world: "great-station" as const,
      worldName: "the Great Station",
      dayKey: "2026-10-22",
      occasionKey: "visit-1",
    };
    const a = src.greeting(ctx);
    expect(a).toBe(src.greeting(ctx));
    expect(def.voice.greetingLines.map((l) => l.replaceAll("{world}", "the Great Station"))).toContain(a);
    const idle = src.idle(ctx);
    expect(def.voice.idleLines.map((l) => l.replaceAll("{world}", "the Great Station"))).toContain(idle);
  });
});
