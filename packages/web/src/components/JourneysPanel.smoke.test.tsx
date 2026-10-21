import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import type { Journey } from "@brain/shared";

const getJourneys = vi.fn();
const createJourney = vi.fn();
const patchJourney = vi.fn();
const deleteJourney = vi.fn();
const journeyLinks = vi.fn();
vi.mock("../api/journeys.js", () => ({
  getJourneys: (...a: unknown[]) => getJourneys(...a),
  createJourney: (...a: unknown[]) => createJourney(...a),
  patchJourney: (...a: unknown[]) => patchJourney(...a),
  deleteJourney: (...a: unknown[]) => deleteJourney(...a),
  journeyLinks: (...a: unknown[]) => journeyLinks(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { JourneysPanel } from "./JourneysPanel.js";

// IM-87: journeyLinks returns a JourneyLinksDetail (display-capped links + true
// totals/counts), not a bare array.
const linksDetail = (links: unknown[], over: Record<string, unknown> = {}) => ({
  links, totalCount: links.length, earnedCents: 0, spentCents: 0, displayLimit: 20, unshownByKind: {}, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  // Sane default so opening a card never crashes a test that isn't specifically
  // exercising the links-loading behavior.
  journeyLinks.mockResolvedValue(linksDetail([]));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function journey(over: Partial<Journey>): Journey {
  return { id: 1, title: "Recover Financially", icon: "💵", status: "active", progress: 0.3, linkCount: 0, ...over } as Journey;
}

describe("JourneysPanel — Galaxy entity detail focus (Phase O)", () => {
  it("opens the matching card and scrolls to it when focusJourney targets it", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    getJourneys.mockResolvedValue([journey({ id: 1, title: "Recover Financially" }), journey({ id: 2, title: "Get Healthy" })]);

    render(<JourneysPanel focusJourney={{ id: 2, nonce: 1 }} />);

    // Opening shows the detail body (progress slider) without a manual click.
    await screen.findByText("Mark complete");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("re-fires on a repeat click on the same Journey (nonce bump)", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    getJourneys.mockResolvedValue([journey({ id: 1, title: "Recover Financially" })]);

    const { rerender } = render(<JourneysPanel focusJourney={{ id: 1, nonce: 1 }} />);
    await screen.findByText("Mark complete");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(<JourneysPanel focusJourney={{ id: 1, nonce: 2 }} />);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });
});

describe("JourneysPanel — loading trap", () => {
  it("shows a retry option instead of 'Loading' forever when the initial fetch fails", async () => {
    getJourneys.mockResolvedValue(null);
    render(<JourneysPanel />);
    await screen.findByText(/Couldn't load your Journeys/);
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("keeps the existing list instead of wiping it when a mutation's refresh fails", async () => {
    // First load succeeds; every call after that fails — reproducing "a blip
    // mid-session wipes the whole panel back to permanent loading."
    getJourneys.mockResolvedValueOnce([journey({ id: 1 })]).mockResolvedValue(null);
    patchJourney.mockResolvedValueOnce(journey({ id: 1, status: "done" }));

    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    const markComplete = await screen.findByText("Mark complete");
    await act(async () => { markComplete.click(); });

    // onChanged() -> refresh() -> getJourneys() resolves null this time.
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't refresh"), "⚠️", expect.any(Number)));
    expect(screen.queryByText(/Loading your journeys/)).toBeNull();
    expect(screen.getByText("Recover Financially")).toBeTruthy();
  });
});

describe("JourneysPanel — active-only suggestion gate", () => {
  it("shows starter suggestions when every Journey is completed, not just when there are zero ever", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, status: "done" })]);
    render(<JourneysPanel />);
    await screen.findByText("Start with one that fits your life right now:");
  });

  it("hides suggestions once at least one Journey is active", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, status: "active" })]);
    render(<JourneysPanel />);
    await screen.findByText("Recover Financially");
    expect(screen.queryByText("Start with one that fits your life right now:")).toBeNull();
  });
});

describe("JourneysPanel — progress slider debounce", () => {
  it("does not fire a PATCH per onChange tick, and saves only the settled value", async () => {
    vi.useFakeTimers();
    getJourneys.mockResolvedValue([journey({ id: 1, progress: 0.2 })]);
    patchJourney.mockResolvedValue(journey({ id: 1, progress: 0.75 }));

    render(<JourneysPanel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const head = screen.getByText("Recover Financially");
    act(() => head.click());

    const slider = screen.getByRole("progressbar") as HTMLInputElement;
    for (const v of [30, 45, 60, 75]) {
      act(() => {
        Object.defineProperty(slider, "value", { value: String(v), configurable: true });
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    expect(patchJourney).not.toHaveBeenCalled(); // still debouncing

    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(patchJourney).toHaveBeenCalledTimes(1);
    expect(patchJourney).toHaveBeenCalledWith(1, { progress: 0.75 });
  });
});

describe("JourneysPanel — links race guard", () => {
  it("ignores a stale journeyLinks response that resolves after the card is closed", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1 })]);
    let resolveLinks!: (v: unknown) => void;
    journeyLinks.mockReturnValueOnce(new Promise((r) => { resolveLinks = r; }));

    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click()); // open
    await screen.findByText("Loading what's linked…");
    act(() => head.click()); // close before the fetch resolves

    await act(async () => {
      resolveLinks(linksDetail([{ kind: "node", refId: 1, label: "should not appear" }]));
      await Promise.resolve();
    });
    expect(screen.queryByText("should not appear")).toBeNull();
  });

  it("shows a distinct error instead of spinning forever when the links fetch fails", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1 })]);
    journeyLinks.mockResolvedValueOnce(null);
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    await screen.findByText(/Couldn't load what's linked/);
  });
});

describe("JourneysPanel — an empty links list is no longer a dead end", () => {
  it("offers a way to capture a thought right from the empty-links hint", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1 })]);
    journeyLinks.mockResolvedValue(linksDetail([]));
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    const captureBtn = await screen.findByText("➕ Dump a thought to link here");
    act(() => captureBtn.click());
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "panel", value: "ingest" } }));
    window.removeEventListener("brain-toast-action", onAction);
  });
});

describe("JourneysPanel — IM-87 true totals + cap disclosure", () => {
  it("renders the server's totals over ALL links, not the sum of the shown rows, and discloses the cap", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, linkCount: 25 })]);
    // Only 2 rows are shown, worth $10 each — but the journey's true totals over
    // all 25 links are $150 earned / $70 spent. Pre-fix the panel summed the
    // shown rows and presented $20.00 as the journey's total.
    journeyLinks.mockResolvedValue(linksDetail(
      [
        { kind: "income", refId: 1, label: "Gig", amount: 1000 },
        { kind: "income", refId: 2, label: "Gig", amount: 1000 },
      ],
      { totalCount: 25, earnedCents: 15000, spentCents: 7000 },
    ));
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    await screen.findByText(/Showing 2 of 25 linked/);
    expect(screen.getByText(/\+\$150\.00 earned/)).toBeTruthy();
    expect(screen.getByText(/-\$70\.00 spent/)).toBeTruthy();
    expect(screen.queryByText(/\+\$20\.00 earned/)).toBeNull();
  });
});

describe("JourneysPanel — IM-86 header/detail never contradict", () => {
  it("a goal-only journey shows the goal in detail, agreeing with its '1 linked' header", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, linkCount: 1 })]);
    // The server hydrates goals (fin_goal name); the panel used to group only
    // node/insight/doc + money kinds, so this summary rendered NOTHING in detail.
    journeyLinks.mockResolvedValue(linksDetail([{ kind: "goal", refId: 9, label: "First Truck" }]));
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    expect(screen.getByText("1 linked")).toBeTruthy();
    act(() => head.click());
    await screen.findByText("First Truck");
    expect(screen.queryByText(/Nothing linked yet/)).toBeNull();
  });

  it("a task-only journey states the link truthfully instead of 'Nothing linked yet'", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, linkCount: 1 })]);
    // task has no source table to hydrate from — the server counts it in
    // unshownByKind instead of dropping it, and the panel must say so.
    journeyLinks.mockResolvedValue(linksDetail([], { totalCount: 1, unshownByKind: { task: 1 } }));
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    expect(screen.getByText("1 linked")).toBeTruthy();
    act(() => head.click());
    await screen.findByText(/Also linked but not shown in detail here: 1 task\./);
    expect(screen.queryByText(/Nothing linked yet/)).toBeNull();
  });
});

describe("JourneysPanel — linked recurring bills lead somewhere", () => {
  it("opens the Money tab when the recurring-bills note is clicked", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1 })]);
    journeyLinks.mockResolvedValue(linksDetail([{ kind: "bill", refId: 7, label: "Rent" }]));
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    const billsNote = await screen.findByText(/recurring bill/);
    act(() => billsNote.click());
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "tab", value: "money" } }));
    window.removeEventListener("brain-toast-action", onAction);
  });
});

describe("JourneysPanel — paused/done status is never opacity-alone", () => {
  it("shows a visible ⏸ Paused badge, not just a dimmer card", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, status: "paused" })]);
    render(<JourneysPanel />);
    await screen.findByText("Recover Financially");
    expect(screen.getByText("⏸ Paused")).toBeTruthy();
  });

  it("shows a visible ✓ Done badge for a completed journey", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, status: "done" })]);
    render(<JourneysPanel />);
    await screen.findByText("Recover Financially");
    expect(screen.getByText("✓ Done")).toBeTruthy();
  });
});

describe("JourneysPanel — marking a Journey complete is celebrated", () => {
  it("plays a milestone sound and toasts, not just a silent list re-sort", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, status: "active" })]);
    patchJourney.mockResolvedValue(journey({ id: 1, status: "done" }));
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    const markComplete = await screen.findByText("Mark complete");
    await act(async () => { markComplete.click(); });
    expect(playSfx).toHaveBeenCalledWith("milestone");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("complete"), "🧭", expect.any(Number));
  });
});

// Phase AC.1 (docs/specs/soumaya-connective-tissue-onboarding.md) — Journey -> Chat.
describe("JourneysPanel — Ask Soumaya about this Journey", () => {
  it("does not render the button when onAskJourney isn't provided", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1 })]);
    render(<JourneysPanel />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    expect(screen.queryByText(/Ask Soumaya/)).toBeNull();
  });

  it("calls onAskJourney with the id and title, not some other scoping mechanism", async () => {
    getJourneys.mockResolvedValue([journey({ id: 1, title: "Recover Financially" })]);
    const onAskJourney = vi.fn();
    render(<JourneysPanel onAskJourney={onAskJourney} />);
    const head = await screen.findByText("Recover Financially");
    act(() => head.click());
    const askBtn = await screen.findByText(/Ask Soumaya/);
    act(() => askBtn.click());
    expect(onAskJourney).toHaveBeenCalledWith({ id: 1, title: "Recover Financially" });
  });
});

describe("JourneysPanel — checked writes", () => {
  it("toasts and does not clear the form when creating a Journey fails", async () => {
    getJourneys.mockResolvedValue([]);
    createJourney.mockResolvedValue(null);
    render(<JourneysPanel />);
    await screen.findByText("Start with one that fits your life right now:");
    act(() => screen.getByText("💵 Recover Financially").click());
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't create"), "⚠️", expect.any(Number)));
  });
});
