import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { EMPTY_UNLOCK_STATS, type UnlockStats } from "@brain/shared";

/**
 * CL-12 — Hangar (IM-96..102, IM-133 Hangar portion).
 *
 * Falsification notes (against the pre-change panel): the old HangarPanel
 * had NO hooks (values read from localStorage during render), native
 * <select> dropdowns for trails + both figurine slots, no previews, no
 * loadout header, no unlock-progress hints, no equip feedback, no dedupe
 * between figurine slots, dead focus toggles under `none` slots, ad-hoc
 * gating (achievement ids + inline count thresholds — the shared
 * catalog's dev-unlock-all flag did NOT apply), requirement copy leaking
 * achievement vocabulary ("Sector Pioneer path"), and no music picker.
 * Every test below fails against that code.
 */
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { HangarPanel, figurineOptionsForSlot } from "./HangarPanel.js";
import { unlockablesByCategory } from "@brain/shared";

const SPACE = "space-cl12";
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

describe("IM-98/IM-133 — stateful panel on the shared unlockables system", () => {
  it("equipping updates the panel's own state immediately (no ancestor re-render needed)", () => {
    const { props } = renderHangar({ unlockStats: stats({ achievementIds: ["consistent_pilot"] }) });
    fireEvent.click(screen.getByRole("button", { name: /Hyperdrive Neon/ }));
    // The loadout header and the option itself reflect the equip at once.
    expect(within(screen.getByTestId("hangar-loadout")).getByText(/✨ Hyperdrive Neon/)).toBeTruthy();
    expect(localStorage.getItem(`brain.hangar.trail.${SPACE}`)).toBe("neon");
    expect(props.onEquipChanged).toHaveBeenCalled();
  });

  it("the dev-unlock-all flag unlocks Hangar items too (one gating truth)", () => {
    renderHangar({ unlockStats: stats(), devUnlockAll: true });
    const organic = screen.getByRole("button", { name: /Organic Specimen Hull/ });
    expect((organic as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(organic);
    expect(localStorage.getItem(`brain.hangar.ship.${SPACE}`)).toBe("organic");
  });

  it("without the flag, the same item stays locked at 0 memories", () => {
    renderHangar({ unlockStats: stats() });
    const organic = screen.getByRole("button", { name: /Organic Specimen Hull/ });
    expect((organic as HTMLButtonElement).disabled).toBe(true);
  });

  it("gates via achievement ids carried in the shared stats (not a second system)", () => {
    renderHangar({ unlockStats: stats({ achievementIds: ["cosmic_voyager"] }) });
    const fusion = screen.getByRole("button", { name: /Fusion Core Destroyer/ });
    expect((fusion as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("IM-97 — loadout summary, unlock progress, equip feedback", () => {
  it("renders an equipped-loadout summary header", () => {
    localStorage.setItem(`brain.hangar.ship.${SPACE}`, "default");
    localStorage.setItem(`brain.hangar.trail.${SPACE}`, "blue");
    renderHangar();
    const loadout = screen.getByTestId("hangar-loadout");
    expect(within(loadout).getByText(/Default Scout Craft/)).toBeTruthy();
    expect(within(loadout).getByText(/Blue Nebula/)).toBeTruthy();
    // Overall unlock progress across the Hangar's catalog categories.
    expect(within(loadout).getByText(/6\/20 unlocked/)).toBeTruthy();
  });

  it("shows numeric unlock progress toward a locked item (112/150)", () => {
    renderHangar({ unlockStats: stats({ memoriesCount: 112 }), memoriesCount: 112 });
    expect(screen.getByText(/112\/150/)).toBeTruthy();
  });

  it("gives feedback on equip: toast + SFX + visible confirmation", () => {
    renderHangar({ unlockStats: stats({ achievementIds: ["consistent_pilot"] }) });
    fireEvent.click(screen.getByRole("button", { name: /Hyperdrive Neon/ }));
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Hyperdrive Neon"), expect.anything(), expect.anything());
    expect(playSfx).toHaveBeenCalledWith("select");
    expect(screen.getByRole("status").textContent).toContain("Hyperdrive Neon");
  });
});

describe("IM-96 — previews + view in galaxy", () => {
  it("renders a preview for ships, a swatch for trails, and a preview for figurines", () => {
    const { container } = renderHangar();
    expect(container.querySelector('[data-testid="hangar-preview-ship-organic"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="hangar-swatch-trail-blue"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="hangar-swatch-trail-gold"]')).toBeTruthy();
    expect(screen.getAllByTestId(/hangar-preview-figurine-/).length).toBeGreaterThan(0);
  });

  it("'View in galaxy' asks the shell to close the dock and focus the ship", () => {
    const onViewInGalaxy = vi.fn();
    renderHangar({ onViewInGalaxy });
    fireEvent.click(screen.getByTestId("hangar-view-ship"));
    expect(onViewInGalaxy).toHaveBeenCalledWith("ship");
  });

  it("'View in galaxy' for an equipped figurine focuses that slot", () => {
    localStorage.setItem(`brain.hangar.fig1.${SPACE}`, "station");
    const onViewInGalaxy = vi.fn();
    renderHangar({ onViewInGalaxy });
    fireEvent.click(screen.getByTestId("hangar-view-fig1"));
    expect(onViewInGalaxy).toHaveBeenCalledWith("fig1");
  });
});

describe("IM-99/IM-101 — dedupe, honest focus toggles, styled controls, human copy", () => {
  it("uses NO native <select> anywhere in the panel", () => {
    const { container } = renderHangar();
    expect(container.querySelector("select")).toBeNull();
  });

  it("dedupes the figurine slots: a monument equipped in slot 1 is not offered in slot 2", () => {
    localStorage.setItem(`brain.hangar.fig1.${SPACE}`, "station");
    renderHangar();
    const slot2 = screen.getByTestId("hangar-fig-slot-2");
    expect(within(slot2).queryByRole("button", { name: /Waystation Figurine/ })).toBeNull();
    const slot1 = screen.getByTestId("hangar-fig-slot-1");
    expect(within(slot1).getByRole("button", { name: /Waystation Figurine/ })).toBeTruthy();
  });

  it("figurineOptionsForSlot excludes the other slot's pick but keeps 'none' and its own", () => {
    const figs = unlockablesByCategory("figurine");
    const forSlot2 = figurineOptionsForSlot(figs, "station", "none").map((i) => i.equipValue);
    expect(forSlot2).not.toContain("station");
    expect(forSlot2).toContain("none");
    const forSlot1 = figurineOptionsForSlot(figs, "none", "station").map((i) => i.equipValue);
    expect(forSlot1).toContain("station");
  });

  it("hides the focus toggle when the slot is 'none' and shows it once equipped", () => {
    const { rerender } = renderHangar();
    expect(screen.queryByLabelText(/Show camera focus button.*Slot 1/)).toBeNull();
    localStorage.setItem(`brain.hangar.fig1.${SPACE}`, "station");
    rerender(
      <HangarPanel spaceId={SPACE} memoriesCount={0} onEquipChanged={vi.fn()} unlockStats={stats()} key="again" />,
    );
    // Fresh mount (new key) reflects stored state; toggle now exists.
    expect(screen.getAllByLabelText(/Show camera focus button/).length).toBeGreaterThan(0);
  });

  it("requirement copy is humanized — no achievement-id vocabulary leaks", () => {
    const { container } = renderHangar();
    const text = container.textContent ?? "";
    expect(text).not.toContain("Sector Pioneer path");
    expect(text).not.toMatch(/[a-z]+_[a-z]+/);
    expect(text).toContain("Sector Pioneer feat");
  });
});

describe("IM-102 — music picker surfaces in the Hangar, gated by the shared system", () => {
  it("lists all three loops; locked loops are disabled with their requirement", () => {
    renderHangar({ unlockStats: stats(), onPlayTrack: vi.fn() });
    const music = screen.getByTestId("hangar-music");
    expect(within(music).getByText(/Deep Space/)).toBeTruthy();
    expect(within(music).getByText(/Slow Tide/)).toBeTruthy();
    expect(within(music).getByText(/Interstellar/)).toBeTruthy();
    expect(within(music).getByText(/Unlock at 25 memories/)).toBeTruthy();
    const slowTide = within(music).getByRole("button", { name: /Slow Tide/ });
    expect((slowTide as HTMLButtonElement).disabled).toBe(true);
  });

  it("playing an unlocked loop goes through the shell's gated play callback", () => {
    const onPlayTrack = vi.fn();
    renderHangar({ unlockStats: stats({ memoriesCount: 25 }), onPlayTrack });
    const music = screen.getByTestId("hangar-music");
    fireEvent.click(within(music).getByRole("button", { name: /Slow Tide/ }));
    expect(onPlayTrack).toHaveBeenCalledWith(1);
  });

  it("shows the currently playing loop", () => {
    renderHangar({ unlockStats: stats({ memoriesCount: 25 }), onPlayTrack: vi.fn(), currentTrackIndex: 1, musicPlaying: true });
    const music = screen.getByTestId("hangar-music");
    expect(within(music).getByText(/Now playing/)).toBeTruthy();
  });
});
