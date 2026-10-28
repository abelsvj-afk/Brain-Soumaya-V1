import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { EMPTY_UNLOCK_STATS, type UnlockStats, type UnlockableItem } from "@brain/shared";
import { useUnlockWatcher } from "./useUnlockWatcher.js";

const stats = (over: Partial<UnlockStats> = {}): UnlockStats => ({ ...EMPTY_UNLOCK_STATS, ...over });

beforeEach(() => localStorage.clear());

/**
 * Batch O — REG-177 (HN-03): one physical asset produces one unlock
 * celebration. The Dyson sphere and the black hole each exist twice in
 * the catalog (figurine + scenery twins, same asset + condition); the
 * watcher must celebrate the same set the Hangar counts (IM-97:
 * scenery excluded), so a capstone unlock fires once, not twice.
 * Fails on the pre-change watcher, which diffs the whole catalog.
 */
describe("REG-177 (HN-03) — scenery twins are not separate unlocks", () => {
  it("crossing 250 memories celebrates the Dyson figurine once, never its scenery twin", () => {
    const onUnlock = vi.fn<(item: UnlockableItem) => void>();
    const { rerender } = renderHook(
      ({ s }: { s: UnlockStats }) => useUnlockWatcher({ stats: s, spaceId: "s1", onUnlock }),
      { initialProps: { s: stats({ memoriesCount: 0 }) } },
    );
    expect(onUnlock).not.toHaveBeenCalled();
    rerender({ s: stats({ memoriesCount: 250 }) });
    const ids = onUnlock.mock.calls.map((c) => c[0].id);
    expect(ids).toContain("figurine-dyson-sphere");
    expect(ids).not.toContain("scenery-dyson-sphere");
    expect(ids.filter((id) => id === "figurine-dyson-sphere")).toHaveLength(1);
    // No scenery id ever celebrates.
    expect(ids.every((id) => !id.startsWith("scenery-"))).toBe(true);
  });

  it("Codex 100% celebrates both capstones once each — two assets, two celebrations", () => {
    const onUnlock = vi.fn<(item: UnlockableItem) => void>();
    const { rerender } = renderHook(
      ({ s }: { s: UnlockStats }) => useUnlockWatcher({ stats: s, spaceId: "s2", onUnlock }),
      { initialProps: { s: stats({ memoriesCount: 0 }) } },
    );
    rerender({ s: stats({ codexPct: 100 }) });
    const ids = onUnlock.mock.calls.map((c) => c[0].id);
    expect(ids).toContain("figurine-dyson-sphere");
    expect(ids).toContain("figurine-blackhole");
    expect(ids.filter((id) => id.startsWith("scenery-"))).toHaveLength(0);
    // One celebration per physical asset (equipValue), not per catalog row.
    const byAsset = ids.map((id) => id.replace(/^(figurine|scenery)-/, ""));
    expect(new Set(byAsset).size).toBe(byAsset.length);
  });
});
