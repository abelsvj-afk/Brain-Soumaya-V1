import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MissionsOverview } from "@brain/shared";
import FleetMissionsPanel from "./FleetMissionsPanel.js";
import { dispatchMission, getMissions, recallMission, stopFleet } from "../api/missions.js";

vi.mock("../api/missions.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/missions.js")>();
  return {
    ...orig,
    getMissions: vi.fn(),
    dispatchMission: vi.fn(),
    recallMission: vi.fn(),
    stopFleet: vi.fn(),
    resumeFleet: vi.fn(),
  };
});

const mockGet = vi.mocked(getMissions);
const mockDispatch = vi.mocked(dispatchMission);
const mockRecall = vi.mocked(recallMission);
const mockStop = vi.mocked(stopFleet);

const state = (over: Partial<MissionsOverview> = {}): MissionsOverview => ({
  missions: [
    {
      id: "m-1",
      clientKey: "k-1",
      kind: "scouting",
      destination: "scale",
      origin: "home",
      fleetSize: 1,
      ships: ["bob"],
      durationMinutes: 30,
      fuelCost: 0,
      state: "outbound",
      createdAt: new Date().toISOString(),
      departedAt: new Date().toISOString(),
      arriveAt: null,
      returnAt: null,
      completedAt: null,
      outcome: null,
      report: null,
    },
  ],
  fleetStopped: false,
  fuel: { fuel: 25, capacity: 200 },
  log: [
    {
      id: 1,
      missionId: "m-1",
      kind: "dispatch",
      act: "Dispatched bob to Scale — a scouting run, 30 minutes. Free.",
      cause: "You sent the fleet — nothing dispatches without your tap.",
      createdAt: new Date().toISOString(),
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(state());
  mockDispatch.mockResolvedValue({ mission: state().missions[0]!, overview: state() });
  mockRecall.mockResolvedValue({
    mission: { ...state().missions[0]!, state: "recalled" as const },
    overview: state(),
  });
  mockStop.mockResolvedValue(state({ fleetStopped: true }));
});

describe("FleetMissionsPanel", () => {
  it("shows the dispatch form with a Free preview, and sends on tap", async () => {
    render(<FleetMissionsPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send the fleet" })).toBeTruthy());
    expect(screen.getByText(/Free — 1 ship, 30 minutes\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send the fleet" }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "journey", destination: "great-station", durationMinutes: 30, fleetSize: 1 }),
    );
  });

  it("shows a mission out now with its ships and a recall button", async () => {
    render(<FleetMissionsPanel />);
    await waitFor(() => expect(screen.getByText("Out now")).toBeTruthy());
    expect(screen.getByText(/Scouting — Scale/)).toBeTruthy();
    expect(screen.getAllByText(/bob/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Out;/)).toBeTruthy();
    fireEvent.click(screen.getByText("Recall"));
    await waitFor(() => expect(mockRecall).toHaveBeenCalledWith("m-1"));
  });

  it("shows the log and the stop switch", async () => {
    render(<FleetMissionsPanel />);
    await waitFor(() => expect(screen.getByText("The fleet's log")).toBeTruthy());
    expect(screen.getByText(/Dispatched bob to Scale/)).toBeTruthy();
    fireEvent.click(screen.getByText("Stop the fleet"));
    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Start the fleet again")).toBeTruthy());
  });

  it("shows a failed mission as returned empty-handed", async () => {
    mockGet.mockResolvedValue(
      state({
        missions: [
          {
            ...state().missions[0]!,
            state: "failed" as const,
            outcome: "The way to the People closed while the fleet was out — the fleet turned back and returned empty-handed.",
            completedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<FleetMissionsPanel />);
    await waitFor(() => expect(screen.getByText("Home again")).toBeTruthy());
    expect(screen.getByText(/Returned empty-handed/)).toBeTruthy();
    expect(screen.getByText(/returned empty-handed/)).toBeTruthy();
  });

  it("a failed load is an offline state with a retry", async () => {
    mockGet.mockResolvedValueOnce(null);
    render(<FleetMissionsPanel />);
    await waitFor(() => expect(screen.getByText(/couldn't be reached/)).toBeTruthy());
    mockGet.mockResolvedValue(state());
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send the fleet" })).toBeTruthy());
  });
});
