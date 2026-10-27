import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

const createLens = vi.fn().mockResolvedValue({ id: 1, name: "Goals", query: { kinds: ["goal"] }, pinned: false });
// GalaxyViews now renders <LensChips> inside its dropdown (Phase M — see .lens-list's CSS
// comment), which also imports from ../api/lenses.js — getLenses/lensNodes need mocking too.
vi.mock("../api/lenses.js", () => ({
  createLens: (...a: unknown[]) => createLens(...a),
  getLenses: vi.fn().mockResolvedValue([]),
  lensNodes: vi.fn().mockResolvedValue({ ids: [], total: 0, capped: false, totalIsLowerBound: false, shown: 0 }),
}));
vi.mock("../api/finance.js", () => ({ getMoneySky: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/journeys.js", () => ({ getJourneys: vi.fn().mockResolvedValue([]) }));
// Phase AC.1: GalaxyViews now reads getSpaceId() once, on mount, to key its one-time
// first-use-open localStorage flag (see the dedicated describe block below). Fixed here so
// every OTHER test in this file — which all predate that feature and assert the panel starts
// collapsed — gets a deterministic, already-known space id to mark "already seen" against.
vi.mock("../api/client.js", () => ({ getSpaceId: () => "gv-test-space" }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { GalaxyViews } from "./GalaxyViews.js";

// Every pre-existing test in this file assumes GalaxyViews starts collapsed — true for any
// RETURNING view of a space, which is what they're actually testing. Pre-marking the one-time
// flag as "seen" here preserves that intent instead of coupling every unrelated test to the
// new first-use behavior (covered on its own, with a clean localStorage, below).
beforeEach(() => {
  localStorage.setItem("brain.viewsSeen.gv-test-space", "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function goalNode(id: number): GraphNode {
  return { id, label: `goal ${id}`, type: "concept", kind: "goal", content: "", createdAt: "2026-01-01T00:00:00Z" } as GraphNode;
}

describe("GalaxyViews — Save as Lens bridge", () => {
  it("does not show 'Save as Lens' with no active view", () => {
    render(
      <GalaxyViews nodes={[goalNode(1)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} />,
    );
    // Open the panel first.
    screen.getByText(/Views/).click();
    expect(screen.queryByText(/Save as Lens/)).toBeNull();
  });

  it("shows 'Save as Lens' for an active category view and creates the matching LensQuery", async () => {
    render(
      <GalaxyViews nodes={[goalNode(1), goalNode(2)]} activeView="🎯 Goals" onOpen={vi.fn()} onExit={vi.fn()} />,
    );
    screen.getByText(/Views/).click();
    const btn = await screen.findByText(/Save as Lens/);
    btn.click();
    await waitFor(() => expect(createLens).toHaveBeenCalledWith("Goals", { kinds: ["goal"] }, false));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
  });

  it("does not show 'Save as Lens' for an overlay layer (money/journeys), only real categories", () => {
    render(
      <GalaxyViews nodes={[goalNode(1)]} activeView="💵 Money sky" onOpen={vi.fn()} onExit={vi.fn()} onLayer={vi.fn()} />,
    );
    screen.getByText(/Views/).click();
    expect(screen.queryByText(/Save as Lens/)).toBeNull();
  });
});

// Phase M (real on-device screenshot bug report): pinned lenses previously rendered as
// their own independently-floating overlay that could visually collide with this dropdown
// (see .gv-wrap's CSS comment for the confirmed root cause). They now render as a plain
// list INSIDE this dropdown instead of as a second floating element.
describe("GalaxyViews — pinned lenses render inside this dropdown, not a separate overlay", () => {
  it("shows nothing lens-related while the dropdown is collapsed", () => {
    render(<GalaxyViews nodes={[goalNode(1)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByText("📌 Pinned Lenses")).toBeNull();
  });

  it("shows the pinned-lens list once the dropdown is opened", async () => {
    const { getLenses } = await import("../api/lenses.js");
    vi.mocked(getLenses).mockResolvedValue([{ id: 9, name: "Linked to Girlfriend", query: {}, pinned: true, count: 4 }]);
    const { container } = render(<GalaxyViews nodes={[goalNode(1)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} />);
    screen.getByText(/Views/).click();
    await screen.findByText("Linked to Girlfriend");
    // Confirms it's a DOM descendant of .gv-wrap (the one dropdown), not a sibling overlay.
    expect(container.querySelector(".gv-wrap .lens-list")).not.toBeNull();
  });
});

// Phase AC.1 (docs/specs/soumaya-connective-tissue-onboarding.md): the audit found this panel
// collapsed by default with no first-run cue. Opened once automatically, per space, the very
// first time it ever mounts — every test above pre-marks the flag "seen" to test ordinary
// (returning-user) behavior; these two specifically exercise the one-time flag itself.
describe("GalaxyViews — first-use discoverability", () => {
  it("opens itself automatically the very first time this space renders it", () => {
    localStorage.removeItem("brain.viewsSeen.gv-test-space"); // undo this file's own beforeEach
    const { container } = render(<GalaxyViews nodes={[goalNode(1)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} />);
    expect(container.querySelector(".gv-chips")).not.toBeNull();
    expect(localStorage.getItem("brain.viewsSeen.gv-test-space")).toBe("1");
  });

  it("stays collapsed on every render after the first", () => {
    localStorage.removeItem("brain.viewsSeen.gv-test-space");
    const { container, unmount } = render(<GalaxyViews nodes={[goalNode(1)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} />);
    expect(container.querySelector(".gv-chips")).not.toBeNull(); // first mount: auto-opened
    unmount();

    const second = render(<GalaxyViews nodes={[goalNode(1)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} />);
    expect(second.container.querySelector(".gv-chips")).toBeNull(); // second mount: back to normal
  });
});

/**
 * Batch I — GH-05 (REG-067): the Money/Journeys layer counts must not
 * fail silently — a failed fetch leaves a distinguishable trace (error
 * + retry), never a silently absent chip. Fail-before: the catches
 * swallow the failure and no error UI exists.
 */
describe("GalaxyViews — a failed layer load is disclosed with a retry", () => {
  it("shows a retryable error when the Money sky fetch fails, and clears it on retry", async () => {
    const { getMoneySky } = await import("../api/finance.js");
    vi.mocked(getMoneySky).mockRejectedValueOnce(new Error("boom"));
    render(
      <GalaxyViews nodes={[goalNode(1)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} onLayer={vi.fn()} />,
    );
    screen.getByText(/Views/).click();
    const err = await screen.findByText(/couldn't load the money sky/i);
    expect(err).toBeTruthy();
    // The Money sky chip itself is absent — but the absence is now disclosed, not silent.
    expect(screen.queryByText("💵 Money sky")).toBeNull();
    vi.mocked(getMoneySky).mockResolvedValueOnce([{ id: 1 } as never]);
    screen.getByText(/retry/i).click();
    await waitFor(() => expect(screen.queryByText(/couldn't load the money sky/i)).toBeNull());
    expect(await screen.findByText("💵 Money sky")).toBeTruthy();
  });
});
