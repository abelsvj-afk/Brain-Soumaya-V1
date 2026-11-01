import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { announceTravelChanged, requestEnterWorld } from "../lib/travelEvents.js";
import WorldsSurface, { WORLD_DATA_GRACE_MS } from "./WorldsSurface.js";
import { TRANSIT_MS } from "./TravelPanel.js";
import { useTravel, type UseTravel } from "../hooks/useTravel.js";
import { useHarborController, type UseHarborController } from "../hooks/useHarborController.js";
import { useCaptains, type UseCaptains } from "../hooks/useCaptains.js";
import { getJourneys, journeyLinks } from "../api/journeys.js";
import { getArchivedNodesStrict, getIncidentEdges } from "../api/client.js";

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
  // Verb 1's component also imports getSpaceId (garden ignored-suggestion key);
  // the tip's narrow mock omitted it, breaking 3 garden tests on rebase.
  getSpaceId: vi.fn(() => "space-1"),
}));
const mockUseTravel = vi.mocked(useTravel);

/**
 * The scene layer only wakes after the traveller does something in THIS session (departs, or taps
 * "Look around") — it never opens just because the server remembers a world. These tests are about
 * what it shows once awake, so wake it the way the Look around button does.
 */
function mountEngaged(ui: ReactElement) {
  const r = render(ui);
  act(() => requestEnterWorld());
  return r;
}
const mockUseHarborController = vi.mocked(useHarborController);
const mockUseCaptains = vi.mocked(useCaptains);
const mockGetJourneys = vi.mocked(getJourneys);
const mockJourneyLinks = vi.mocked(journeyLinks);
const mockGetArchivedNodesStrict = vi.mocked(getArchivedNodesStrict);
const mockGetIncidentEdges = vi.mocked(getIncidentEdges);

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

function fakeController(over: Partial<UseHarborController> = {}): UseHarborController {
  return {
    npc: {
      id: "harbor-controller",
      name: "Harbor controller",
      job: "Help you arrive — routes, arrivals, traffic.",
      world: "great-station",
      stopped: false,
      actsToday: 1,
      speaksToday: 0,
      gateOpen: false,
      relicsHeld: 0,
      recentLog: [],
    },
    answer: null,
    loading: false,
    failed: false,
    error: null,
    refresh: vi.fn(async () => {}),
    ask: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    ...over,
  };
}

function fakeCaptains(over: Partial<UseCaptains> = {}): UseCaptains {
  return {
    captains: [
      {
        id: "bex",
        name: "Bex",
        role: "Regular",
        pronouns: "she",
        ageBand: "late 20s",
        personality: "Warm, sociable, always at the Station.",
        traits: ["Sociable", "Generous", "Cautious"],
        active: true,
        present: true,
        homeWorld: "great-station",
        homeAnchor: "her Station quarter",
        currentWorld: "great-station",
        transitState: "none",
        legTo: null,
        legKind: null,
        sessionState: "visiting",
        doingLine: "Visiting the Great Station.",
        fuel: 60,
        credits: 120,
        stopped: false,
        actsToday: 1,
        speaksToday: 0,
        meetingsRemembered: 0,
        firstMetAt: null,
        recentLog: [],
        barks: [],
      },
    ],
    chronicle: [],
    answers: new Map(),
    loading: false,
    failed: false,
    error: null,
    refresh: vi.fn(async () => {}),
    ask: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    wipeMeetings: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    ...over,
  };
}

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

const atScale = (over: Partial<UseTravel> = {}) =>
  fakeTravel({
    state: {
      currentWorld: "scale",
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
    mockUseHarborController.mockReset();
    mockUseHarborController.mockReturnValue(fakeController());
  });

  it("flag off renders nothing (the dark contract)", () => {
    mockUseTravel.mockReturnValue(atStation());
    const { container } = mountEngaged(<WorldsSurface enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("at home renders nothing — the surface belongs to the Station", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { container } = mountEngaged(<WorldsSurface enabled />);
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
    mountEngaged(<WorldsSurface enabled />);
    expect(
      screen.getByRole("dialog", { name: "Travelling to The Great Station" }),
    ).toBeTruthy();
    // happy-dom has no working WebGL: the honest fallback appears,
    // the journey itself is unaffected.
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your journey is unaffected/)).toBeTruthy();
  });

  describe("arrival is the scene layer's job when the flight ends", () => {
    // Before this, only a text button in the travel sheet ever called arrive():
    // the flight played (once it could be seen at all) and then nothing
    // happened. The server accepts arrival whenever asked; the scene layer
    // decides WHEN to ask, from the server's own departedAt.
    const inTransit = (departedAt: string | undefined, kind: "warp" | "drift" = "warp") =>
      atStation({
        state: {
          currentWorld: "home",
          activeJourney: {
            id: "j-arr",
            kind,
            origin: "home",
            destination: "great-station",
            state: "in_transit",
            fuelCharged: 10,
            cancellable: false,
            createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z",
            ...(departedAt ? { departedAt } : {}),
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("arrives when the warp's transit time is up — not before", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
      const arrive = vi.fn(async () => null);
      mockUseTravel.mockReturnValue({ ...inTransit("2026-10-28T12:00:00.000Z"), arrive });
      mountEngaged(<WorldsSurface enabled />);
      vi.advanceTimersByTime(TRANSIT_MS.warp - 500);
      expect(arrive).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(arrive).toHaveBeenCalledTimes(1);
    });

    it("resumes from the server's departedAt after a reload — a flight 10s in has 2s left, not 12", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-28T12:00:10.000Z"));
      const arrive = vi.fn(async () => null);
      mockUseTravel.mockReturnValue({ ...inTransit("2026-10-28T12:00:00.000Z"), arrive });
      mountEngaged(<WorldsSurface enabled />);
      vi.advanceTimersByTime(TRANSIT_MS.warp - 10_000 + 100);
      expect(arrive).toHaveBeenCalledTimes(1);
    });

    it("a flight already past its time arrives at once", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-28T12:05:00.000Z"));
      const arrive = vi.fn(async () => null);
      mockUseTravel.mockReturnValue({ ...inTransit("2026-10-28T12:00:00.000Z"), arrive });
      mountEngaged(<WorldsSurface enabled />);
      vi.advanceTimersByTime(10);
      expect(arrive).toHaveBeenCalledTimes(1);
    });

    it("a drift takes its own, longer time", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
      const arrive = vi.fn(async () => null);
      mockUseTravel.mockReturnValue({ ...inTransit("2026-10-28T12:00:00.000Z", "drift"), arrive });
      mountEngaged(<WorldsSurface enabled />);
      vi.advanceTimersByTime(TRANSIT_MS.warp + 1000);
      expect(arrive).not.toHaveBeenCalled();
      vi.advanceTimersByTime(TRANSIT_MS.drift - TRANSIT_MS.warp);
      expect(arrive).toHaveBeenCalledTimes(1);
    });

    it("never asks to arrive when nothing is in flight", () => {
      vi.useFakeTimers();
      const arrive = vi.fn(async () => null);
      mockUseTravel.mockReturnValue({ ...atStation(), arrive });
      mountEngaged(<WorldsSurface enabled />);
      vi.advanceTimersByTime(TRANSIT_MS.drift * 2);
      expect(arrive).not.toHaveBeenCalled();
    });
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
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "Travelling to Home" })).toBeTruthy();
  });

  it("arming plays the departure: the flight scene is up from the moment of departure, with the cancel button on it (EVE-style travel)", () => {
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
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "Departing for The Great Station" })).toBeTruthy();
  });

  it("at the Station the surface mounts; without WebGL it degrades honestly, and Close is view-only", async () => {
    mockUseTravel.mockReturnValue(atStation());
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "The Great Station" })).toBeTruthy();
    // happy-dom has no working WebGL: the honest fallback appears,
    // journeys unaffected.
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to your galaxy" }));
    // ← Galaxy now warps HOME through the real journey; this fake cannot arm one (depart → null), so the instant return
    // is the fallback and the way out is never lost.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("← Galaxy warps home: it departs a warp to Home, and does NOT dismiss the scene while the trip is arming (owner: Soumaya warps back)", async () => {
    const t = atStation();
    t.depart = vi.fn(async () => ({
      id: "j-home", kind: "warp", origin: "great-station", destination: "home", state: "arming", fuelCharged: 0, cancellable: true,
      createdAt: "2026-10-30T12:00:00.000Z", cancelDeadline: "2026-10-30T12:00:03.000Z",
    })) as unknown as UseTravel["depart"];
    mockUseTravel.mockReturnValue(t);
    mountEngaged(<WorldsSurface enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Back to your galaxy" }));
    await waitFor(() => expect(t.depart).toHaveBeenCalledWith("warp", "home"));
    expect(screen.getByRole("dialog", { name: "The Great Station" })).toBeTruthy(); // still up: the flight scene takes over from here
  });

  it("at the Station the Harbor controller button opens its panel, and only there", async () => {
    mockUseTravel.mockReturnValue(atStation());
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "The Great Station" })).toBeTruthy();
    expect(screen.queryByText(/Help you arrive/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Harbor controller" }));
    expect(await screen.findByText(/Help you arrive/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Routes from here" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide the harbor controller" }));
    expect(screen.queryByText(/Help you arrive/)).toBeNull();
  });

  it("at the Station the Captains button opens the captains panel, Chronicle included (NPC-Player L1)", async () => {
    mockUseCaptains.mockReturnValue(fakeCaptains());
    mockUseTravel.mockReturnValue(atStation());
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "The Great Station" })).toBeTruthy();
    expect(screen.queryByText(/Bex — Regular/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Captains" }));
    expect(await screen.findByText(/Bex — Regular/)).toBeTruthy();
    expect(screen.getByText(/The Chronicle/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide the captains" }));
    expect(screen.queryByText(/Bex — Regular/)).toBeNull();
  });
});

describe("WorldsSurface — the Growing Place (P3-1)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  it("at the garden with the graph it mounts the garden; without WebGL it degrades honestly", async () => {
    mockUseTravel.mockReturnValue(atGarden());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your memories are unaffected/)).toBeTruthy();
  });

  it("the garden waits for its Journeys before building (one build, not one per late arrival) — but never longer than the grace", async () => {
    // Measured: every late arrival (Journeys → links → due reviews → tends)
    // changed the layout and rebuilt the whole 3D view, re-requesting every
    // model (3 mounts). The world now builds once, when its data has settled.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mockGetJourneys.mockImplementationOnce(() => new Promise(() => {})); // never settles
      mockUseTravel.mockReturnValue(atGarden());
      mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
      expect(screen.getByText(/Your garden is loading/)).toBeTruthy();
      act(() => void vi.advanceTimersByTime(WORLD_DATA_GRACE_MS - 500));
      expect(screen.getByText(/Your garden is loading/)).toBeTruthy(); // still waiting
      act(() => void vi.advanceTimersByTime(600));
      expect(screen.queryByText(/Your garden is loading/)).toBeNull(); // grace over: it builds with what it has
    } finally {
      vi.useRealTimers();
    }
  });

  it("outside the Station there is no Harbor controller button", () => {
    mockUseTravel.mockReturnValue(atGarden());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Harbor controller" })).toBeNull();
  });

  it("at the garden without the graph yet it shows a loading line and builds nothing", () => {
    mockUseTravel.mockReturnValue(atGarden());
    mountEngaged(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(screen.getByText(/Your garden is loading/)).toBeTruthy();
  });

  it("an unknown world renders nothing — the registry admits only built worlds", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "not-a-world",
          activeJourney: null,
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    const { container } = mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
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
    mountEngaged(<WorldsSurface enabled graph={deepPastGraph} />);
    expect(screen.getByRole("dialog", { name: "The Deep Past" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your memories are unaffected/)).toBeTruthy();
  });

  it("at the Deep Past without the graph yet it shows a loading line and builds nothing", () => {
    mockUseTravel.mockReturnValue(atDeepPast());
    mountEngaged(<WorldsSurface enabled graph={null} />);
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
    mountEngaged(<WorldsSurface enabled graph={deepPastGraph} />);
    expect(await screen.findByText(/Chronicle route: Done chapter — 2 stops along the descent/)).toBeTruthy();
    // The Chronicle ride is user-initiated, never auto-started.
    const descend = screen.getByRole("button", { name: "Descend the Chronicle" });
    fireEvent.click(descend);
    // Rework: entering the ride offers "Leave the ride" (leaving parks
    // the stop) — the old guided toggle's "Back to the rim" is gone.
    expect(screen.getByRole("button", { name: "Leave the ride" })).toBeTruthy();
  });

  it("with no qualifying route there is no thread and no guided button", async () => {
    mockUseTravel.mockReturnValue(atDeepPast());
    mountEngaged(<WorldsSurface enabled graph={deepPastGraph} />);
    expect(screen.getByRole("dialog", { name: "The Deep Past" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.queryByText(/Chronicle route:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Descend the Chronicle" })).toBeNull();
    // The walk needs no route: it is always offered in Deep Past.
    expect(screen.getByRole("button", { name: "Walk the stair" })).toBeTruthy();
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
    mountEngaged(<WorldsSurface enabled graph={peopleGraph} />);
    expect(screen.getByRole("dialog", { name: "The People" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your people are unaffected/)).toBeTruthy();
  });

  it("at People without the graph yet it shows a loading line and builds nothing", () => {
    mockUseTravel.mockReturnValue(atPeople());
    mountEngaged(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "The People" })).toBeTruthy();
    expect(screen.getByText(/Your people are gathering/)).toBeTruthy();
  });

  it("an empty graph still mounts the field — honest resting ground, never a locked door", async () => {
    mockUseTravel.mockReturnValue(atPeople());
    mountEngaged(<WorldsSurface enabled graph={{ nodes: [], links: [] } as never} />);
    expect(screen.getByRole("dialog", { name: "The People" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
  });
});

describe("WorldsSurface — Quiet/Archive (Wave 2)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
    mockGetArchivedNodesStrict.mockResolvedValue([]);
    mockGetIncidentEdges.mockResolvedValue({ edges: [], nextCursor: null });
  });

  const atQuietArchive = () =>
    fakeTravel({
      state: {
        currentWorld: "quiet-archive",
        activeJourney: null,
        fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
      },
    });

  const archivedNodes = [
    { id: 1, label: "Shaqavia", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity", status: "archived" },
    { id: 10, label: "first day", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", status: "archived" },
  ];
  const archivedEdges = [
    { id: 100, source: 10, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  it("at the Archive it fetches the archived input (never the live graph) and mounts the field", async () => {
    mockGetArchivedNodesStrict.mockResolvedValue(archivedNodes as never);
    mockGetIncidentEdges.mockResolvedValue({ edges: archivedEdges, nextCursor: null } as never);
    mockUseTravel.mockReturnValue(atQuietArchive());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(screen.getByRole("dialog", { name: "Quiet/Archive" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your memories are unaffected/)).toBeTruthy();
    expect(mockGetArchivedNodesStrict).toHaveBeenCalled();
    expect(mockGetIncidentEdges).toHaveBeenCalledWith([1, 10], null);
  });

  it("while the archive is still loading it says so and builds nothing", () => {
    mockGetArchivedNodesStrict.mockReturnValue(new Promise(() => {}) as never);
    mockUseTravel.mockReturnValue(atQuietArchive());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(screen.getByRole("dialog", { name: "Quiet/Archive" })).toBeTruthy();
    expect(screen.getByText(/Your archive is resting/)).toBeTruthy();
    expect(screen.queryByText(/needs graphics support/)).toBeNull();
  });

  it("an empty archive mounts the still field and says so plainly — never a locked door", async () => {
    mockUseTravel.mockReturnValue(atQuietArchive());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(await screen.findByText(/Nothing rests here yet/)).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
  });

  it("a failed archive fetch renders the error and a retry — never an empty field", async () => {
    mockGetArchivedNodesStrict.mockRejectedValue(new Error("down"));
    mockUseTravel.mockReturnValue(atQuietArchive());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(await screen.findByText(/couldn't load/)).toBeTruthy();
    // Retry re-fetches: the mock now succeeds, and the field mounts.
    mockGetArchivedNodesStrict.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Nothing rests here yet/)).toBeTruthy();
  });

  it("incident edges are paged to completion — a cursor is followed, not dropped", async () => {
    mockGetArchivedNodesStrict.mockResolvedValue(archivedNodes as never);
    mockGetIncidentEdges
      .mockResolvedValueOnce({ edges: [archivedEdges[0]], nextCursor: 100 } as never)
      .mockResolvedValueOnce({ edges: [], nextCursor: null } as never);
    mockUseTravel.mockReturnValue(atQuietArchive());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(mockGetIncidentEdges).toHaveBeenCalledWith([1, 10], null);
    expect(mockGetIncidentEdges).toHaveBeenCalledWith([1, 10], 100);
  });
});

describe("WorldsSurface — Scale (Phase 3)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  it("at Scale it mounts the station view; without WebGL it degrades honestly", async () => {
    mockUseTravel.mockReturnValue(atScale());
    mountEngaged(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "Scale" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your journeys are unaffected/)).toBeTruthy();
  });

  it("at Scale it needs no graph — the space carries no memories of its own", async () => {
    mockUseTravel.mockReturnValue(atScale());
    mountEngaged(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "Scale" })).toBeTruthy();
    // No loading line: Scale's layout builds without the graph.
    expect(screen.queryByText(/coming into view/)).toBeNull();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
  });

  it("at Scale the Captains button opens the panel — without the Chronicle (NPC-Player L1)", async () => {
    mockUseCaptains.mockReturnValue(fakeCaptains());
    mockUseTravel.mockReturnValue(atScale());
    mountEngaged(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "Scale" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Captains" }));
    expect(await screen.findByText(/Bex — Regular/)).toBeTruthy();
    expect(screen.queryByText(/The Chronicle/)).toBeNull();
  });

  it("in the garden there is no Captains button (NPC-Player L1)", () => {
    mockUseTravel.mockReturnValue(atGarden());
    mountEngaged(<WorldsSurface enabled graph={gardenGraph} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Captains" })).toBeNull();
  });
});

describe("WorldsSurface — Eternity's World", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  const atEternity = (over: Partial<UseTravel> = {}) =>
    fakeTravel({
      state: {
        currentWorld: "eternity",
        activeJourney: null,
        fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
      },
      ...over,
    });

  it("at Eternity's world it mounts; without WebGL it degrades honestly", async () => {
    mockUseTravel.mockReturnValue(atEternity());
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "Eternity's World" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your journeys are unaffected/)).toBeTruthy();
  });

  it("his gestures and tools are offered as buttons; his words live in the world, not over the view", async () => {
    mockUseTravel.mockReturnValue(atEternity());
    mountEngaged(<WorldsSurface enabled />);
    for (const name of ["Stillness", "Regard", "Blessing", "Sorrow", "Joy", "Warning"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    for (const name of ["Reorder the heavens", "Part the veil", "Raise the shield", "Send a comet"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(
      screen.getByText(/his words appear in the world near his mouth — never over your view/),
    ).toBeTruthy();
    // A gesture button without a mounted scene (no WebGL here) must
    // not throw — and must not claim he holds anything, because the
    // world never mounted to hold it.
    fireEvent.click(screen.getByRole("button", { name: "Blessing" }));
    expect(screen.queryByText(/He is holding/)).toBeNull();
  });
});


describe("opening the app lands in the home galaxy — the layer wakes only on a session action", () => {
  // The owner opened the app and was shown a flying ship and a gate instead of the home galaxy:
  // the layer drew whatever the SERVER had saved (a world, or a journey the old build never
  // finished). It must stay hidden until the traveller acts.
  const savedAtGarden = () => atGarden();
  const staleInTransit = () =>
    fakeTravel({
      state: {
        currentWorld: "home",
        activeJourney: {
          id: "stale-1",
          kind: "warp",
          origin: "home",
          destination: "great-station",
          state: "in_transit",
          fuelCharged: 10,
          cancellable: false,
          createdAt: "2026-10-20T12:00:00.000Z",
          cancelDeadline: "2026-10-20T12:00:10.000Z",
          departedAt: "2026-10-20T12:00:11.000Z",
        },
        fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
      },
    });

  it("a saved world does NOT open at launch", () => {
    mockUseTravel.mockReturnValue(savedAtGarden());
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
  });

  it("a journey saved by an earlier session does NOT open the flight at launch", () => {
    mockUseTravel.mockReturnValue(staleInTransit());
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
  });

  it("…but the stale journey still gets settled in the background (it must not stay stuck)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T12:00:00.000Z"));
    const arrive = vi.fn(async () => null);
    mockUseTravel.mockReturnValue({ ...staleInTransit(), arrive });
    render(<WorldsSurface enabled />);
    vi.advanceTimersByTime(10);
    expect(arrive).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("'Look around' opens the world the server says you are in", () => {
    mockUseTravel.mockReturnValue(savedAtGarden());
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
    act(() => requestEnterWorld());
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
  });

  it("a departure made in this session wakes it — the flight and arrival then show", () => {
    mockUseTravel.mockReturnValue(staleInTransit());
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
    act(() => announceTravelChanged("depart", "some-other-copy"));
    expect(screen.getByRole("dialog", { name: "Travelling to The Great Station" })).toBeTruthy();
  });

  it("an arrival, a cancel or a turn-back alone does NOT wake it", () => {
    mockUseTravel.mockReturnValue(savedAtGarden());
    const { container } = render(<WorldsSurface enabled />);
    for (const a of ["arrive", "cancel", "turn-back"] as const) act(() => announceTravelChanged(a, "other"));
    expect(container.firstChild).toBeNull();
  });

  it("after it is awake, 'Back to your galaxy' still closes it (when no trip can be armed), and Look around reopens it", async () => {
    mockUseTravel.mockReturnValue(savedAtGarden());
    mountEngaged(<WorldsSurface enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Back to your galaxy" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "The Growing Place" })).toBeNull());
    act(() => requestEnterWorld());
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
  });
});

describe("WorldsSurface — the Station Interior (Wave 2, settled design)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
    mockUseHarborController.mockReset();
    mockUseHarborController.mockReturnValue(fakeController());
    mockUseTravel.mockReturnValue(atStation());
  });

  it("outside, the Station offers one way in — and no room list yet", () => {
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByRole("button", { name: "Step inside the Station" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Step back outside" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Go to the/ })).toBeNull();
  });

  it("stepping inside opens on the hangar bay, the arrival room, with the other three rooms on the list", () => {
    mountEngaged(<WorldsSurface enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Step inside the Station" }));
    expect(screen.getByRole("button", { name: "Step back outside" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to the Commission Board" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to the Fleet Deck" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to the Observation Deck" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go to the Hangar Bay" })).toBeNull();
    expect(screen.getByText(/The Hangar Bay/)).toBeTruthy();
    // The bay is the ship room now: the Batch O ship picker lives here.
    expect(screen.getByText(/Spaceship Hull/)).toBeTruthy();
  });

  it("room changes jump — no walking, no glide, no 'Walk to' anywhere", () => {
    mountEngaged(<WorldsSurface enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Step inside the Station" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to the Fleet Deck" }));
    expect(screen.getByText(/^The Fleet Deck$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to the Hangar Bay" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go to the Fleet Deck" })).toBeNull();
    expect(screen.queryByText(/Walk to/)).toBeNull();
    expect(screen.queryByText(/walk/i)).toBeNull();
    // The fleet deck wires the shipped fleet surfaces.
    expect(screen.getByRole("heading", { name: "Fleet missions" })).toBeTruthy();
  });

  it("the commission board room opens the board's four kinds", () => {
    mountEngaged(<WorldsSurface enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Step inside the Station" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to the Commission Board" }));
    expect(screen.getByText(/^The Commission Board$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Link —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Journey step —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Inbox item —/ })).toBeTruthy();
  });

  it("the observation deck is quiet: its line, no room panel, no task, no counter, nothing to earn", () => {
    mountEngaged(<WorldsSurface enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Step inside the Station" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to the Observation Deck" }));
    expect(screen.getByText(/^The Observation Deck$/)).toBeTruthy();
    expect(screen.getByText(/nothing to do/)).toBeTruthy();
    expect(screen.queryByLabelText("Commission board")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Fleet missions" })).toBeNull();
    expect(screen.queryByText(/Spaceship Hull/)).toBeNull();
  });

  it("stepping back outside returns to the exterior offer", () => {
    mountEngaged(<WorldsSurface enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Step inside the Station" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to the Observation Deck" }));
    fireEvent.click(screen.getByRole("button", { name: "Step back outside" }));
    expect(screen.getByRole("button", { name: "Step inside the Station" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Go to the/ })).toBeNull();
    expect(screen.queryByText(/^The Observation Deck$/)).toBeNull();
  });
});


describe("free look — the first-time hint", () => {
  // The hint tells the traveller the world can be moved. It once started its timer when the app LOADED
  // at a saved world (layer still hidden), so it had expired before the traveller ever saw the world.
  beforeEach(() => {
    localStorage.removeItem("worlds.lookHintSeen");
    // These tests are about the look-around hint; the world's purpose line (audit X4) has its own test below.
    localStorage.setItem("worlds.purposeSeen.growing-place", "1");
    mockUseTravel.mockReturnValue(atGarden());
  });
  afterEach(() => vi.useRealTimers());

  it("the first time in a world it says what the world is for, once, before the look-around hint (audit X4)", () => {
    localStorage.removeItem("worlds.purposeSeen.growing-place");
    vi.useFakeTimers();
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByText(/grows your Journeys as groves/i)).toBeTruthy();
    expect(screen.queryByText(/drag to look around/i)).toBeNull();
    act(() => vi.advanceTimersByTime(12_500));
    expect(screen.queryByText(/grows your Journeys as groves/i)).toBeNull();
    expect(localStorage.getItem("worlds.purposeSeen.growing-place")).toBe("1");
    // the next visit does not repeat it
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.queryByText(/grows your Journeys as groves/i)).toBeNull();
  });

  it("is NOT shown while the world is hidden at launch — and its clock has not started", () => {
    vi.useFakeTimers();
    render(<WorldsSurface enabled />);
    vi.advanceTimersByTime(60_000); // a long time at the home galaxy
    act(() => requestEnterWorld());
    expect(screen.getByText(/drag to look around/i)).toBeTruthy(); // still there when they DO enter
  });

  it("is shown on entering a world, then gone after a while and never again", () => {
    vi.useFakeTimers();
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.getByText(/drag to look around/i)).toBeTruthy();
    act(() => vi.advanceTimersByTime(9_500));
    expect(screen.queryByText(/drag to look around/i)).toBeNull();
    expect(localStorage.getItem("worlds.lookHintSeen")).toBe("1");
    // a fresh mount (next visit) stays quiet
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.queryByText(/drag to look around/i)).toBeNull();
  });

  it("is not shown over the transit flight (nothing to look around yet)", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "home",
          activeJourney: {
            id: "j-h", kind: "warp", origin: "home", destination: "great-station", state: "in_transit",
            fuelCharged: 10, cancellable: false, createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z", departedAt: new Date().toISOString(),
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    mountEngaged(<WorldsSurface enabled />);
    expect(screen.queryByText(/drag to look around/i)).toBeNull();
  });
});
