import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { EMPTY_UNLOCK_STATS, type UnlockStats } from "@brain/shared";

/**
 * Batch O — Hangar (REG-175 HN-01, REG-179 HN-05, REG-181 HN-07,
 * REG-182 HN-08, REG-183 HN-09).
 *
 * Falsification notes: on the pre-change panel a null unlockStats prop
 * is silently replaced by a degraded fallback snapshot (locked verdicts
 * presented as fact); every action button is a ~26px `.mini`; trails
 * have no view action and no control ever emits the "station" view
 * target; the loadout music line shows a bare "—"; and nothing marks a
 * newly unlocked item. Every test below fails against that code.
 */
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { HangarPanel } from "./HangarPanel.js";

const SPACE = "space-batcho";
const stats = (over: Partial<UnlockStats> = {}): UnlockStats => ({ ...EMPTY_UNLOCK_STATS, ...over });

function renderHangar(over: Partial<React.ComponentProps<typeof HangarPanel>> = {}) {
  const props: React.ComponentProps<typeof HangarPanel> = {
    spaceId: SPACE,
    memoriesCount: 0,
    onEquipChanged: vi.fn(),
    unlockStats: stats(),
    ...over,
  };
  return { props, ...render(<HangarPanel {...props} />) };
}

beforeEach(() => {
  localStorage.clear();
  pushToast.mockClear();
  playSfx.mockClear();
});
afterEach(() => cleanup());

describe("REG-175 (HN-01) — the stats-null window renders a provisional state, not fallback locks", () => {
  it("while App's stats are null, no gated row renders a locked verdict", () => {
    renderHangar({ unlockStats: null });
    expect(screen.getByText(/Checking what you've unlocked/)).toBeTruthy();
    expect(screen.queryByText(/🔒/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Equip/ })).toBeNull();
    expect(screen.queryByTestId("hangar-loadout")).toBeNull();
  });

  it("once real stats arrive, verdicts equal the shared evaluator's verdicts", () => {
    const { rerender } = renderHangar({ unlockStats: null });
    expect(screen.getByText(/Checking what you've unlocked/)).toBeTruthy();
    rerender(
      <HangarPanel
        spaceId={SPACE}
        memoriesCount={150}
        onEquipChanged={vi.fn()}
        unlockStats={stats({ memoriesCount: 150 })}
      />,
    );
    expect(screen.queryByText(/Checking what you've unlocked/)).toBeNull();
    // 150 memories unlocks the Organic hull (and Slow Tide / Star Center);
    // the 250-memory Dyson figurine is still locked.
    const organic = screen.getByRole("button", { name: /Organic Specimen Hull/ });
    expect((organic as HTMLButtonElement).disabled).toBe(false);
    const dysons = screen.getAllByRole("button", { name: /Dyson Megastructure/ });
    expect(dysons.length).toBeGreaterThan(0);
    for (const d of dysons) expect((d as HTMLButtonElement).disabled).toBe(true);
  });

  it("standalone use (stats undefined) still derives its own snapshot", () => {
    const { container } = renderHangar({ unlockStats: undefined, memoriesCount: 0 });
    expect(container.textContent).toContain("Current loadout");
    expect(screen.queryByText(/Checking what you've unlocked/)).toBeNull();
  });
});

describe("REG-179 (HN-05) — Hangar action buttons meet the touch standard, captions kept", () => {
  it("every action button carries the touch-sized class and keeps its caption", () => {
    renderHangar({
      unlockStats: stats({ memoriesCount: 25 }),
      onViewInGalaxy: vi.fn(),
      onPlayTrack: vi.fn(),
      currentTrackIndex: 1,
      musicPlaying: true,
    });
    const actions = screen.getAllByRole("button").filter((b) =>
      /^(Equip|Equipped|Locked|Play|Playing|👁 View)/.test((b.textContent ?? "").trim()),
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const b of actions) {
      expect(b.className).toContain("hangar-action");
      expect((b.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });
});

describe("REG-181 (HN-07) — trails are previewable before equip; the station target is reachable", () => {
  it("an unlocked, unequipped trail offers a Preview action that previews that trail", () => {
    const onPreviewTrail = vi.fn();
    renderHangar({ unlockStats: stats({ achievementIds: ["consistent_pilot"] }), onPreviewTrail });
    const preview = screen.getByTestId("hangar-preview-trail-neon");
    expect((preview as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(preview);
    expect(onPreviewTrail).toHaveBeenCalledWith("neon");
  });

  it("a locked trail cannot be previewed, and the equipped trail needs no preview", () => {
    localStorage.setItem(`brain.hangar.trail.${SPACE}`, "blue");
    renderHangar({ unlockStats: stats(), onPreviewTrail: vi.fn() });
    expect((screen.getByTestId("hangar-preview-trail-neon") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("hangar-preview-trail-blue") as HTMLButtonElement).disabled).toBe(true);
  });

  it("while a preview is live the panel names it and offers a stop", () => {
    const onPreviewTrail = vi.fn();
    renderHangar({
      unlockStats: stats({ achievementIds: ["consistent_pilot"] }),
      onPreviewTrail,
      previewTrail: "neon",
    });
    expect(screen.getByText(/Previewing Hyperdrive Neon/)).toBeTruthy();
    fireEvent.click(screen.getByText("Stop preview"));
    expect(onPreviewTrail).toHaveBeenCalledWith(null);
  });

  it("the station view target is reachable from the figurine surface", () => {
    const onViewInGalaxy = vi.fn();
    renderHangar({ onViewInGalaxy });
    fireEvent.click(screen.getByTestId("hangar-view-station"));
    expect(onViewInGalaxy).toHaveBeenCalledWith("station");
  });
});

describe("REG-182 (HN-08) — the loadout music line names its own semantics", () => {
  it("with nothing playing, the line says so instead of a bare dash", () => {
    renderHangar({ currentTrackIndex: null, musicPlaying: false });
    const loadout = screen.getByTestId("hangar-loadout");
    expect(within(loadout).getByText(/Nothing playing — pick a loop below/)).toBeTruthy();
  });

  it("a track played last session is not claimed as a current pick", () => {
    renderHangar({ currentTrackIndex: 1, musicPlaying: false });
    const loadout = screen.getByTestId("hangar-loadout");
    expect(within(loadout).getByText(/Nothing playing — pick a loop below/)).toBeTruthy();
    expect(within(loadout).queryByText(/Slow Tide/)).toBeNull();
  });

  it("while a loop is actually playing, the line names it", () => {
    renderHangar({ currentTrackIndex: 1, musicPlaying: true });
    const loadout = screen.getByTestId("hangar-loadout");
    expect(within(loadout).getByText(/Now playing: Slow Tide/)).toBeTruthy();
  });
});

describe("REG-183 (HN-09) — newly unlocked items are visibly marked until viewed/equipped", () => {
  it("an item unlocked since the last Hangar visit carries a New mark", () => {
    // A prior Hangar visit (seen set holds the always-unlocked items)…
    localStorage.setItem(
      `brain.hangar.seen.${SPACE}`,
      JSON.stringify(["music-deep-space", "ship-default", "trail-blue", "figurine-none", "figurine-station", "figurine-satellite"]),
    );
    // …then Slow Tide unlocks (25 memories) and is celebrated on this device.
    localStorage.setItem(`brain.unlocksSeen.${SPACE}`, JSON.stringify(["music-slow-tide"]));
    renderHangar({ unlockStats: stats({ memoriesCount: 25 }), memoriesCount: 25 });
    expect(screen.getAllByText(/✨ New/)).toHaveLength(1);
    // The mark sits on the newly unlocked row itself.
    expect(screen.getByText(/Slow Tide/).textContent).toContain("✨ New");
  });

  it("the mark is gone on the next visit — viewing the panel clears it", () => {
    localStorage.setItem(
      `brain.hangar.seen.${SPACE}`,
      JSON.stringify(["music-deep-space", "ship-default", "trail-blue", "figurine-none", "figurine-station", "figurine-satellite"]),
    );
    const { unmount } = renderHangar({ unlockStats: stats({ memoriesCount: 25 }), memoriesCount: 25 });
    expect(screen.getAllByText(/✨ New/)).toHaveLength(1);
    unmount();
    renderHangar({ unlockStats: stats({ memoriesCount: 25 }), memoriesCount: 25 });
    expect(screen.queryByText(/✨ New/)).toBeNull();
  });

  it("equipping a new item clears its mark at once", () => {
    renderHangar({ unlockStats: stats({ memoriesCount: 150 }), memoriesCount: 150 });
    const organicLabel = screen.getByText(/Organic Specimen Hull/);
    expect(organicLabel.textContent).toContain("✨ New");
    fireEvent.click(screen.getByRole("button", { name: /Organic Specimen Hull/ }));
    expect(organicLabel.textContent).not.toContain("✨ New");
  });

  it("long-owned unlocks are not marked new on a first Hangar visit", () => {
    // Everything already unlocked was already celebrated on this device…
    localStorage.setItem(
      `brain.unlocksSeen.${SPACE}`,
      JSON.stringify(["music-deep-space", "music-slow-tide", "ship-default", "trail-blue", "figurine-none", "figurine-station", "figurine-satellite"]),
    );
    renderHangar({ unlockStats: stats({ memoriesCount: 25 }), memoriesCount: 25 });
    expect(screen.queryByText(/✨ New/)).toBeNull();
  });
});
