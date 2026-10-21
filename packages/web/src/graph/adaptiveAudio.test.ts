import { describe, it, expect, vi } from "vitest";
import { panForScreenX, densityBedGain, bedFilterFreq, nextChirpDelayMs, createChirpScheduler } from "./adaptiveAudio.js";

describe("panForScreenX (IM-135 spatial mapping)", () => {
  it("maps normalized screen x 0..1 to pan -1..1", () => {
    expect(panForScreenX(0)).toBe(-1);
    expect(panForScreenX(0.5)).toBe(0);
    expect(panForScreenX(1)).toBe(1);
    expect(panForScreenX(0.25)).toBe(-0.5);
  });
  it("clamps off-screen positions and non-finite input", () => {
    expect(panForScreenX(-3)).toBe(-1);
    expect(panForScreenX(7)).toBe(1);
    expect(panForScreenX(Number.NaN)).toBe(0);
  });
  it("accepts NDC input directly", () => {
    expect(panForScreenX(-0.4, { ndc: true })).toBe(-0.4);
    expect(panForScreenX(2, { ndc: true })).toBe(1);
  });
});

describe("densityBedGain (IM-135 density ducking)", () => {
  it("an empty/small galaxy keeps the full bed", () => {
    expect(densityBedGain(0, 0)).toBe(1);
    expect(densityBedGain(10, 5)).toBeCloseTo(0.99, 5);
  });
  it("a large dense galaxy ducks, but never below the floor", () => {
    const g = densityBedGain(500, 1500);
    expect(g).toBeLessThan(0.8);
    expect(densityBedGain(5000, 50000)).toBe(0.55);
  });
  it("is monotonic: more nodes never raises the gain", () => {
    expect(densityBedGain(200, 200)).toBeLessThanOrEqual(densityBedGain(50, 50));
  });
});

describe("bedFilterFreq (IM-135 emotional brightening/darkening)", () => {
  it("a warm galaxy is brighter than a heavy one", () => {
    expect(bedFilterFreq(1, 0)).toBeGreaterThan(bedFilterFreq(-1, 0));
    expect(bedFilterFreq(0, 0)).toBe(3200);
  });
  it("mass cooling darkens the bed", () => {
    expect(bedFilterFreq(0, 1)).toBeLessThan(bedFilterFreq(0, 0));
  });
  it("stays inside the audible clamp for extreme inputs", () => {
    expect(bedFilterFreq(99, 99)).toBeLessThanOrEqual(6500);
    expect(bedFilterFreq(-99, 1)).toBeGreaterThanOrEqual(900);
  });
});

describe("chirp scheduling (IM-135 sparse life, 20–60s)", () => {
  it("delays are always within 20s..60s", () => {
    expect(nextChirpDelayMs(() => 0)).toBe(20000);
    expect(nextChirpDelayMs(() => 0.99999)).toBeLessThanOrEqual(60000);
    expect(nextChirpDelayMs(() => 0.5)).toBe(40000);
  });

  it("scheduler fires, re-arms with a fresh delay, and stops cleanly", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const setTimeoutFake = (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    };
    const clearTimeoutFake = vi.fn();
    const onChirp = vi.fn();
    const s = createChirpScheduler(onChirp, { rand: () => 0, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake });
    s.start();
    expect(s.running).toBe(true);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(20000);
    timers[0]!.fn();
    expect(onChirp).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(2); // re-armed
    s.stop();
    expect(s.running).toBe(false);
    expect(clearTimeoutFake).toHaveBeenCalled();
    timers[1]!.fn(); // a late fire after stop must not chirp
    expect(onChirp).toHaveBeenCalledTimes(1);
  });

  it("a throwing chirp does not kill the schedule", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const s = createChirpScheduler(
      () => { throw new Error("boom"); },
      { rand: () => 0, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 1; }, clearTimeout: () => {} },
    );
    s.start();
    expect(() => timers[0]!.fn()).not.toThrow();
    expect(timers).toHaveLength(2);
    s.stop();
  });
});
