import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import WorldMap from "./WorldMap.js";
import { useTravel, readTraversedRoutes, type UseTravel } from "../hooks/useTravel.js";

vi.mock("../hooks/useTravel.js", () => ({
  useTravel: vi.fn(),
  readTraversedRoutes: vi.fn(() => []),
}));
const mockUseTravel = vi.mocked(useTravel);
const mockReadTraversed = vi.mocked(readTraversedRoutes);

afterEach(cleanup);

function fakeTravel(over: Partial<UseTravel> = {}): UseTravel {
  return {
    state: {
      currentWorld: "home",
      activeJourney: null,
      fuel: { fuel: 25, capacity: 200, jobCost: 2, warpCost: 10 },
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

function renderMap(over: Partial<UseTravel> = {}, traversed: { origin: string; destination: string }[] = []) {
  mockReadTraversed.mockReturnValue(traversed);
  const onClose = vi.fn();
  const onTravelTo = vi.fn();
  const utils = render(<WorldMap onClose={onClose} onTravelTo={onTravelTo} />);
  return { ...utils, onClose, onTravelTo };
}

describe("WorldMap — the map itself (C1/C2)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
    mockReadTraversed.mockReset();
  });

  it("flag off renders nothing (the dark contract)", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { container } = render(<WorldMap enabled={false} onClose={() => {}} onTravelTo={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("a fresh traveller sees only Home — no other world, no 'unknown' marker, no locked door", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    renderMap();
    expect(screen.getByRole("dialog", { name: "World map" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Home — you are here" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "The Great Station" })).toBeNull();
    expect(screen.queryByRole("button", { name: "The Growing Place" })).toBeNull();
    expect(screen.queryByRole("button", { name: "The Deep Past" })).toBeNull();
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(screen.queryByText(/locked/i)).toBeNull();
    expect(screen.getByText("You are here")).toBeTruthy();
  });

  it("a travelled world appears; the shimmer is present, unnamed and unclickable", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { container } = renderMap({}, [{ origin: "home", destination: "great-station" }]);
    expect(screen.getByRole("button", { name: "The Great Station" })).toBeTruthy();
    // The shimmer: a soft glow circle, pointer-events none, no label, no role.
    const shimmer = container.querySelector('circle[fill="url(#world-map-shimmer)"]');
    expect(shimmer).toBeTruthy();
    expect(shimmer?.getAttribute("pointer-events")).toBe("none");
    expect(shimmer?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: /shimmer/i })).toBeNull();
  });

  it("every edge carries its fuel cost, always — and the travelled leg draws bright", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { container } = renderMap({}, [{ origin: "home", destination: "great-station" }]);
    expect(screen.getByText("10 fuel")).toBeTruthy();
    expect(container.querySelector(".world-map-edge.bright")).toBeTruthy();
    expect(container.querySelector(".world-map-edge.traveled")).toBeTruthy();
  });

  it("loading shows an honest line, never an empty map", () => {
    mockUseTravel.mockReturnValue(fakeTravel({ state: null }));
    renderMap();
    expect(screen.getByText(/Checking the chart/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Travel to/ })).toBeNull();
  });

  it("a travel error is shown plainly and no map is drawn on top of it", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({ state: null, error: "Can't reach the brain right now — travel state may be out of date." }),
    );
    renderMap();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Travel to/ })).toBeNull();
  });
});

describe("WorldMap — selecting and travelling (C3/C4/C8)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
    mockReadTraversed.mockReset();
  });

  it("selecting a world shows the whole chain's price; Travel opens the travel panel for it", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { onTravelTo } = renderMap({}, [{ origin: "home", destination: "great-station" }]);
    fireEvent.click(screen.getByRole("button", { name: "The Great Station" }));
    expect(screen.getByText(/Warp there · 10 fuel for the whole trip/)).toBeTruthy();
    expect(screen.getByText(/Drift there · free/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Travel to The Great Station" }));
    expect(onTravelTo).toHaveBeenCalledWith("great-station");
    // Selecting is keyboard-operable too.
    fireEvent.keyDown(screen.getByRole("button", { name: "Home — you are here" }), { key: "Enter" });
    expect(screen.getByText("You are here.")).toBeTruthy();
  });

  it("the world you are in offers no travel — it says you are here, plainly", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { onTravelTo } = renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Home — you are here" }));
    expect(screen.getByText("You are here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Travel to Home$/ })).toBeNull();
    expect(onTravelTo).not.toHaveBeenCalled();
  });

  it("while a journey is active there is no second departure — the map says so plainly", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "home",
          activeJourney: {
            id: "j-3",
            kind: "warp",
            origin: "home",
            destination: "great-station",
            state: "in_transit",
            fuelCharged: 10,
            cancellable: false,
            createdAt: "2026-10-25T12:00:00.000Z",
            cancelDeadline: "2026-10-25T12:00:10.000Z",
          },
          fuel: { fuel: 15, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "The Great Station" }));
    expect(screen.getByText(/already travelling/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Travel to The Great Station$/ })).toBeNull();
  });

  it("Escape closes the map too, and a map with only a couple of worlds says why it is sparse (owner: 'no way to exit', 'doesn't work')", async () => {
    const onClose = vi.fn();
    mockUseTravel.mockReturnValue(fakeTravel());
    render(<WorldMap enabled onClose={onClose} onTravelTo={() => {}} />);
    expect(screen.getByText(/Worlds appear here as you reach them/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closing returns to the galaxy — the map never strands you", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { onClose } = renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Close map" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("zoom controls work and Reset view restores the chart", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { container } = renderMap();
    const chart = () => container.querySelector(".world-map-canvas > g")?.getAttribute("transform") ?? "";
    expect(chart()).toContain("scale(1)");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(chart()).toContain("scale(1.25)");
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(chart()).toContain("scale(1)");
  });
});

describe("WorldMap — reduced motion (C6)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
    mockReadTraversed.mockReset();
  });

  it("under reduced motion the map is identical — same worlds, same routes, same controls", () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      mockUseTravel.mockReturnValue(fakeTravel());
      renderMap({}, [{ origin: "home", destination: "great-station" }]);
      expect(screen.getByRole("button", { name: "Home — you are here" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "The Great Station" })).toBeTruthy();
      expect(screen.getByText("10 fuel")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Close map" })).toBeTruthy();
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });
});
