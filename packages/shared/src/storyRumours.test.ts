import { describe, expect, it } from "vitest";
import { NPC_CAST } from "./npcs.js";
import { STORY_RUMOURS, checkStoryRumours, rumourFor } from "./storyRumours.js";

describe("seam rumours", () => {
  it("are well formed, one per seam, said by real people", () => {
    expect(checkStoryRumours(STORY_RUMOURS, new Set(NPC_CAST.map((c) => c.id)))).toEqual([]);
    expect(new Set(STORY_RUMOURS.map((r) => r.seam)).size).toBe(8);
  });
  it("wait for a few meetings and never state what the silence holds", () => {
    expect(rumourFor("cantor", 1)).toBeNull();
    expect(rumourFor("cantor", 3)?.seam).toBe("S-I");
    expect(rumourFor("harbor-controller", 9)).toBeNull();
    for (const r of STORY_RUMOURS) expect(r.line).not.toMatch(/\b(because|the reason|is actually|in fact)\b/i);
  });
});
