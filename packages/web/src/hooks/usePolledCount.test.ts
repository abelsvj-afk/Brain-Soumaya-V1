import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePolledCount } from "./usePolledCount.js";

afterEach(() => vi.useRealTimers());

describe("usePolledCount", () => {
  it("does not fetch while disabled", () => {
    const f = vi.fn().mockResolvedValue(3);
    renderHook(() => usePolledCount(f, false, 1000));
    expect(f).not.toHaveBeenCalled();
  });

  it("fetches immediately when enabled and exposes the count", async () => {
    const f = vi.fn().mockResolvedValue(5);
    const { result } = renderHook(() => usePolledCount(f, true, 100_000));
    await waitFor(() => expect(result.current).toBe(5));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("re-polls on the interval", async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValue(1);
    renderHook(() => usePolledCount(f, true, 1000));
    expect(f).toHaveBeenCalledTimes(1); // the immediate load
    await vi.advanceTimersByTimeAsync(1000);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe("usePolledCount — unknown is null, never 0 (Batch H, REG-201 / CN-02)", () => {
  it("starts unknown (null) before the first poll resolves — not 0", () => {
    const f = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => usePolledCount(f, true, 100_000));
    expect(result.current).toBeNull();
  });

  it("a failed re-poll reports unknown (null), not the stale value and not 0", async () => {
    const f = vi.fn().mockResolvedValueOnce(5).mockRejectedValueOnce(new Error("down"));
    const { result, rerender } = renderHook(
      ({ k }: { k: number }) => usePolledCount(f, true, 100_000, { refreshKey: k }),
      { initialProps: { k: 0 } },
    );
    await waitFor(() => expect(result.current).toBe(5));
    rerender({ k: 1 });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("a failed first poll is unknown, and a later success restores the number", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(7);
    const { result, rerender } = renderHook(
      ({ k }: { k: number }) => usePolledCount(f, true, 100_000, { refreshKey: k }),
      { initialProps: { k: 0 } },
    );
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
    rerender({ k: 1 });
    await waitFor(() => expect(result.current).toBe(7));
  });
});
