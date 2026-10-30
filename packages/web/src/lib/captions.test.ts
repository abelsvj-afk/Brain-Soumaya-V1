import { describe, expect, it } from "vitest";
import { sentenceAt, splitCaptionSentences } from "./captions.js";

describe("captions that follow the voice", () => {
  const text = "A woman with no face sits at a table. The table is set for one more. The crayon has torn the paper at the mouth.";
  it("splits into sentences without losing a word", () => {
    const s = splitCaptionSentences(text);
    expect(s).toHaveLength(3);
    expect(s.join(" ")).toBe(text);
  });
  it("keeps closing quotes with their sentence and copes with no final stop", () => {
    expect(splitCaptionSentences("She said “it opens inward.” Then nothing")).toEqual(["She said “it opens inward.”", "Then nothing"]);
    expect(splitCaptionSentences("")).toEqual([]);
  });
  it("marks the sentence being read, weighted by how much speech each holds", () => {
    const s = ["Short.", "A much longer sentence that takes far more of the voice.", "End."];
    expect(sentenceAt(s, 0)).toBe(0);
    expect(sentenceAt(s, 0.05)).toBe(0);
    expect(sentenceAt(s, 0.4)).toBe(1);
    expect(sentenceAt(s, 0.99)).toBe(2);
    expect(sentenceAt(s, 1)).toBe(2); // the clip's last instant stays on the last sentence
  });
  it("marks nothing when not speaking", () => {
    expect(sentenceAt(["One."], null)).toBe(-1);
    expect(sentenceAt([], 0.5)).toBe(-1);
    expect(sentenceAt(["One."], Number.NaN)).toBe(-1);
  });
});
