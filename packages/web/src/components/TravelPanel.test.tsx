import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TravelJourney } from "@brain/shared";
import TravelPanel from "./TravelPanel.js";
import { useTravel, type UseTravel } from "../hooks/useTravel.js";

vi.mock("../hooks/useTravel.js", () => ({ useTravel: vi.fn() }));
const mockUseTravel = vi.mocked(useTravel);

const journey = (over: Partial<TravelJourney> = {}): TravelJourney => ({
  id: "j-1",
  kind: "warp",
  origin: "home",
  destination: "great-station",
  state: "arming",
  fuelCharged: 0,
  cancellable: true,
  createdAt: "2026-10-23T12:00:00.000Z",
  cancelDeadline: "2026-10-23T12:00:10.000Z",
  ...over,
});

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

beforeEach(() => {
  vi.clearAllMocks();
  mockUseTravel.mockReturnValue(fakeTravel());
});

describe("TravelPanel", () => {
  it("renders nothing while the worlds flag is off (dark shipping)", () => {
    const { container } = render(<TravelPanel enabled={false} />);
    expect(container.textContent).toBe("");
    expect(mockUseTravel).toHaveBeenCalledWith(false);
  });

  it("shows the route board with honest prices at home", () => {
    render(<TravelPanel enabled />);
    expect(screen.getByText("The Great Station")).toBeTruthy();
    expect(screen.getByText("The Growing Place")).toBeTruthy();
    expect(screen.getByText("The Deep Past")).toBeTruthy();
    expect(screen.getByText("Quiet/Archive")).toBeTruthy();
    expect(screen.getByText("Scale")).toBeTruthy();
    expect(screen.getByText("You are here")).toBeTruthy();
    // Five off-world destinations now: each offers warp at the shared cost
    // and drift free. Scoped per destination so a sixth world cannot hide
    // behind a single-element query.
    const entries = screen.getAllByRole("listitem").filter((li) => li.className.includes("route-entry"));
    expect(entries).toHaveLength(6);
    // Fuel follows distance from Home: Station 8, Growing Place 7, Deep Past 8, Quiet/Archive 11, Scale 11.
    const homePrices = [8, 7, 8, 11, 11];
    for (const [i, entry] of entries.slice(1).entries()) {
      const scoped = within(entry as HTMLElement);
      expect(scoped.getByRole("button", { name: new RegExp(`Warp · ${homePrices[i]} fuel`) })).toBeTruthy();
      expect(scoped.getByRole("button", { name: /Drift · free/ })).toBeTruthy();
    }
  });

  it("disables warp on a low balance and says why — drift stays possible", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "home",
          activeJourney: null,
          fuel: { fuel: 3, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    render(<TravelPanel enabled />);
    const warps = screen.getAllByRole("button", { name: /Warp/ });
    expect(warps).toHaveLength(5); // Station + Garden + Deep Past + Quiet/Archive + Scale: warp is unaffordable to all
    for (const w of warps) expect((w as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/drifting is always free/)).toHaveLength(5);
  });

  it("depart is wired to the chosen route and kind", () => {
    const t = fakeTravel();
    mockUseTravel.mockReturnValue(t);
    render(<TravelPanel enabled />);
    const entries = screen.getAllByRole("listitem").filter((li) => li.className.includes("route-entry"));
    const station = within(entries[1] as HTMLElement);
    fireEvent.click(station.getByRole("button", { name: /Warp · 8 fuel/ }));
    expect(t.depart).toHaveBeenCalledWith("warp", "great-station");
    const garden = within(entries[2] as HTMLElement);
    fireEvent.click(garden.getByRole("button", { name: /Warp · 7 fuel/ }));
    expect(t.depart).toHaveBeenCalledWith("warp", "growing-place");
    const past = within(entries[3] as HTMLElement);
    fireEvent.click(past.getByRole("button", { name: /Warp · 8 fuel/ }));
    expect(t.depart).toHaveBeenCalledWith("warp", "deep-past");
    const archive = within(entries[4] as HTMLElement);
    fireEvent.click(archive.getByRole("button", { name: /Warp · 11 fuel/ }));
    expect(t.depart).toHaveBeenCalledWith("warp", "quiet-archive");
    const scale = within(entries[5] as HTMLElement);
    fireEvent.click(scale.getByRole("button", { name: /Warp · 11 fuel/ }));
    expect(t.depart).toHaveBeenCalledWith("warp", "scale");
  });

  it("shows People only when the server says the gate is open (P3-3, Q1)", () => {
    // Gate closed (the default mock carries no flag): no People entry.
    const { unmount } = render(<TravelPanel enabled />);
    expect(screen.queryByText("The People")).toBeNull();
    unmount();
    // Gate open: People appears as a seventh entry, wired like any world.
    const t = fakeTravel({
      state: {
        currentWorld: "home",
        activeJourney: null,
        fuel: { fuel: 25, capacity: 200, jobCost: 2, warpCost: 10 },
        peopleGateOpen: true,
      },
    });
    mockUseTravel.mockReturnValue(t);
    render(<TravelPanel enabled />);
    expect(screen.getByText("The People")).toBeTruthy();
    const entries = screen.getAllByRole("listitem").filter((li) => li.className.includes("route-entry"));
    expect(entries).toHaveLength(7);
    const people = within(entries[4] as HTMLElement);
    fireEvent.click(people.getByRole("button", { name: /Warp · 9 fuel/ }));
    expect(t.depart).toHaveBeenCalledWith("warp", "people");
    const scale = within(entries[6] as HTMLElement);
    fireEvent.click(scale.getByRole("button", { name: /Warp · 11 fuel/ }));
    expect(t.depart).toHaveBeenCalledWith("warp", "scale");
  });

  it("arming shows the server's cancel window as a countdown and a free cancel", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "home",
          activeJourney: journey(),
          fuel: { fuel: 25, capacity: 200, jobCost: 2, warpCost: 10 },
        },
        cancelSecondsLeft: 7,
      }),
    );
    render(<TravelPanel enabled />);
    expect(screen.getByText(/7s left to cancel free/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cancel — no charge/ })).toBeTruthy();
  });

  it("first trip in transit: no arrival is offered before its time — turn back always is", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "home",
          activeJourney: journey({ state: "in_transit", cancellable: false }),
          fuel: { fuel: 15, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    render(<TravelPanel enabled />);
    expect(screen.getByText(/First trip on this route/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Arrive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip the trip" })).toBeNull();
    expect(screen.getByRole("button", { name: "Turn back" })).toBeTruthy();
  });

  it("a traversed route may be skipped (D-11)", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "home",
          activeJourney: journey({ state: "in_transit", cancellable: false }),
          fuel: { fuel: 15, capacity: 200, jobCost: 2, warpCost: 10 },
        },
        hasTraversed: () => true,
      }),
    );
    render(<TravelPanel enabled />);
    expect(screen.getByRole("button", { name: "Skip the trip" })).toBeTruthy();
  });

  it("surfaces errors in plain language", () => {
    mockUseTravel.mockReturnValue(fakeTravel({ error: "Can't reach the brain right now." }));
    render(<TravelPanel enabled />);
    expect(screen.getByRole("alert").textContent).toContain("Can't reach the brain");
  });

  it("shows the bonus line only from the server's outcome — credited (P2-4)", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({ lastBonus: { credited: true, amount: 5, balance: 30, reason: null } }),
    );
    render(<TravelPanel enabled />);
    expect(screen.getByText("+5 fuel — journey bonus")).toBeTruthy();
  });

  it("a gated drift shows the server's plain reason, never a celebration (P2-4)", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        lastBonus: {
          credited: false,
          amount: 0,
          balance: 25,
          reason: "Today's drift bonuses are done — drifting itself is still free.",
        },
      }),
    );
    render(<TravelPanel enabled />);
    expect(screen.getByText(/drifting itself is still free/)).toBeTruthy();
    expect(screen.queryByText(/journey bonus/)).toBeNull();
  });

  it("no bonus state, no bonus line (P2-4)", () => {
    mockUseTravel.mockReturnValue(fakeTravel({ lastBonus: null }));
    render(<TravelPanel enabled />);
    expect(screen.queryByText(/journey bonus/)).toBeNull();
  });
});
