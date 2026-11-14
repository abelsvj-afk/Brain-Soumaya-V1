import { describe, it, expect } from "vitest";
import { isOwnContent, ownContentCount, hasAgentStar } from "./welcomeSeed.js";

describe("first-run authorship (UX review #3)", () => {
  it("reads authorship from origin, not the label", () => {
    expect(isOwnContent({ origin: "agent" })).toBe(false);
    expect(isOwnContent({ origin: "user" })).toBe(true);
    expect(isOwnContent({})).toBe(true); // legacy rows without origin are the user's
  });
  it("a user note titled like the welcome star still counts as theirs", () => {
    expect(ownContentCount([{ origin: "agent" }, { origin: "user" }])).toBe(1);
  });
  it("counts action items / to-dos as the user's own content", () => {
    expect(ownContentCount([{ origin: "agent" }, { kind: "action" }])).toBe(1);
  });
  it("detects Soumaya's seeded star", () => {
    expect(hasAgentStar([{ origin: "agent" }])).toBe(true);
    expect(hasAgentStar([{ origin: "user" }])).toBe(false);
  });
});
