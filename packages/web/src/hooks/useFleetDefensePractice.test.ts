import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  practiceOutcomeLine,
  useFleetDefensePractice,
} from "./useFleetDefensePractice.js";

/**
 * Scale practice — ephemeral by construction. These tests prove the
 * settled shape: the same loop (same wave, same engine), a win path
 * and a loss path, an outcome that clears/saves nothing, and — the
 * load-bearing property — no network traffic at any point, so a
 * practice round cannot offer, summon, clear, log, or write to a
 * brain record.
 */

describe("useFleetDefensePractice", () => {
  it("starts a small practice round: 3 invaders, active, nothing played yet", () => {
    const { result } = renderHook(() => useFleetDefensePractice());
    act(() => result.current.start("small"));
    expect(result.current.practice).not.toBeNull();
    expect(result.current.practice!.status).toBe("active");
    expect(result.current.practice!.invaders).toHaveLength(3);
    expect(result.current.practice!.tickCount).toBe(0);
    expect(result.current.practice!.lastLine).toBeNull();
  });

  it("an autonomous playthrough wins, and the win clears and saves nothing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useFleetDefensePractice());
    act(() => result.current.start("small"));
    for (let i = 0; i < 20 && result.current.practice!.status === "active"; i++) {
      act(() => result.current.tick("autonomous"));
    }
    expect(result.current.practice!.status).toBe("won");
    expect(result.current.practice!.invaders.every((inv) => inv.dispersed)).toBe(true);
    expect(practiceOutcomeLine(result.current.practice!.status)).toMatch(/nothing was cleared/);
    expect(practiceOutcomeLine(result.current.practice!.status)).toMatch(/nothing was saved/);
    expect(practiceOutcomeLine(result.current.practice!.status)).not.toMatch(/charge was let go/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("firing down an empty lane every round loses, and the loss costs nothing", () => {
    const { result } = renderHook(() => useFleetDefensePractice());
    act(() => result.current.start("small"));
    // Lane 1 holds only the first invader; after it disperses, every
    // further lane-1 shot flies wide while lanes 2 and 3 close in.
    for (let i = 0; i < 10 && result.current.practice!.status === "active"; i++) {
      act(() => result.current.tick("helm", 1));
    }
    expect(result.current.practice!.status).toBe("lost");
    expect(practiceOutcomeLine(result.current.practice!.status)).toMatch(/Nothing was lost/);
    expect(practiceOutcomeLine(result.current.practice!.status)).toMatch(/nothing was saved/);
  });

  it("an invalid helm lane is ignored — the round does not advance", () => {
    const { result } = renderHook(() => useFleetDefensePractice());
    act(() => result.current.start("small"));
    act(() => result.current.tick("helm", 9));
    expect(result.current.practice!.status).toBe("active");
    expect(result.current.practice!.tickCount).toBe(0);
  });

  it("ending a round clears it entirely — nothing lingers to be mistaken for a defense", () => {
    const { result } = renderHook(() => useFleetDefensePractice());
    act(() => result.current.start("steady"));
    act(() => result.current.tick("autonomous"));
    expect(result.current.practice!.tickCount).toBe(1);
    act(() => result.current.end());
    expect(result.current.practice).toBeNull();
  });

  it("a resolved round stops taking ticks", () => {
    const { result } = renderHook(() => useFleetDefensePractice());
    act(() => result.current.start("small"));
    for (let i = 0; i < 20 && result.current.practice!.status === "active"; i++) {
      act(() => result.current.tick("autonomous"));
    }
    const wonCount = result.current.practice!.tickCount;
    act(() => result.current.tick("autonomous"));
    expect(result.current.practice!.tickCount).toBe(wonCount);
  });
});
