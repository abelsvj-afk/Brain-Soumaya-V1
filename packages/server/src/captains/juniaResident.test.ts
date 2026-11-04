// ============================================================================
// DRAFT — P1 TEST SCAFFOLDING. Staged in ~/workspace/gate-run/civ-p1-prep/.
// NOT in a repo, NOT runnable against the L1 tree. Lands at P1-B1 task T10
// (needs T3 Junia registered active + T6 leg-based plans) as
// packages/server/src/captains/juniaResident.test.ts after RA-2 re-anchor.
//
// Proves feature F25 (spec §3, by the C2 ruling): Junia is ACTIVE and
// RESIDENT at the Growing Place — her seeded sessions are hosted at her
// home world from her terrace anchor; she greets, waits, and speaks there,
// meets the player there, and her legs depart from and return to a
// non-Station home. Her resident life uses ONLY the L1 verbs: there is no
// tend/gather act in P1 for anyone, Junia included (spec §7).
// Also carries A5's P1 proof: the meeting/wipe cycle at a NON-Station world.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { captainDefinition } from "@brain/shared";
import { NpcRepo } from "../npcs/repo.js";
import { CaptainRepo } from "./repo.js";
import { dayPlan } from "./seed.js";
import {
  advanceCaptain,
  askCaptain,
  getCaptainState,
  listCaptainStates,
  wipeCaptainMeetings,
} from "./engine.js";

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
const juniaLog = (space = SPACE) => new NpcRepo(handle, space).recentLog("junia", 500);

/** Put the visitor in a world and arrive (injected time), as L1's helper. */
function arrivePlayer(world: string, nowMs: number, space = SPACE): void {
  const t = new TravelRepo(handle, space);
  const j = t.depart({ clientKey: `k-${world}-${nowMs}`, kind: "drift", destination: world }, nowMs);
  const arrived = t.arrive(j.id, nowMs + 60_000);
  if (!arrived || arrived.state !== "arrived") throw new Error("test setup: arrival failed");
}

/** Junia's first Growing Place session of the test day (her home world). */
function juniaHomeVisit() {
  // A home visit that opens NO leg (she is already home — the plan
  // chains it from home), long enough for an arrive step plus a
  // meeting/greet step: the session provably begins in place.
  for (let d = 22; d <= 31; d++) {
    const v = dayPlan("junia", `2026-10-${d}`, TZ, "growing-place").find(
      (x) => x.world === "growing-place" && x.legKind === null && x.endMs - x.startMs >= 2 * H,
    );
    if (v) return v;
  }
  throw new Error("Junia's fortnight needs a home session at the Growing Place");
}

describe("F25 — Junia is a second LIVING captain, resident at the Growing Place", () => {
  it("the panel lists eight captains; Bex, Junia and (from P2) Veyra fly, and only they persist rows", () => {
    const list = listCaptainStates(handle, SPACE, T0);
    expect(list.map((c) => c.id)).toEqual(
      ["dain", "veyra", "bex", "junia", "hollis", "sorrel", "yara", "felix"],
    );
    expect(list.filter((c) => c.active).map((c) => c.id).sort()).toEqual(["bex", "junia", "veyra"]);
    const rows = handle.sqlite
      .prepare(`SELECT npc_id FROM npc_player_state WHERE space_id = ? ORDER BY npc_id`)
      .all(SPACE) as { npc_id: string }[];
    expect(rows.map((r) => r.npc_id)).toEqual(["bex", "junia", "veyra"]);
    // Junia's row is born at HER home, with HER anchor.
    const junia = captains().state("junia");
    expect(junia?.homeWorld).toBe("growing-place");
    expect(junia?.homeAnchorLabel).toBe("a tender's cottage-terrace at the Growing Place");
  });

  it("her seeded sessions are hosted at her home world — she arrives, waits and speaks there", () => {
    const v = juniaHomeVisit();
    advanceCaptain(handle, SPACE, "junia", v.startMs); // cursor
    advanceCaptain(handle, SPACE, "junia", v.startMs + H); // arrive step
    const st = captains().state("junia");
    expect(st?.sessionKey).toBe(v.sessionKey);
    expect(st?.currentWorld).toBe("growing-place");
    expect(juniaLog().some((e) => e.kind === "arrive")).toBe(true);
    const wire = getCaptainState(handle, SPACE, "junia", v.startMs + H);
    expect(wire.present).toBe(true);
    expect(wire.homeAnchor).toBe("a tender's cottage-terrace at the Growing Place");
    // Her day also carries her idle bark at home — template source, grounded
    // in HER voice profile (this is where GAP G2 would bite: empty lines).
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(v.startMs));
    const barks = captains().barksForDay("junia", dayKey);
    expect(barks.some((b) => b.context === "idle" && b.source === "template")).toBe(true);
    expect(barks.every((b) => b.text.trim().length > 0)).toBe(true);
  });

  it("A5 at a non-Station world: first meeting 8 at the Growing Place, wipe makes the next a first again", () => {
    const v = juniaHomeVisit();
    // The visitor stands at the Growing Place before she arrives home.
    arrivePlayer("growing-place", v.startMs - 120_000);
    advanceCaptain(handle, SPACE, "junia", v.startMs);
    advanceCaptain(handle, SPACE, "junia", v.startMs + 2 * H); // arrive + meeting
    const meetings = captains().meetings("junia");
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.importance).toBe(8);
    expect(meetings[0]?.text).toContain("first time");
    // She greets the visitor at home — a stored template bark from HER lines.
    const greets = juniaLog().filter((e) => e.kind === "greet");
    expect(greets).toHaveLength(1);
    const def = captainDefinition("junia");
    expect(
      def?.voice.greetingLines.map((l) => l.replaceAll("{world}", "the Growing Place")),
    ).toContain(greets[0]?.act);
    // The wipe works at the Growing Place exactly as at the Station.
    wipeCaptainMeetings(handle, SPACE, "junia", v.startMs + 2 * H + 500);
    expect(captains().meetings("junia")).toHaveLength(0);
    const wiped = askCaptain(handle, SPACE, "junia", "met", v.startMs + 2 * H + 1000);
    expect(wiped.answer).toContain("haven't met");
  });

  it("her legs depart FROM and return TO the Growing Place — a non-Station home, lived", { timeout: 300_000 }, () => {
    // Drive two weeks (6-hour samples — the proof reads the
    // append-only log, which remembers every leg whether or not a
    // sample landed mid-flight): at least one departure bound away
    // from the Growing Place, and a homecoming arrival after it.
    advanceCaptain(handle, SPACE, "junia", T0);
    for (let t = T0 + 6 * H; t <= T0 + 14 * 24 * H; t += 6 * H) {
      advanceCaptain(handle, SPACE, "junia", t);
    }
    const acts = juniaLog();
    const departIdx = acts.findIndex(
      (e) => e.kind === "depart" && e.act.startsWith("Left the Growing Place — bound for"),
    );
    expect(departIdx, "a leg departing her home world").toBeGreaterThanOrEqual(0);
    const homeArrivals = acts.filter((e) => e.kind === "arrive" && e.act.startsWith("Came home to"));
    expect(homeArrivals.length, "a homecoming arrival at the terrace").toBeGreaterThanOrEqual(1);
    // And home never moved while she travelled.
    expect(captains().state("junia")?.homeWorld).toBe("growing-place");
    expect(captains().state("junia")?.homeAnchorLabel).toBe(
      "a tender's cottage-terrace at the Growing Place",
    );
  });

  it("resident life uses only the L1 verbs plus her P3 economy verbs — no tend, no work act of any other kind", () => {
    advanceCaptain(handle, SPACE, "junia", T0);
    advanceCaptain(handle, SPACE, "junia", T0 + 72 * H);
    const kinds = new Set(juniaLog().map((e) => e.kind));
    for (const k of kinds) {
      // P3 re-scope (R5): Junia is an economy captain — gather,
      // sell, refine and the drivers' plan bookkeeping are hers
      // now. "tend" remains on no list, hers included.
      expect(["travel", "arrive", "depart", "greet", "wait", "speak", "gather", "sell", "refine", "plan"]).toContain(k);
    }
    expect(captainDefinition("junia")?.allowList).not.toContain("tend" as never);
    // The kindness rule binds her world's text: nothing wilts, browns, dies.
    const texts = juniaLog().map((e) => `${e.act} ${e.cause}`).join("\n").toLowerCase();
    expect(texts).not.toMatch(/wilt|brown|blight|died|dies\b/);
  });

  it("Bex visiting the Growing Place does not make her a resident of it (spec §4)", () => {
    // Visiting ≠ residing: after any Bex advance, her anchor stays the
    // Station quarter and no code path re-homes her to a visited world.
    advanceCaptain(handle, SPACE, "bex", T0);
    advanceCaptain(handle, SPACE, "bex", T0 + 14 * 24 * H);
    const bex = captains().state("bex");
    expect(bex?.homeWorld).toBe("great-station");
    expect(bex?.homeAnchorLabel).toBe("her Station quarter");
  });
});
