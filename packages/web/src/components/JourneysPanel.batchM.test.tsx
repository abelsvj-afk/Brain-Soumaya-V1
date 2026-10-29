import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import type { Journey } from "@brain/shared";

const getJourneys = vi.fn();
const getJourney = vi.fn();
const createJourney = vi.fn();
const patchJourney = vi.fn();
const deleteJourney = vi.fn();
const journeyLinks = vi.fn();
const linkToJourney = vi.fn();
vi.mock("../api/journeys.js", () => ({
  getJourneys: (...a: unknown[]) => getJourneys(...a),
  getJourney: (...a: unknown[]) => getJourney(...a),
  createJourney: (...a: unknown[]) => createJourney(...a),
  patchJourney: (...a: unknown[]) => patchJourney(...a),
  deleteJourney: (...a: unknown[]) => deleteJourney(...a),
  journeyLinks: (...a: unknown[]) => journeyLinks(...a),
  linkToJourney: (...a: unknown[]) => linkToJourney(...a),
  unlinkFromJourney: vi.fn(),
  journeysFor: vi.fn(),
  suggestJourneys: vi.fn(),
}));
vi.mock("../api/client.js", () => ({ getGraph: vi.fn().mockRejectedValue(new Error("offline")) }));
vi.mock("../api/finance.js", () => ({
  listIncome: vi.fn().mockResolvedValue(null),
  listExpense: vi.fn().mockResolvedValue(null),
  listBills: vi.fn().mockResolvedValue(null),
  getWealthSummary: vi.fn().mockResolvedValue(null),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { JourneysPanel } from "./JourneysPanel.js";

const linksDetail = (links: unknown[], over: Record<string, unknown> = {}) => ({
  links, totalCount: links.length, earnedCents: 0, spentCents: 0, displayLimit: 20, unshownByKind: {}, ...over,
});

function journey(over: Partial<Journey>): Journey {
  return { id: 1, title: "Become an RN", icon: "🩺", status: "active", progress: 0.5, linkCount: 0, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z", ...over } as Journey;
}

beforeEach(() => {
  vi.resetAllMocks();
  journeyLinks.mockResolvedValue(linksDetail([]));
  getJourney.mockImplementation(async (id: number) => {
    const list = (await getJourneys()) as Journey[] | null;
    const found = list?.find((x) => x.id === id);
    return found ? { ...found, links: [] } : null;
  });
  patchJourney.mockResolvedValue(null);
  createJourney.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openCard(title: string) {
  const head = await screen.findByText(title);
  act(() => head.click());
  await waitFor(() => expect(screen.getByText(/Last moved/)).toBeTruthy());
}

describe("REG-160 (JN-03) — the journey card displays its missions-completed count", () => {
  it("shows '3 missions completed' on the card so the bar's share is checkable", async () => {
    getJourneys.mockResolvedValue([journey({ missionsCompleted: 3 })]);
    render(<JourneysPanel />);
    await openCard("Become an RN");
    expect(screen.getByText(/3 missions completed/)).toBeTruthy();
  });
  it("shows nothing about missions when the server sent no count", async () => {
    getJourneys.mockResolvedValue([journey({ missionsCompleted: undefined })]);
    render(<JourneysPanel />);
    await openCard("Become an RN");
    expect(screen.queryByText(/missions completed/)).toBeNull();
  });
});

describe("REG-161 (JN-04) — the card's start line is the span start, or an honest 'Created'", () => {
  it("shows 'Started' from the explicit startedAt, plus the explicit end date", async () => {
    getJourneys.mockResolvedValue([journey({ startedAt: "2025-09-01", endedAt: "2029-05-15" })]);
    render(<JourneysPanel />);
    await openCard("Become an RN");
    expect(screen.getByText(/Started Sep 1, 2025/)).toBeTruthy();
    expect(screen.getByText(/Ends May 15, 2029/)).toBeTruthy();
  });
  it("labels the creation date 'Created', never 'Started', when no explicit span exists", async () => {
    getJourneys.mockResolvedValue([journey({})]);
    render(<JourneysPanel />);
    await openCard("Become an RN");
    // Zone-derived expectation (same treatment as the cl10 IM-88 test): the
    // noon-UTC fixture shifts a day at UTC+14, so compute it in the running zone.
    const created = new Date("2026-10-01T12:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    expect(screen.getByText(new RegExp(`Created ${created}`))).toBeTruthy();
    expect(screen.queryByText(/Started/)).toBeNull();
  });
  it("the create form collects span dates and passes them to createJourney", async () => {
    getJourneys.mockResolvedValue([journey({})]);
    createJourney.mockResolvedValue(journey({ id: 2, title: "New chapter" }));
    render(<JourneysPanel />);
    await screen.findByText("Become an RN");
    act(() => screen.getByText("＋ New Journey").click());
    fireEvent.change(screen.getByLabelText("Journey title"), { target: { value: "New chapter" } });
    fireEvent.change(screen.getByLabelText("Journey start date"), { target: { value: "2026-01-15" } });
    fireEvent.change(screen.getByLabelText("Journey end date"), { target: { value: "2026-12-31" } });
    await act(async () => { screen.getByText("Create").click(); });
    await waitFor(() => expect(createJourney).toHaveBeenCalledWith(expect.objectContaining({
      title: "New chapter",
      startedAt: "2026-01-15",
      endedAt: "2026-12-31",
    })));
  });
  it("the edit form saves span dates through patchJourney", async () => {
    const j = journey({ startedAt: "2025-09-01" });
    getJourneys.mockResolvedValue([j]);
    patchJourney.mockResolvedValue({ ...j, startedAt: "2025-08-15", endedAt: "2026-06-01" });
    render(<JourneysPanel />);
    await openCard("Become an RN");
    act(() => screen.getByText("✏️ Edit").click());
    const startInput = screen.getByLabelText("Journey start date") as HTMLInputElement;
    expect(startInput.value).toBe("2025-09-01");
    fireEvent.change(startInput, { target: { value: "2025-08-15" } });
    fireEvent.change(screen.getByLabelText("Journey end date"), { target: { value: "2026-06-01" } });
    await act(async () => { screen.getByText("Save changes").click(); });
    await waitFor(() => expect(patchJourney).toHaveBeenCalledWith(1, expect.objectContaining({
      startedAt: "2025-08-15",
      endedAt: "2026-06-01",
    })));
  });
});

describe("REG-165 (JN-08) — the no-match hint accounts for both sections", () => {
  it("does NOT print 'No journeys match' above matching completed journeys under filter Done", async () => {
    getJourneys.mockResolvedValue([
      journey({ id: 1, title: "Active one", status: "active" }),
      journey({ id: 2, title: "Done one", status: "done" }),
    ]);
    render(<JourneysPanel />);
    await screen.findByText("Active one");
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "done" } });
    // The matching completed journey renders (inside the Completed details).
    expect(screen.getByText("Done one")).toBeTruthy();
    expect(screen.queryByText(/No journeys match/)).toBeNull();
  });
  it("DOES print the hint when the filter matches nothing in either section", async () => {
    getJourneys.mockResolvedValue([
      journey({ id: 1, title: "Active one", status: "active" }),
      journey({ id: 2, title: "Done one", status: "done" }),
    ]);
    render(<JourneysPanel />);
    await screen.findByText("Active one");
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "paused" } });
    expect(screen.getByText(/No journeys match/)).toBeTruthy();
  });
  it("DOES print the hint when a search matches nothing in either section", async () => {
    getJourneys.mockResolvedValue([
      journey({ id: 1, title: "Active one", status: "active" }),
      journey({ id: 2, title: "Done one", status: "done" }),
    ]);
    render(<JourneysPanel />);
    await screen.findByText("Active one");
    fireEvent.change(screen.getByLabelText("Search journeys"), { target: { value: "zzz-no-match" } });
    expect(screen.getByText(/No journeys match/)).toBeTruthy();
  });
});
