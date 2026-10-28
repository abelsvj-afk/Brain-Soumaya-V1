import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader App.batchB.test.ts uses (vitest's
 *  import.meta.url is not a file URL in this harness). */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

/**
 * Batch O — App-level wiring pins (App.tsx is not mounted by any harness
 * in this repo; its wiring is pinned textually, the App.batchB.test.ts
 * pattern). All pins fail on the pre-change App.tsx.
 *
 *  REG-171 (SF-06): shipViewMode persists per brain like showShipTask.
 *  REG-178 (HN-04): simultaneous unlocks queue their celebration cards.
 *  REG-181 (HN-07): a transient trail preview reaches the galaxy scene.
 */
const appSrc = readRepoFile("src/App.tsx");
const dockSrc = readRepoFile("src/components/RightDock.tsx");

function window_(src: string, from: string, len: number): string {
  const a = src.indexOf(from);
  expect(a, `anchor ${from}`).toBeGreaterThan(-1);
  return src.slice(a, a + len);
}

describe("REG-171 (SF-06) — the camera-mode choice persists per brain", () => {
  it("shipViewMode reads/writes a per-brain key with the legacy global fallback", () => {
    const w = window_(appSrc, "shipViewMode", 1200);
    expect(w).toContain("ship.view.${space.id}");
    expect(w).toContain("localStorage.setItem");
    expect(w).toContain("ship.view");
  });

  it("the per-brain value loads when the space changes, like showShipTask", () => {
    // The showShipTask effect is the pattern; shipViewMode's effect sits beside it.
    const w = window_(appSrc, "setShipViewModeState", 900);
    expect(w).toContain("space?.id");
  });
});

describe("REG-178 (HN-04) — unlock celebrations queue instead of overwriting", () => {
  it("App celebrates through the queue hook, not a single slot", () => {
    expect(appSrc).toContain("useCelebrationQueue");
    const w = window_(appSrc, "onUnlock: (item)", 400);
    expect(w).toContain("enqueue");
    expect(w).not.toContain("setUnlockMoment(item)");
  });

  it("the celebration card dismisses to the next queued item", () => {
    const w = window_(appSrc, "<UnlockCelebration", 200);
    expect(w).toContain("dismiss");
    expect(w).not.toContain("setUnlockMoment(null)");
  });
});

describe("REG-181 (HN-07) — the trail preview reaches the scene transiently", () => {
  it("App holds a transient preview override and feeds it to the galaxy", () => {
    expect(appSrc).toContain("previewTrail");
    expect(appSrc).toContain("equippedTrail={previewTrail ?? equippedTrail}");
  });

  it("previewing a trail focuses the ship, and equipping clears the preview", () => {
    const w = window_(appSrc, "handlePreviewTrail", 500);
    expect(w).toContain('handleViewInGalaxy("ship")');
    // The equip-refresh path (handleChanged id === -1) clears the override.
    const h = window_(appSrc, "const handleChanged = useCallback", 1200);
    expect(h).toContain("setPreviewTrail(null)");
  });

  it("RightDock passes the preview state and callback down to the Hangar", () => {
    expect(dockSrc).toContain("onPreviewTrail");
    expect(dockSrc).toContain("previewTrail");
    const w = window_(dockSrc, "<HangarPanel", 800);
    expect(w).toContain("onPreviewTrail={onPreviewTrail}");
    expect(w).toContain("previewTrail={previewTrail}");
  });
});
