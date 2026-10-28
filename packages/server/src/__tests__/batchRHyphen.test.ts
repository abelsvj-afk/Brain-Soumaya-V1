import { describe, it, expect } from "vitest";
import { tokenize, matchesAnchor } from "../analysis/timeline.js";

/**
 * REG-229 — a label must not match a segment of a hyphenated compound
 * unless the compound is genuinely a mention of it. The old tokenizer
 * split on hyphens, so "state-of-the-art" became ["state","of","the","art"]
 * and "Art" matched it; "Run" matched "home-run" the same way.
 *
 * Fail-before: on the pre-fix code the "Art" / "Run" / "Mary" cases below
 * return true (segment match); the genuine-mention cases already pass.
 */
describe("REG-229 — labels never match inside a hyphen compound", () => {
  it("the register's regression case: 'Art' does not match 'state-of-the-art'", () => {
    expect(matchesAnchor(tokenize("state-of-the-art design"), tokenize("Art"))).toBe(false);
  });

  it("'Run' does not match 'home-run'", () => {
    expect(matchesAnchor(tokenize("a home-run hitter"), tokenize("Run"))).toBe(false);
  });

  it("a single segment never matches a compound, at either end", () => {
    expect(matchesAnchor(tokenize("state-of-the-art design"), tokenize("State"))).toBe(false);
    expect(matchesAnchor(tokenize("state-of-the-art design"), tokenize("Mary"))).toBe(false);
  });

  it("a partial phrase never matches a compound either", () => {
    expect(matchesAnchor(tokenize("state-of-the-art design"), tokenize("state of"))).toBe(false);
    expect(matchesAnchor(tokenize("state-of-the-art design"), tokenize("of the art"))).toBe(false);
  });

  it("genuine mentions still match: whole compound as a phrase", () => {
    expect(matchesAnchor(tokenize("state-of-the-art design"), tokenize("state of the art"))).toBe(true);
    expect(matchesAnchor(tokenize("the state-of-the-art design"), tokenize("State-of-the-Art"))).toBe(true);
  });

  it("genuine mentions still match: 'Mary Jane' matches 'Mary-Jane'", () => {
    expect(matchesAnchor(tokenize("Mary-Jane went home"), tokenize("Mary Jane"))).toBe(true);
    expect(matchesAnchor(tokenize("Mary-Jane went home"), tokenize("Mary-Jane"))).toBe(true);
  });

  it("REG-122 still holds: 'Sam' never matches 'same', possessive still counts", () => {
    expect(matchesAnchor(tokenize("same old story"), tokenize("Sam"))).toBe(false);
    expect(matchesAnchor(tokenize("Sam's new plan"), tokenize("Sam"))).toBe(true);
    expect(matchesAnchor(tokenize("start the run"), tokenize("Art"))).toBe(false);
    expect(matchesAnchor(tokenize("start the run"), tokenize("Run"))).toBe(true);
  });

  it("tokenize keeps a compound whole but still splits possessives", () => {
    expect(tokenize("state-of-the-art design")).toEqual(["state-of-the-art", "design"]);
    expect(tokenize("Sam's plan")).toEqual(["sam", "s", "plan"]);
  });
});
