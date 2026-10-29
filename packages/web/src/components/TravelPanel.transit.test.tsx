import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import TravelPanel from "./TravelPanel.js";
import { useTravel, type UseTravel } from "../hooks/useTravel.js";

vi.mock("../hooks/useTravel.js", () => ({ useTravel: vi.fn() }));
const mockUseTravel = vi.mocked(useTravel);

const journey = (state: string, id = "j-1") => ({
  id,
  kind: "warp" as const,
  origin: "home",
  destination: "great-station",
  state,
  fuelCharged: 10,
  cancellable: state === "arming",
  createdAt: "2026-10-28T12:00:00.000Z",
  cancelDeadline: "2026-10-28T12:00:10.000Z",
});
const travel = (active: ReturnType<typeof journey> | null): UseTravel =>
  ({
    state: { currentWorld: "home", activeJourney: active, fuel: { fuel: 40, capacity: 200, jobCost: 2, warpCost: 10 } },
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
  }) as unknown as UseTravel;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// The sheet must hand the screen to the flight: while it stays open (z above
// the worlds layer) the transit scene plays unseen behind a scrim.
describe("TravelPanel — hands the screen to the flight", () => {
  it("does NOT fire while the journey is still in the cancel window (cancelling needs the sheet)", () => {
    const onTransit = vi.fn();
    mockUseTravel.mockReturnValue(travel(journey("arming")));
    render(<TravelPanel enabled onTransit={onTransit} />);
    expect(onTransit).not.toHaveBeenCalled();
  });

  it("fires once when the ship is under way, and not again on re-render", () => {
    const onTransit = vi.fn();
    mockUseTravel.mockReturnValue(travel(journey("in_transit")));
    const { rerender } = render(<TravelPanel enabled onTransit={onTransit} />);
    rerender(<TravelPanel enabled onTransit={onTransit} />);
    rerender(<TravelPanel enabled onTransit={onTransit} />);
    expect(onTransit).toHaveBeenCalledTimes(1);
  });

  it("fires again for the NEXT journey", () => {
    const onTransit = vi.fn();
    mockUseTravel.mockReturnValue(travel(journey("in_transit", "j-1")));
    const { rerender } = render(<TravelPanel enabled onTransit={onTransit} />);
    mockUseTravel.mockReturnValue(travel(null));
    rerender(<TravelPanel enabled onTransit={onTransit} />);
    mockUseTravel.mockReturnValue(travel(journey("in_transit", "j-2")));
    rerender(<TravelPanel enabled onTransit={onTransit} />);
    expect(onTransit).toHaveBeenCalledTimes(2);
  });

  it("a turn-back (returning) is a flight too", () => {
    const onTransit = vi.fn();
    mockUseTravel.mockReturnValue(travel(journey("returning")));
    render(<TravelPanel enabled onTransit={onTransit} />);
    expect(onTransit).toHaveBeenCalledTimes(1);
  });
});
