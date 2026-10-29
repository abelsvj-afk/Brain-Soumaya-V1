import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { loadFoundRelics, markRelicFound, useFoundRelics } from "./relicsFound.js";

beforeEach(() => {
  localStorage.clear();
});

describe("found-relic store", () => {
  it("starts empty and round-trips a find", () => {
    expect(loadFoundRelics("s1").size).toBe(0);
    markRelicFound("s1", "relic-harbor-nail");
    expect(loadFoundRelics("s1")).toEqual(new Set(["relic-harbor-nail"]));
    // Per space: another space stays empty.
    expect(loadFoundRelics("s2").size).toBe(0);
  });

  it("marking twice is a no-op, not a duplicate", () => {
    markRelicFound("s1", "relic-harbor-nail");
    markRelicFound("s1", "relic-harbor-nail");
    expect([...loadFoundRelics("s1")]).toEqual(["relic-harbor-nail"]);
  });

  it("dispatches brain-relic-found so other mounts refresh", () => {
    const seen: string[] = [];
    const onFound = (e: Event) => {
      seen.push((e as CustomEvent<{ key: string }>).detail.key);
    };
    window.addEventListener("brain-relic-found", onFound);
    markRelicFound("s1", "relic-dawn-leaf");
    expect(seen).toEqual(["relic-dawn-leaf"]);
    window.removeEventListener("brain-relic-found", onFound);
  });
});

describe("useFoundRelics", () => {
  it("reflects a find made elsewhere without a reload", () => {
    const { result } = renderHook(() => useFoundRelics("s1"));
    expect(result.current.size).toBe(0);
    act(() => {
      markRelicFound("s1", "relic-witness-without-a-name");
    });
    expect(result.current).toEqual(new Set(["relic-witness-without-a-name"]));
  });

  // Regression: the mount reload used to return a NEW Set with identical
  // contents, which re-rendered every consumer, recomputed the Codex
  // entries, and cancelled the in-flight claim loop — swallowing its
  // failure toast (CodexPanel.test.tsx, "does not mark an entry seen when
  // its claim fails"). The identity must be stable when nothing changed.
  it("keeps the same Set identity when the store is unchanged", () => {
    markRelicFound("s1", "relic-harbor-nail");
    const { result } = renderHook(() => useFoundRelics("s1"));
    const first = result.current;
    expect(first).toEqual(new Set(["relic-harbor-nail"]));
    act(() => {
      // A find in ANOTHER space fires the event but changes nothing here.
      markRelicFound("s2", "relic-dawn-leaf");
    });
    expect(result.current).toBe(first);
  });

  it("changes identity only when a find actually lands in this space", () => {
    const { result } = renderHook(() => useFoundRelics("s1"));
    const first = result.current;
    act(() => {
      markRelicFound("s1", "relic-harbor-nail");
    });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual(new Set(["relic-harbor-nail"]));
  });
});
