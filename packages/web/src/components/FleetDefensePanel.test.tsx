import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { FleetDefenseOverview } from "@brain/shared";
import FleetDefensePanel from "./FleetDefensePanel.js";
import {
  getFleetDefenseOverview,
  offerFleetDefenseRelease,
  startFleetDefense,
  tickFleetDefense,
} from "../api/fleetDefense.js";

vi.mock("../api/fleetDefense.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/fleetDefense.js")>();
  return {
    ...orig,
    getFleetDefenseOverview: vi.fn(),
    offerFleetDefenseRelease: vi.fn(),
    startFleetDefense: vi.fn(),
    tickFleetDefense: vi.fn(),
  };
});

const mockGet = vi.mocked(getFleetDefenseOverview);
const mockOffer = vi.mocked(offerFleetDefenseRelease);
const mockStart = vi.mocked(startFleetDefense);
const mockTick = vi.mocked(tickFleetDefense);

const emptyOverview = (): FleetDefenseOverview => ({
  releases: [],
  activeDefense: null,
  activeRelease: null,
  history: [],
  recentLog: [],
});

const offeredOverview = (): FleetDefenseOverview => ({
  ...emptyOverview(),
  releases: [
    {
      id: 1,
      kind: "emotion",
      size: "small",
      label: "the old argument",
      nodeId: null,
      status: "offered",
      createdAt: "2026-10-22T12:00:00.000Z",
      updatedAt: "2026-10-22T12:00:00.000Z",
    },
  ],
});

const activeOverview = (): FleetDefenseOverview => ({
  ...emptyOverview(),
  releases: [
    {
      id: 1,
      kind: "emotion",
      size: "small",
      label: "the old argument",
      nodeId: null,
      status: "defending",
      createdAt: "2026-10-22T12:00:00.000Z",
      updatedAt: "2026-10-22T12:00:00.000Z",
    },
  ],
  activeDefense: {
    id: 7,
    releaseId: 1,
    status: "active",
    invaders: [
      { lane: 1, distance: 4, shipKey: "bob", shipUrl: "/quaternius-bob.glb", shipName: "Quaternius bob", dispersed: false },
      { lane: 2, distance: 4, shipKey: "challenger", shipUrl: "/quaternius-challenger.glb", shipName: "Quaternius challenger", dispersed: false },
      { lane: 3, distance: 5, shipKey: "dispatcher", shipUrl: "/quaternius-dispatcher.glb", shipName: "Quaternius dispatcher", dispersed: true },
    ],
    tickCount: 1,
    lastMode: "autonomous",
    lastLine: "Soumaya fired down lane 3 and dispersed the Quaternius dispatcher.",
    outcomeLine: null,
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
  activeRelease: {
    id: 1,
    kind: "emotion",
    size: "small",
    label: "the old argument",
    nodeId: null,
    status: "defending",
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(emptyOverview());
});

describe("FleetDefensePanel", () => {
  it("states the invariant in plain words and shows the empty state", async () => {
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText(/Nothing offered yet/)).toBeTruthy());
    expect(screen.getByText(/Losing costs nothing/)).toBeTruthy();
    expect(screen.getByText(/Defending your own galaxy is free/)).toBeTruthy();
    expect(screen.getByText(/Eternity watches; he does not step in/)).toBeTruthy();
  });

  it("a failed load is an offline state with a retry, never an empty panel", async () => {
    mockGet.mockResolvedValueOnce(null);
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText(/couldn't be reached/)).toBeTruthy());
    mockGet.mockResolvedValueOnce(emptyOverview());
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(screen.getByText(/Nothing offered yet/)).toBeTruthy());
  });

  it("offering is two steps and sends the kind, size, and label", async () => {
    mockOffer.mockResolvedValue({
      id: 1,
      kind: "emotion",
      size: "small",
      label: "the old argument",
      nodeId: null,
      status: "offered",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    render(<FleetDefensePanel nodes={[{ id: 9, label: "The old argument" }]} />);
    await waitFor(() => expect(screen.getByText(/Nothing offered yet/)).toBeTruthy());
    fireEvent.click(screen.getByText("Offer something for release"));
    fireEvent.change(screen.getByPlaceholderText(/the anger from that argument/), {
      target: { value: "the old argument" },
    });
    fireEvent.click(screen.getByText("Offer this for release"));
    expect(mockOffer).not.toHaveBeenCalled();
    expect(screen.getByText("Yes, offer it for release")).toBeTruthy();
    fireEvent.click(screen.getByText("Yes, offer it for release"));
    await waitFor(() => expect(mockOffer).toHaveBeenCalled());
    expect(mockOffer).toHaveBeenCalledWith({
      kind: "emotion",
      size: "small",
      label: "the old argument",
      nodeId: null,
    });
  });

  it("an offered release shows the fleet it will draw and summons it", async () => {
    mockGet.mockResolvedValue(offeredOverview());
    mockStart.mockResolvedValue(activeOverview().activeDefense!);
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText("the old argument")).toBeTruthy());
    expect(screen.getByText(/3 ships will come/)).toBeTruthy();
    fireEvent.click(screen.getByText("Summon the fleet"));
    await waitFor(() => expect(mockStart).toHaveBeenCalledWith(1));
  });

  it("the board shows lanes, distances, and both ways to fly a round", async () => {
    mockGet.mockResolvedValue(activeOverview());
    mockTick.mockResolvedValue(activeOverview().activeDefense!);
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText("Defending: the old argument")).toBeTruthy());
    expect(screen.getByText("Quaternius bob — 4 steps out")).toBeTruthy();
    expect(screen.getByText("Quaternius dispatcher — dispersed")).toBeTruthy();
    expect(screen.getByText(/Soumaya fired down lane 3/)).toBeTruthy();
    fireEvent.click(screen.getByText("Let Soumaya take this round"));
    await waitFor(() => expect(mockTick).toHaveBeenCalledWith(7, "autonomous", undefined));
    fireEvent.click(screen.getByText("Fire lane 2"));
    await waitFor(() => expect(mockTick).toHaveBeenCalledWith(7, "helm", 2));
  });

  it("a won defense shows the codex line; a lost one names the retry", async () => {
    const won: FleetDefenseOverview = {
      ...emptyOverview(),
      releases: [
        {
          id: 1,
          kind: "emotion",
          size: "small",
          label: "the old argument",
          nodeId: null,
          status: "cleared",
          createdAt: "2026-10-22T12:00:00.000Z",
          updatedAt: "2026-10-22T12:00:00.000Z",
        },
      ],
      history: [
        {
          id: 7,
          releaseId: 1,
          status: "won",
          invaders: [],
          tickCount: 3,
          lastMode: "helm",
          lastLine: "You fired down lane 3 and dispersed the last invader — the Quaternius dispatcher. The charge is cleared.",
          outcomeLine: "On this day, the fleet dispersed and the charge was let go — the old argument.",
          createdAt: "2026-10-22T12:00:00.000Z",
          updatedAt: "2026-10-22T12:00:00.000Z",
        },
      ],
    };
    mockGet.mockResolvedValue(won);
    render(<FleetDefensePanel />);
    await waitFor(() =>
      expect(screen.getByText(/On this day, the fleet dispersed and the charge was let go/)).toBeTruthy(),
    );
    expect(screen.getByText(/Cleared — the old argument/)).toBeTruthy();
  });

  it("the practice section labels itself PRACTICE with nothing at stake", async () => {
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText("Practice in Scale Space")).toBeTruthy());
    expect(screen.getByText(/PRACTICE — this is only practice/)).toBeTruthy();
    expect(screen.getByText(/Nothing is at stake here/)).toBeTruthy();
    expect(screen.getByText(/nothing is cleared, nothing is saved/)).toBeTruthy();
    expect(screen.getByText("Start a practice round")).toBeTruthy();
  });

  it("a practice round shows the same board and calls no real-defense api", async () => {
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText("Start a practice round")).toBeTruthy());
    fireEvent.click(screen.getByText("Start a practice round"));
    expect(screen.getByText(/PRACTICE round/)).toBeTruthy();
    expect(screen.getByText("Quaternius bob — 5 steps out")).toBeTruthy();
    expect(mockOffer).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockTick).not.toHaveBeenCalled();
  });

  it("a practice win says nothing was cleared or saved — never the codex line", async () => {
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText("Start a practice round")).toBeTruthy());
    fireEvent.click(screen.getByText("Start a practice round"));
    fireEvent.click(screen.getByText("Let Soumaya take this round"));
    fireEvent.click(screen.getByText("Let Soumaya take this round"));
    fireEvent.click(screen.getByText("Let Soumaya take this round"));
    await waitFor(() => expect(screen.getByText(/Practice complete/)).toBeTruthy());
    expect(screen.getByText(/Nothing was released, nothing was cleared, nothing was saved/)).toBeTruthy();
    expect(mockTick).not.toHaveBeenCalled();
  });

  it("a practice loss costs nothing and ends practice cleanly", async () => {
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText("Start a practice round")).toBeTruthy());
    fireEvent.click(screen.getByText("Start a practice round"));
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText("Fire lane 1"));
    await waitFor(() => expect(screen.getByText(/Practice over/)).toBeTruthy());
    expect(screen.getByText(/Nothing was lost, nothing changed, nothing was saved/)).toBeTruthy();
    fireEvent.click(screen.getByText("End practice"));
    expect(screen.getByText("Start a practice round")).toBeTruthy();
  });

  it("practice is available even when the real defense cannot be reached", async () => {
    mockGet.mockResolvedValueOnce(null);
    render(<FleetDefensePanel />);
    await waitFor(() => expect(screen.getByText(/couldn't be reached/)).toBeTruthy());
    expect(screen.getByText("Practice in Scale Space")).toBeTruthy();
    fireEvent.click(screen.getByText("Start a practice round"));
    expect(screen.getByText(/PRACTICE round/)).toBeTruthy();
  });
});
