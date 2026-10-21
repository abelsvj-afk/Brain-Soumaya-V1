import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { EMPTY_UNLOCK_STATS, type UnlockStats, type UnlockableItem } from "@brain/shared";
import { useUnlockWatcher } from "./useUnlockWatcher.js";

const stats = (over: Partial<UnlockStats> = {}): UnlockStats => ({ ...EMPTY_UNLOCK_STATS, ...over });

beforeEach(() => localStorage.clear());

/**
 * IM-133: the celebration watcher — seeds silently on first evaluation,
 * fires exactly once per newly unlocked item, never re-fires.
 */
describe("useUnlockWatcher (IM-133)", () => {
  it("seeds silently: already-unlocked items never celebrate on first evaluation", () => {
    const onUnlock = vi.fn<(item: UnlockableItem) => void>();
    renderHook(() =>
      useUnlockWatcher({ stats: stats({ memoriesCount: 100 }), spaceId: "s1", onUnlock }),
    );
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("fires once when an item newly unlocks (the music path), then never again", () => {
    const onUnlock = vi.fn<(item: UnlockableItem) => void>();
    const { rerender } = renderHook(
      ({ s }: { s: UnlockStats }) => useUnlockWatcher({ stats: s, spaceId: "s1", onUnlock }),
      { initialProps: { s: stats({ memoriesCount: 24 }) } },
    );
    expect(onUnlock).not.toHaveBeenCalled();
    rerender({ s: stats({ memoriesCount: 25 }) });
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(onUnlock.mock.calls[0]![0].id).toBe("music-slow-tide");
    rerender({ s: stats({ memoriesCount: 25 }) });
    rerender({ s: stats({ memoriesCount: 30 }) });
    expect(onUnlock).toHaveBeenCalledTimes(1);
    // A later batch fires its own items (100 memories: Interstellar + Star Center).
    rerender({ s: stats({ memoriesCount: 100 }) });
    const ids = onUnlock.mock.calls.map((c) => c[0].id);
    expect(ids).toContain("music-interstellar");
    expect(ids).toContain("figurine-star-center");
    expect(ids.filter((id) => id === "music-slow-tide").length).toBe(1);
  });

  it("persists the celebrated set: a fresh mount for the same brain does not re-fire", () => {
    const onUnlock = vi.fn<(item: UnlockableItem) => void>();
    const first = renderHook(
      ({ s }: { s: UnlockStats }) => useUnlockWatcher({ stats: s, spaceId: "s2", onUnlock }),
      { initialProps: { s: stats() } },
    );
    first.rerender({ s: stats({ memoriesCount: 25 }) });
    expect(onUnlock).toHaveBeenCalledTimes(1);
    first.unmount();
    const onUnlock2 = vi.fn<(item: UnlockableItem) => void>();
    renderHook(() => useUnlockWatcher({ stats: stats({ memoriesCount: 25 }), spaceId: "s2", onUnlock: onUnlock2 }));
    expect(onUnlock2).not.toHaveBeenCalled();
  });

  it("with dev-unlock-all on, nothing ever fires (everything was already available)", () => {
    const onUnlock = vi.fn<(item: UnlockableItem) => void>();
    const { rerender } = renderHook(
      ({ s }: { s: UnlockStats }) =>
        useUnlockWatcher({ stats: s, spaceId: "s3", devUnlockAll: true, onUnlock }),
      { initialProps: { s: stats() } },
    );
    rerender({ s: stats({ memoriesCount: 500 }) });
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("does nothing without stats or a space", () => {
    const onUnlock = vi.fn<(item: UnlockableItem) => void>();
    renderHook(() => useUnlockWatcher({ stats: null, spaceId: null, onUnlock }));
    expect(onUnlock).not.toHaveBeenCalled();
  });
});
