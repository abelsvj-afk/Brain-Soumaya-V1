import { describe, it, expect } from "vitest";
import { wrapBubbleText } from "./soumayaHelpers.js";

describe("wrapBubbleText (IM-139 speech bubble)", () => {
  it("short text stays on one line", () => {
    expect(wrapBubbleText("There — a new thread linked up.")).toEqual(["There — a new thread linked up."]);
  });
  it("long text wraps at word boundaries within the line cap", () => {
    const lines = wrapBubbleText("I'm worried — twelve of your memories are cooling and they need tending soon please", 34, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(34);
  });
  it("truncation is marked with an ellipsis", () => {
    const lines = wrapBubbleText("word ".repeat(60).trim(), 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("…");
  });
  it("empty text wraps to no lines", () => {
    expect(wrapBubbleText("   ")).toEqual([]);
  });
});
