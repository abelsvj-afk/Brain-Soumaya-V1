import { describe, it, expect } from "vitest";
import { MAX_PORTRAIT_FIT, portraitFit, REFERENCE_ASPECT } from "./worldCamera.js";

describe("portraitFit", () => {
  it("never moves the camera closer than the tuned distance on a wide screen", () => {
    expect(portraitFit(REFERENCE_ASPECT)).toBe(1);
    expect(portraitFit(2.4)).toBe(1);
  });
  it("backs off on a phone, by a bounded amount", () => {
    const phone = portraitFit(412 / 915);
    expect(phone).toBeGreaterThan(1.7);
    expect(phone).toBeLessThanOrEqual(MAX_PORTRAIT_FIT);
    expect(portraitFit(0.1)).toBe(MAX_PORTRAIT_FIT);
  });
  it("is monotonic: narrower never gets closer", () => {
    let prev = 0;
    for (const a of [2, 1.6, 1.2, 0.9, 0.6, 0.45, 0.3]) {
      const f = portraitFit(a);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
  it("survives nonsense", () => {
    expect(portraitFit(NaN)).toBe(1);
    expect(portraitFit(0)).toBe(1);
    expect(portraitFit(-1)).toBe(1);
  });
});
