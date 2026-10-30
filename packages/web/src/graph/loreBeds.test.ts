import { describe, expect, it } from "vitest";
import { bedForWorld } from "./loreBeds.js";

describe("lore beds", () => {
  it("each place gets the bed the music spec gives it, the warm one by default", () => {
    expect(bedForWorld("deep-past")).toBe("morning");
    expect(bedForWorld("quiet-archive")).toBe("hush");
    expect(bedForWorld("eternity")).toBe("standing");
    expect(bedForWorld("growing-place")).toBe("hearth");
    expect(bedForWorld("people")).toBe("hearth");
    expect(bedForWorld(null)).toBe("hearth");
  });
});
