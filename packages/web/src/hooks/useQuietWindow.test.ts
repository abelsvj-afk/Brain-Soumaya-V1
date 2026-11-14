import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuietWindow, useFirstRunToastHold } from "./useQuietWindow.js";

afterEach(() => vi.useRealTimers());

/** The Performance Mode offer's quiet windows (App: 45 s after Welcome, 30 s after a memory). */
describe("useQuietWindow — Performance Mode quiet timers", () => {
  it("stays quiet for 45 s after the Welcome card, then lifts", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useQuietWindow());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](45_000));
    expect(result.current[0]).toBe(true);
    act(() => vi.advanceTimersByTime(44_999));
    expect(result.current[0]).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current[0]).toBe(false);
  });

  it("a memory added mid-window restarts it for 30 s from that moment", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useQuietWindow());
    act(() => result.current[1](45_000));
    act(() => vi.advanceTimersByTime(40_000));
    act(() => result.current[1](30_000)); // ingest at t=40s
    act(() => vi.advanceTimersByTime(10_000)); // t=50s: the 45s window alone would have lifted
    expect(result.current[0]).toBe(true);
    act(() => vi.advanceTimersByTime(20_000)); // t=70s = 40 + 30
    expect(result.current[0]).toBe(false);
  });

  it("clears its timer on unmount", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useQuietWindow());
    act(() => result.current[1](30_000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useFirstRunToastHold — routine toasts wait for the first memory", () => {
  it("holds while eligible and releases when the first memory lands", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ e }) => useFirstRunToastHold(e, 180_000), { initialProps: { e: true } });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(true);
    rerender({ e: false });
    expect(result.current).toBe(false);
  });

  it("gives up after the cap so a user who never adds anything still gets them", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFirstRunToastHold(true, 180_000));
    act(() => vi.advanceTimersByTime(180_000));
    expect(result.current).toBe(false);
  });

  it("never holds when not eligible", () => {
    const { result } = renderHook(() => useFirstRunToastHold(false));
    expect(result.current).toBe(false);
  });
});
