import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { announcePlace, useWorldPlace, HOME_PLACE } from "./worldPlace.js";

describe("useWorldPlace", () => {
  it("follows what the worlds layer announces, and returns home when it hides", () => {
    const { result } = renderHook(() => useWorldPlace());
    expect(result.current).toEqual(HOME_PLACE);
    act(() => announcePlace(true, { world: "deep-past", transit: false }));
    expect(result.current).toEqual({ world: "deep-past", transit: false });
    act(() => announcePlace(true, { world: null, transit: true }));
    expect(result.current).toEqual({ world: null, transit: true });
    act(() => announcePlace(false, HOME_PLACE));
    expect(result.current).toEqual(HOME_PLACE);
  });
});
