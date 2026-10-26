import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePolledCount } from "./usePolledCount.js";

// Batch G, REG-196 (RC-03): a failed count refresh must never present 0 as the
// due count — the hook reports "unknown" (null) until a refresh succeeds, and
// a failed refresh returns to unknown instead of holding a stale number as if
// it were fresh (and never the initial 0).
afterEach(() => vi.useRealTimers());

describe("usePolledCount — unknown, not zero, on failure (REG-196)", () => {
  it("starts unknown (null), not 0, before the first successful poll", () => {
    const f = vi.fn().mockResolvedValue(5);
    const { result } = renderHook(() => usePolledCount(f, true, 100_000));
    expect(result.current).toBeNull();
  });

  it("a failed first fetch stays unknown instead of presenting 0", async () => {
    const f = vi.fn().mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => usePolledCount(f, true, 100_000));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    // Let the rejection settle — the count must still be unknown, never 0.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });

  it("a failed refresh after a success returns to unknown", async () => {
    const f = vi.fn().mockResolvedValueOnce(4).mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => usePolledCount(f, true, 50));
    await waitFor(() => expect(result.current).toBe(4));
    await waitFor(() => expect(result.current).toBeNull(), { timeout: 3000 });
  });

  it("recovers to the fresh count when the server answers again", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("server down")).mockResolvedValue(7);
    const { result } = renderHook(() => usePolledCount(f, true, 50));
    await waitFor(() => expect(result.current).toBe(7), { timeout: 3000 });
  });
});
