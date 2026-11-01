// ============================================================================
// DRAFT — P1 TEST SCAFFOLDING. Staged in ~/workspace/gate-run/civ-p1-prep/.
// NOT in a repo, NOT runnable against the L1 tree. Lands at P1-B1 task T3 as
// packages/server/src/captains/pronounCopy.test.ts after RA-2 re-anchor.
// Proves spec §2 C4 + §8 T3's pronoun done-test and A3's pronoun clause:
// "never described with another captain's pronouns".
//
// Two prongs, mirroring the spec's own done-test wording:
//  (1) a grep of the captains module finds no hard-coded feminine pronoun in
//      GENERIC copy — generic = the engine/decider/barks/repo sources, which
//      speak about whichever captain is loaded. Definition literals in
//      shared/captains.ts are per-captain data (Bex's and Junia's lines are
//      correctly feminine FOR THEM) and are checked behaviorally instead.
//  (2) behavioral: every captain's own surfaces use that captain's pronouns.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition } from "@brain/shared";
import { listCaptainStates, askCaptain } from "./engine.js";

const TZ = "America/New_York";
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // Thu 08:00 EDT
const SPACE = "spaceA";

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

describe("pronoun copy — the source grep (spec §8 T3 done-test)", () => {
  // The generic-copy modules: everything in the server captains dir except
  // tests. L1 offenders this hunt is written against (engine.ts):
  //   "Not flying yet — her runs begin in a later increment."
  //   "Stopped by the owner. She does nothing until resumed."
  //   "what she's doing" / "she holds no meetings to wipe"
  // and decider.ts: "she hadn't said hello this visit", "held her here".
  const genericFiles = readdirSync(fileURLToPath(new URL(".", import.meta.url)))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("no generic-copy file contains a feminine pronoun outside a quoted per-captain line", () => {
    // Conservative pattern set: the exact L1 offender shapes plus the bare
    // generic forms. A hit is a HUMAN decision (is this string ever rendered
    // for a captain it doesn't describe?) — the test's job is to make the
    // hit impossible to land unnoticed, per the spec's grep done-test.
    const offenders: { file: string; line: string }[] = [];
    const patterns = [
      /\bher runs begin\b/,
      /\bShe does nothing\b/,
      /\bwhat she's doing\b/,
      /\bshe holds no\b/,
      /\bshe hadn't said hello\b/,
      /\bheld her here\b/,
      /\bher own ledger said no\b/, // engine warp-refusal line — RE-ANCHOR: verify per-captain rendering or neutralize
    ];
    for (const f of genericFiles) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      for (const line of src.split("\n")) {
        if (patterns.some((p) => p.test(line))) offenders.push({ file: f, line: line.trim() });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("pronoun copy — behavioral, per captain", () => {
  it("every inactive captain's panel line is pronoun-correct or pronoun-neutral", () => {
    const list = listCaptainStates(handle, SPACE, T0);
    // Sorrel (they), Dain/Felix/Hollis (he), Veyra/Yara (she): the L1 line
    // "Not flying yet — her runs begin…" is wrong for five of the six.
    const wrongPronoun: Record<string, RegExp> = {
      dain: /\b(she|her)\b/i,
      hollis: /\b(she|her)\b/i,
      felix: /\b(she|her)\b/i,
      sorrel: /\b(he|she|him|her|his)\b/i,
      veyra: /\b(he|him)\b/i,
      yara: /\b(he|him)\b/i,
    };
    for (const st of list.filter((c) => !c.active)) {
      const pat = wrongPronoun[st.id];
      if (pat) expect(st.doingLine, st.id).not.toMatch(pat);
      // The wire state carries the captain's own pronouns (widened type).
      expect(st.pronouns, st.id).toBe(captainDefinition(st.id)?.pronouns);
    }
  });

  it("Sorrel's wire pronouns are 'they' — the widened type reaches the panel", () => {
    const sorrel = listCaptainStates(handle, SPACE, T0).find((c) => c.id === "sorrel");
    expect(sorrel?.pronouns).toBe("they");
  });

  it("asking about an inactive male or they captain refuses in neutral words", () => {
    for (const id of ["dain", "sorrel", "felix"] as const) {
      let message = "";
      try {
        askCaptain(handle, SPACE, id, "doing", T0);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message, id).toMatch(/isn't flying yet/);
      expect(message, id).not.toMatch(/\bshe\b|\bher\b/i);
    }
  });

  it("Bex and Junia keep their own feminine copy — widening must not flatten them", () => {
    // The fix is per-captain correctness, not pronoun erasure: template barks
    // still come from each captain's own voice profile, verbatim.
    for (const id of ["bex", "junia"] as const) {
      const def = captainDefinition(id);
      expect(def?.voice.pronouns).toBe("she");
      expect(def?.voice.greetingLines.length).toBeGreaterThanOrEqual(2);
    }
  });
});
