import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Tour, TourSessionView, TourSuggestion } from "@brain/shared";
import ToursPanel from "./ToursPanel.js";
import { useTours, type UseTours } from "../hooks/useTours.js";

vi.mock("../hooks/useTours.js", () => ({ useTours: vi.fn() }));
const mockUseTours = vi.mocked(useTours);

const stop = (over: Partial<Tour["stops"][number]> = {}) => ({
  nodeId: 1,
  world: "deep-past",
  label: "Packing boxes",
  narration: "We packed in March.",
  occurredAt: "2026-03-01T00:00:00.000Z",
  ...over,
});

const tour = (over: Partial<Tour> = {}): Tour => ({
  id: "tour-1",
  journeyId: 7,
  title: "The move",
  stops: [stop(), stop({ nodeId: 2, label: "The new flat", narration: "We moved in June.", occurredAt: "2026-06-01T00:00:00.000Z" })],
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  ...over,
});

const playingSession = (over: Partial<TourSessionView> = {}): TourSessionView => ({
  session: {
    tourId: "tour-1",
    state: "playing",
    endedReason: null,
    currentStopIndex: 0,
    pendingLegJourneyId: null,
    skippedNote: null,
    startedAt: "2026-10-26T00:00:00.000Z",
    endedAt: null,
  },
  tour: tour(),
  currentWorld: "deep-past",
  ...over,
});

const suggestion = (over: Partial<TourSuggestion> = {}): TourSuggestion => ({
  journeyId: 9,
  title: "The new job",
  stopCount: 3,
  reason: "“The new job” is finished, and its memories run in order — they would make a good tour.",
  ...over,
});

function fakeTours(over: Partial<UseTours> = {}): UseTours {
  return {
    tours: [],
    suggestions: [],
    session: null,
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    create: vi.fn(async () => null),
    rename: vi.fn(async () => null),
    remove: vi.fn(async () => null),
    restore: vi.fn(async () => null),
    start: vi.fn(async () => null),
    advance: vi.fn(async () => null),
    leave: vi.fn(async () => null),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseTours.mockReturnValue(fakeTours());
});

describe("ToursPanel", () => {
  it("renders nothing while the worlds flag is off (dark shipping)", () => {
    const { container } = render(<ToursPanel enabled={false} />);
    expect(container.textContent).toBe("");
    expect(mockUseTours).toHaveBeenCalledWith(false);
  });

  it("shows the empty state when there are no tours and no suggestions", () => {
    render(<ToursPanel enabled />);
    expect(screen.getByText(/No tours yet/)).toBeTruthy();
  });

  it("shows the server's error line in its own words, with a retry", () => {
    mockUseTours.mockReturnValue(fakeTours({ error: "Tours couldn't load — your tours are unaffected." }));
    const { container } = render(<ToursPanel enabled />);
    expect(container.textContent).toMatch("Tours couldn't load");
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("a suggestion shows the ship's reason and creates the tour on approval — nothing is created by showing it", () => {
    const create = vi.fn(async () => ({ tour: tour(), leftOut: [] }));
    mockUseTours.mockReturnValue(fakeTours({ suggestions: [suggestion()], create }));
    render(<ToursPanel enabled />);
    expect(screen.getByText(/would make a good tour/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Make this tour"));
    expect(create).toHaveBeenCalledWith(9);
  });

  it("a playing tour shows the current stop's own words, the full route in order, and free leaving", () => {
    const leave = vi.fn(async () => null);
    mockUseTours.mockReturnValue(fakeTours({ session: playingSession(), leave }));
    render(<ToursPanel enabled />);
    expect(screen.getByText("Now walking: The move")).toBeTruthy();
    // The narration is the memory's own words, verbatim.
    expect(screen.getByText("We packed in March.")).toBeTruthy();
    expect(screen.getByText("We moved in June.")).toBeTruthy();
    // The full route, in order, as still text — the reduced-motion equivalent.
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.textContent).toMatch("Packing boxes");
    expect(items[1]!.textContent).toMatch("The new flat");
    expect(screen.getByText("You are here", { exact: false })).toBeTruthy();
    // Same world as the next stop: drift only, no warp charge offered.
    expect(screen.getByText("Next stop")).toBeTruthy();
    expect(screen.queryByText(/Warp to the next stop/)).toBeNull();
    fireEvent.click(screen.getByText("Leave the tour"));
    expect(leave).toHaveBeenCalledWith("tour-1");
  });

  it("offers a warp to the next stop only when it is in another world", () => {
    const t = tour({
      stops: [
        stop(),
        stop({ nodeId: 2, world: "people", label: "Shaqavia", narration: "We met.", occurredAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    mockUseTours.mockReturnValue(fakeTours({ session: playingSession({ tour: t }), tours: [t] }));
    render(<ToursPanel enabled />);
    // deep-past → people by distance (shared warpCost), not a flat 10.
    expect(screen.getByText(/^Warp to the next stop · \d+ fuel$/)).toBeTruthy();
  });

  it("while a leg is pending, the tour waits and the travel panel owns the journey", () => {
    const s = playingSession();
    s.session.pendingLegJourneyId = "leg-1";
    mockUseTours.mockReturnValue(fakeTours({ session: s }));
    render(<ToursPanel enabled />);
    expect(screen.getByText(/The ship is on its way/)).toBeTruthy();
    expect(screen.queryByText("Next stop")).toBeNull();
    expect(screen.queryByText("Leave the tour")).not.toBeNull();
  });

  it("a left tour waits where you left it and resumes on request", () => {
    const start = vi.fn(async () => null);
    const s = playingSession();
    s.session.state = "ended";
    s.session.endedReason = "left";
    mockUseTours.mockReturnValue(fakeTours({ session: s, tours: [tour()], start }));
    render(<ToursPanel enabled />);
    expect(screen.getByText(/stepped off/)).toBeTruthy();
    fireEvent.click(screen.getAllByText("Resume the tour")[0]!);
    expect(start).toHaveBeenCalledWith("tour-1", "drift");
  });

  it("a tour that reached its last stop rests there — no progress, no score", () => {
    const s = playingSession();
    s.session.state = "ended";
    s.session.endedReason = "last-stop";
    mockUseTours.mockReturnValue(fakeTours({ session: s, tours: [tour()] }));
    render(<ToursPanel enabled />);
    expect(screen.getByText(/the tour rests here/)).toBeTruthy();
    expect(screen.queryByText(/%|done|complete/i)).toBeNull();
  });

  it("a skipped stop is stated plainly, never silently", () => {
    const s = playingSession();
    s.session.skippedNote = "One stop is resting in the archive now, so the tour passes it by — nothing is lost; the tour itself is unchanged.";
    mockUseTours.mockReturnValue(fakeTours({ session: s }));
    render(<ToursPanel enabled />);
    expect(screen.getByText(/resting in the archive/)).toBeTruthy();
  });

  it("deleting is two-step, and the tour can be brought back", () => {
    const remove = vi.fn(async () => null);
    const restore = vi.fn(async () => null);
    mockUseTours.mockReturnValue(fakeTours({ tours: [tour()], remove, restore }));
    render(<ToursPanel enabled />);
    fireEvent.click(screen.getByText("Delete"));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete this tour/)).toBeTruthy();
    fireEvent.click(screen.getByText("Delete", { selector: "button" }));
    expect(remove).toHaveBeenCalledWith("tour-1");
    expect(screen.getByText("Bring it back")).toBeTruthy();
    fireEvent.click(screen.getByText("Bring it back"));
    expect(restore).toHaveBeenCalledWith("tour-1");
  });

  it("the reduced-motion view carries the same stops and narration", () => {
    // The stop list is still text, always rendered — the flight is never
    // the only way to read the tour.
    mockUseTours.mockReturnValue(fakeTours({ session: playingSession() }));
    render(<ToursPanel enabled />);
    const list = screen.getByRole("list");
    expect(list.textContent).toMatch("Packing boxes");
    expect(list.textContent).toMatch("We packed in March.");
    expect(list.textContent).toMatch("The new flat");
    expect(list.textContent).toMatch("We moved in June.");
  });
});
