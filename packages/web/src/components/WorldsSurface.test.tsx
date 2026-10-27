import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorldsSurface from "./WorldsSurface.js";
import { useTravel, type UseTravel } from "../hooks/useTravel.js";
import { getJourneys, journeyLinks } from "../api/journeys.js";

vi.mock("../hooks/useTravel.js", () => ({ useTravel: vi.fn() }));
vi.mock("../api/journeys.js", () => ({
  getJourneys: vi.fn(async () => []),
  journeyLinks: vi.fn(async () => null),
}));
const mockUseTravel = vi.mocked(useTravel);
const mockGetJourneys = vi.mocked(getJourneys);
const mockJourneyLinks = vi.mocked(journeyLinks);

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

const atStation = (over: Partial<UseTravel> = {}) =>
  fakeTravel({
    state: {
      currentWorld: "great-station",
      activeJourney: null,
      fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    ...over,
  });

const atGarden = (over: Partial<UseTravel> = {}) =>
  fakeTravel({
    state: {
      currentWorld: "growing-place",
      activeJourney: null,
      fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    ...over,
  });

const atDeepPast = (over: Partial<UseTravel> = {}) =>
  fakeTravel({
    state: {
      currentWorld: "deep-past",
      activeJourney: null,
      fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    ...over,
  });

const atPeople = (over: Partial<UseTravel> = {}) =>
  fakeTravel({
    state: {
      currentWorld: "people",
      activeJourney: null,
      fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    ...over,
  });

const gardenGraph = {
  nodes: [
    { id: 1, label: "a", type: "memory", content: "", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: 2, label: "b", type: "memory", content: "", createdAt: "2025-05-01T00:00:00.000Z" },
  ],
  links: [
    { id: 10, source: 1, target: 2, relationship: "related", weight: 0.5, createdAt: "2026-10-01T00:00:00.000Z" },
  ],
} as never;

describe("WorldsSurface (P2-4 — the F-01 mount)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  it("flag off renders nothing (the dark contract)", () => {
    mockUseTravel.mockReturnValue(atStation());
    const { container } = render(<WorldsSurface enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("at home renders nothing — the surface belongs to the Station", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
  });

  it("mid-journey renders the transit view, not nothing (P2-5) — arrival is still the server's word", async () => {
    mockUseTravel.mockReturnValue(
      atStation({
        state: {
          currentWorld: "home",
          activeJourney: {
            id: "j-9",
            kind: "warp",
            origin: "home",
            destination: "great-station",
            state: "in_transit",
            fuelCharged: 10,
            cancellable: false,
            createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z",
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    render(<WorldsSurface enabled />);
    expect(
      screen.getByRole("dialog", { name: "Travelling to The Great Station" }),
    ).toBeTruthy();
    // happy-dom has no working WebGL: the honest fallback appears,
    // the journey itself is unaffected.
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your journey is unaffected/)).toBeTruthy();
  });

  it("returning renders the transit view too (P2-5)", () => {
    mockUseTravel.mockReturnValue(
      atStation({
        state: {
          currentWorld: "great-station",
          activeJourney: {
            id: "j-10",
            kind: "drift",
            origin: "great-station",
            destination: "home",
            state: "returning",
            fuelCharged: 0,
            cancellable: false,
            createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z",
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    render(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "Travelling to Home" })).toBeTruthy();
  });

  it("arming renders nothing — the user is still at the origin and the panel owns the countdown (P2-5)", () => {
    mockUseTravel.mockReturnValue(
      atStation({
        state: {
          currentWorld: "home",
          activeJourney: {
            id: "j-11",
            kind: "warp",
            origin: "home",
            destination: "great-station",
            state: "arming",
            fuelCharged: 0,
            cancellable: true,
            createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z",
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
  });

  it("at the Station the surface mounts; without WebGL it degrades honestly, and Close is view-only", async () => {
    mockUseTravel.mockReturnValue(atStation());
    render(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "The Great Station" })).toBeTruthy();
    // happy-dom has no working WebGL: the honest fallback appears,
    // journeys unaffected.
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to your galaxy" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("WorldsSurface — the Growing Place (P3-1)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  it("at the garden with the graph it mounts the garden; without WebGL it degrades honestly", async () => {
    mockUseTravel.mockReturnValue(atGarden());
    render(<WorldsSurface enabled graph={gardenGraph} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your memories are unaffected/)).toBeTruthy();
  });

  it("at the garden without the graph yet it shows a loading line and builds nothing", () => {
    mockUseTravel.mockReturnValue(atGarden());
    render(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(screen.getByText(/Your garden is loading/)).toBeTruthy();
  });

  it("an unknown world renders nothing — the registry admits only built worlds", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "quiet-archive",
          activeJourney: null,
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    const { container } = render(<WorldsSurface enabled graph={gardenGraph} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("WorldsSurface — the Deep Past (P3-2)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
    mockGetJourneys.mockResolvedValue([]);
    mockJourneyLinks.mockResolvedValue(null);
  });

  const deepPastGraph = {
    nodes: [
      { id: 1, label: "a", type: "memory", content: "", createdAt: "2024-05-01T00:00:00.000Z" },
      { id: 3, label: "c", type: "memory", content: "", createdAt: "2017-01-01T00:00:00.000Z" },
    ],
    links: [],
  } as never;

  it("at the Deep Past with the graph it mounts the past; without WebGL it degrades honestly", async () => {
    mockUseTravel.mockReturnValue(atDeepPast());
    render(<WorldsSurface enabled graph={deepPastGraph} />);
    expect(screen.getByRole("dialog", { name: "The Deep Past" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your memories are unaffected/)).toBeTruthy();
  });

  it("at the Deep Past without the graph yet it shows a loading line and builds nothing", () => {
    mockUseTravel.mockReturnValue(atDeepPast());
    render(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "The Deep Past" })).toBeTruthy();
    expect(screen.getByText(/Your past is loading/)).toBeTruthy();
  });

  it("a done Journey with two member stops becomes the Chronicle thread — with its guided button", async () => {
    mockUseTravel.mockReturnValue(atDeepPast());
    mockGetJourneys.mockResolvedValue([
      { id: 7, title: "Done chapter", description: "", status: "done", progress: 1 } as never,
    ]);
    mockJourneyLinks.mockResolvedValue({
      links: [
        { kind: "node", refId: 3, label: "c" },
        { kind: "node", refId: 1, label: "a" },
      ],
      totalCount: 2,
      earnedCents: 0,
      spentCents: 0,
      displayLimit: 50,
      unshownByKind: {},
    } as never);
    render(<WorldsSurface enabled graph={deepPastGraph} />);
    expect(await screen.findByText(/Chronicle route: Done chapter — 2 stops along the descent/)).toBeTruthy();
    // The guided descent is user-initiated, never auto-started.
    const descend = screen.getByRole("button", { name: "Descend the Chronicle" });
    fireEvent.click(descend);
    expect(screen.getByRole("button", { name: "Back to the rim" })).toBeTruthy();
  });

  it("with no qualifying route there is no thread and no guided button", async () => {
    mockUseTravel.mockReturnValue(atDeepPast());
    render(<WorldsSurface enabled graph={deepPastGraph} />);
    expect(screen.getByRole("dialog", { name: "The Deep Past" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.queryByText(/Chronicle route:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Descend the Chronicle" })).toBeNull();
  });
});

describe("WorldsSurface — the People (P3-3)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  const peopleGraph = {
    nodes: [
      { id: 1, label: "Shaqavia", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity" },
      { id: 2, label: "Syncere", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity" },
      { id: 10, label: "first day", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 11, label: "shared supper", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    links: [
      { id: 100, source: 10, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 101, source: 11, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 102, source: 11, target: 2, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  } as never;

  it("at People with the graph it mounts the field; without WebGL it degrades honestly", async () => {
    mockUseTravel.mockReturnValue(atPeople());
    render(<WorldsSurface enabled graph={peopleGraph} />);
    expect(screen.getByRole("dialog", { name: "The People" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your people are unaffected/)).toBeTruthy();
  });

  it("at People without the graph yet it shows a loading line and builds nothing", () => {
    mockUseTravel.mockReturnValue(atPeople());
    render(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "The People" })).toBeTruthy();
    expect(screen.getByText(/Your people are gathering/)).toBeTruthy();
  });

  it("an empty graph still mounts the field — honest resting ground, never a locked door", async () => {
    mockUseTravel.mockReturnValue(atPeople());
    render(<WorldsSurface enabled graph={{ nodes: [], links: [] } as never} />);
    expect(screen.getByRole("dialog", { name: "The People" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
  });
});
