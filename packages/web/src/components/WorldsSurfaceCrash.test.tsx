import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import { requestEnterWorld } from "../lib/travelEvents.js";
import WorldsSurface from "./WorldsSurface.js";
import { useTravel, type UseTravel } from "../hooks/useTravel.js";
import { useHarborController } from "../hooks/useHarborController.js";
import { useCaptains } from "../hooks/useCaptains.js";

/**
 * Item 8 — the world-travel crash guards, tested with a stub renderer.
 * happy-dom has no WebGL, so the real renderer can never be built here;
 * the stub stands in for a device whose WebGL works. The home-sky bake
 * and the lighting bake both need a real GL context, so they are stubbed
 * out — what is under test is the surface's own guard, not three.js.
 */
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class StubRenderer {
    domElement = document.createElement("canvas");
    capabilities = { isWebGL2: true };
    extensions = { has: () => false, get: () => null };
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
    renderLists = { dispose() {} };
  }
  return { ...actual, WebGLRenderer: StubRenderer };
});
vi.mock("../graph/homeSky.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../graph/homeSky.js")>();
  return { ...actual, installHomeSky: () => null, releaseHomeSky: () => {} };
});
vi.mock("../graph/worldLighting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../graph/worldLighting.js")>();
  return { ...actual, applyWorldLighting: () => ({ dispose: () => {} }) };
});
// Flip `yardBoom.throwIt` in a test to make the yard's build throw — the
// guard must catch it and show the fallback, not let the world vanish.
const yardBoom = vi.hoisted(() => ({ throwIt: false }));
vi.mock("../graph/yardScene.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../graph/yardScene.js")>();
  return {
    ...actual,
    createYardScene: () => {
      if (yardBoom.throwIt) throw new Error("yard build boom");
      return actual.createYardScene();
    },
  };
});
vi.mock("../hooks/useTravel.js", () => ({ useTravel: vi.fn() }));
vi.mock("../hooks/useHarborController.js", () => ({ useHarborController: vi.fn() }));
vi.mock("../hooks/useCaptains.js", () => ({ useCaptains: vi.fn() }));
vi.mock("../api/journeys.js", () => ({
  getJourneys: vi.fn(async () => []),
  journeyLinks: vi.fn(async () => null),
}));
vi.mock("../api/client.js", () => ({
  getArchivedNodesStrict: vi.fn(async () => []),
  getIncidentEdges: vi.fn(async () => ({ edges: [], nextCursor: null })),
  getSpaceId: vi.fn(() => "space-1"),
}));

const mockUseTravel = vi.mocked(useTravel);
const mockUseHarborController = vi.mocked(useHarborController);
const mockUseCaptains = vi.mocked(useCaptains);

function fakeTravel(over: Partial<UseTravel> = {}): UseTravel {
  return {
    state: {
      currentWorld: "the-yard",
      activeJourney: null,
      fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    loading: false,
    busy: false,
    error: null,
    cancelSecondsLeft: null,
    lastBonus: null,
    refresh: vi.fn(async () => {}),
    depart: vi.fn(async () => null),
    cancel: vi.fn(async () => null),
    turnBack: vi.fn(async () => null),
    arrive: vi.fn(async () => null),
    hasTraversed: () => false,
    ...over,
  };
}

function mountEngaged(ui: ReactElement) {
  const r = render(ui);
  act(() => requestEnterWorld());
  return r;
}

beforeEach(() => {
  mockUseTravel.mockReset();
  mockUseHarborController.mockReset();
  mockUseCaptains.mockReset();
  mockUseHarborController.mockReturnValue({
    npc: null,
    answer: null,
    loading: false,
    failed: false,
    error: null,
    refresh: vi.fn(async () => {}),
    ask: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useHarborController>);
  mockUseCaptains.mockReturnValue({ captains: [] } as unknown as ReturnType<typeof useCaptains>);
  mockUseTravel.mockReturnValue(fakeTravel());
});
afterEach(cleanup);

describe("WorldsSurface — the crash guards (Item 8)", () => {
  it("a lost graphics context says so plainly, with a reload action — and a restore clears it", async () => {
    const { container } = mountEngaged(<WorldsSurface enabled />);
    const canvas = await waitFor(() => {
      const c = container.querySelector("canvas");
      if (!c) throw new Error("no canvas yet");
      return c;
    });
    expect(screen.queryByText(/The graphics context was lost/)).toBeNull();
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextlost"));
    });
    expect(await screen.findByText(/The graphics context was lost — reload to continue\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });
    await waitFor(() => expect(screen.queryByText(/The graphics context was lost/)).toBeNull());
  });

  it("a world whose build throws shows that world's fallback text — it does not vanish", async () => {
    yardBoom.throwIt = true;
    try {
      mountEngaged(<WorldsSurface enabled />);
      // Before the guard, this throw reached the ErrorBoundary (whose
      // fallback is null) and the world simply vanished; with the guard,
      // the world's own fallback line shows instead.
      expect(await screen.findByText(/The yard needs graphics support on this device/)).toBeTruthy();
    } finally {
      yardBoom.throwIt = false;
    }
  });
});
