import { describe, it, expect, vi, beforeEach } from "vitest";
import { hapticsAllowed, hapticPattern, hapticKindForSfx, triggerHaptic, type HapticEnv } from "./haptics.js";

const ok: HapticEnv = { supported: true, reducedMotion: false, muted: false, hapticsOff: false };

describe("haptics gating (IM-134)", () => {
  it("allows only when supported, unmuted, full-motion and not disabled", () => {
    expect(hapticsAllowed(ok)).toBe(true);
    expect(hapticsAllowed({ ...ok, supported: false })).toBe(false);
    expect(hapticsAllowed({ ...ok, reducedMotion: true })).toBe(false);
    expect(hapticsAllowed({ ...ok, muted: true })).toBe(false);
    expect(hapticsAllowed({ ...ok, hapticsOff: true })).toBe(false);
  });

  it("patterns: tap is a single short pulse; achievement is the distinctive Critical pattern", () => {
    expect(hapticPattern("tap")).toBe(10);
    expect(hapticPattern("memorySaved")).toBe(25);
    expect(hapticPattern("achievement")).toEqual([30, 60, 30]);
  });

  it("pairs haptics with the audit's SFX moments and UI taps only", () => {
    expect(hapticKindForSfx("tap")).toBe("tap");
    expect(hapticKindForSfx("achievement")).toBe("achievement");
    expect(hapticKindForSfx("complete")).toBe("complete");
    expect(hapticKindForSfx("select")).toBeNull();
    expect(hapticKindForSfx("delete")).toBeNull();
  });
});

describe("triggerHaptic", () => {
  beforeEach(() => localStorage.clear());

  it("vibrates on a supported, unmuted device", () => {
    const nav = { vibrate: vi.fn() } as unknown as Navigator;
    expect(triggerHaptic("achievement", nav)).toBe(true);
    expect(nav.vibrate).toHaveBeenCalledWith([30, 60, 30]);
  });

  it("no-ops (no crash) when vibrate is unsupported", () => {
    const nav = {} as unknown as Navigator;
    expect(triggerHaptic("tap", nav)).toBe(false);
    expect(triggerHaptic("tap", undefined)).toBe(false);
  });

  it("respects the mute (sfx.enabled=0)", () => {
    localStorage.setItem("sfx.enabled", "0");
    const nav = { vibrate: vi.fn() } as unknown as Navigator;
    expect(triggerHaptic("tap", nav)).toBe(false);
    expect(nav.vibrate).not.toHaveBeenCalled();
  });

  it("respects the explicit haptics off switch", () => {
    localStorage.setItem("haptics.enabled", "0");
    const nav = { vibrate: vi.fn() } as unknown as Navigator;
    expect(triggerHaptic("memorySaved", nav)).toBe(false);
  });

  it("respects reduced motion (in-app override)", () => {
    localStorage.setItem("brain.reducedMotion", "1");
    const nav = { vibrate: vi.fn() } as unknown as Navigator;
    expect(triggerHaptic("tap", nav)).toBe(false);
    expect(nav.vibrate).not.toHaveBeenCalled();
  });
});
