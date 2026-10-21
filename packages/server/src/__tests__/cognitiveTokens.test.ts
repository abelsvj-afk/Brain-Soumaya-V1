import { describe, it, expect } from "vitest";
import { labelTokens, mentions, anchorMatchTokens } from "../analysis/cognitiveTokens.js";

/** The pure token / name-matching helpers extracted from cognitive.ts (D4). */
describe("cognitiveTokens", () => {
  it("labelTokens lowercases + splits a multi-word label into meaningful tokens", () => {
    const toks = labelTokens("Will Smith");
    expect(toks).toContain("will");
    expect(toks).toContain("smith");
  });

  it("mentions matches on word boundaries, not substrings", () => {
    expect(mentions("I saw Sara today", "sara")).toBe(true);
    expect(mentions("the safari was fun", "sara")).toBe(false); // 'sara' inside 'safari' must NOT match
    expect(mentions("met Ana at 3pm", "ana")).toBe(true);
  });

  it("anchorMatchTokens drops single everyday words so a name never links every memory", () => {
    // A single common word ("will"/"may") is dropped — it would over-link.
    expect(anchorMatchTokens("Will", null)).toEqual([]);
    // A distinctive multi-word name keeps its tokens.
    const toks = anchorMatchTokens("Shaqavia Jones", null);
    expect(toks.length).toBeGreaterThan(0);
  });

  it("anchorMatchTokens ignores a non-array aliases value instead of iterating it", () => {
    // The aliases column can hold any valid JSON (legacy bare string/number/object).
    // Only a real array yields alias tokens; the label's own tokens are unaffected.
    const labelOnly = anchorMatchTokens("Shaqavia Jones", null);
    expect(anchorMatchTokens("Shaqavia Jones", JSON.stringify("girlfriend"))).toEqual(labelOnly);
    expect(anchorMatchTokens("Shaqavia Jones", "42")).toEqual(labelOnly);
    expect(anchorMatchTokens("Shaqavia Jones", JSON.stringify({ a: 1 }))).toEqual(labelOnly);
    // A well-formed array still contributes its alias tokens.
    expect(anchorMatchTokens("Shaqavia Jones", JSON.stringify(["girlfriend"]))).toContain("girlfriend");
  });
});
