import { describe, it, expect } from "vitest";
import { isWelcomeSeed, ownMemoryCount } from "./welcomeSeed.js";

describe("welcome seed (UX review #3)", () => {
  it("recognises the server's seeded first star only", () => {
    expect(isWelcomeSeed({ label: "The first light", type: "daily" })).toBe(true);
    expect(isWelcomeSeed({ label: "The first light", type: "idea" })).toBe(false);
    expect(isWelcomeSeed({ label: "Guitar", type: "daily" })).toBe(false);
  });
  it("counts only the user's own memories", () => {
    expect(ownMemoryCount([{ label: "The first light", type: "daily" }])).toBe(0);
    expect(
      ownMemoryCount([
        { label: "The first light", type: "daily" },
        { label: "Guitar", type: "idea" },
        { label: "Call mum", type: "daily", kind: "action" },
      ]),
    ).toBe(1);
  });
});
