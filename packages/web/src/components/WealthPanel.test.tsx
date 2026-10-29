import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import type { WealthSummary, FinBucket, FinGoal, FinAllocation } from "@brain/shared";

const getWealthSummary = vi.fn();
const createBucket = vi.fn();
const patchBucket = vi.fn();
const archiveBucket = vi.fn();
const createGoal = vi.fn();
const patchGoal = vi.fn();
const archiveGoal = vi.fn();
const listAllocations = vi.fn();
const allocate = vi.fn();
const getCognitive = vi.fn();
vi.mock("../api/finance.js", () => ({
  getWealthSummary: (...a: unknown[]) => getWealthSummary(...a),
  createBucket: (...a: unknown[]) => createBucket(...a),
  patchBucket: (...a: unknown[]) => patchBucket(...a),
  archiveBucket: (...a: unknown[]) => archiveBucket(...a),
  createGoal: (...a: unknown[]) => createGoal(...a),
  patchGoal: (...a: unknown[]) => patchGoal(...a),
  archiveGoal: (...a: unknown[]) => archiveGoal(...a),
  listAllocations: (...a: unknown[]) => listAllocations(...a),
  allocate: (...a: unknown[]) => allocate(...a),
}));
vi.mock("../api/mind.js", () => ({
  getCognitive: (...a: unknown[]) => getCognitive(...a),
}));
vi.mock("../api/journeys.js", () => ({
  getJourneys: vi.fn().mockResolvedValue([]),
  journeysFor: vi.fn().mockResolvedValue([]),
  suggestJourneys: vi.fn().mockResolvedValue({ autoLink: [], suggested: [] }),
  linkToJourney: vi.fn(), unlinkFromJourney: vi.fn(),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { WealthPanel } from "./WealthPanel.js";

function bucket(over: Partial<FinBucket>): FinBucket {
  return { id: 1, name: "Trucking", category: "business", archived: false, createdAt: "2026-01-01", ...over };
}
function goal(over: Partial<FinGoal & { totalCents: number; fillPct: number | null; state: "goal_filling" | "goal_reached" }>): any {
  return {
    id: 1, bucketId: 1, name: "First Truck", targetCents: 100000, targetDate: null, archived: false,
    createdAt: "2026-01-01", totalCents: 0, fillPct: 0, state: "goal_filling", ...over,
  };
}
function summary(over: Partial<WealthSummary>): WealthSummary {
  return { buckets: [], goals: [], allocatedCents: 0, deployableCents: 0, reconciliation: "ok", ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  getCognitive.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("WealthPanel — Galaxy entity detail focus (Phase O)", () => {
  it("auto-expands the goal's bucket and scrolls to its card when focusGoal targets it", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const g = goal({ id: 7, bucketId: 2, name: "House down payment" });
    getWealthSummary.mockResolvedValue(
      summary({ buckets: [bucket({ id: 1, name: "Trucking" }), bucket({ id: 2, name: "House" })], goals: [g] }),
    );

    render(<WealthPanel focusGoal={{ id: 7, nonce: 1 }} />);

    // The bucket the goal lives in ("House") should auto-expand without a click —
    // the goal card becomes visible on its own.
    await screen.findByText("House down payment");
    // The scroll runs in a later effect than the card's first paint, so wait
    // for it — asserting right after the text appears raced under load.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("re-fires on a repeat click on the same goal (nonce bump), even with the bucket already open", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const g = goal({ id: 7, bucketId: 1, name: "First Truck" });
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({ id: 1 })], goals: [g] }));

    const { rerender } = render(<WealthPanel focusGoal={{ id: 7, nonce: 1 }} />);
    await screen.findByText("First Truck");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    rerender(<WealthPanel focusGoal={{ id: 7, nonce: 2 }} />);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });
});

describe("WealthPanel — empty state", () => {
  it("shows a nudge to start a bucket when there are none", async () => {
    getWealthSummary.mockResolvedValue(summary({}));
    render(<WealthPanel />);
    await screen.findByText(/No buckets yet/);
  });
});

describe("WealthPanel — creating a bucket", () => {
  it("calls createBucket with the typed name and refreshes", async () => {
    getWealthSummary.mockResolvedValue(summary({}));
    createBucket.mockResolvedValue(bucket({}));
    render(<WealthPanel />);
    await screen.findByText(/No buckets yet/);

    const input = screen.getByPlaceholderText(/New bucket name/);
    fireEvent.change(input, { target: { value: "Trucking" } });
    const btn = screen.getByText("➕ New bucket");
    await act(async () => { btn.click(); });
    expect(createBucket).toHaveBeenCalledWith({ name: "Trucking" });
    expect(getWealthSummary).toHaveBeenCalledTimes(2); // initial + post-create refresh
  });
});

describe("WealthPanel — a goal shows progress and can be allocated to", () => {
  it("renders a fill bar reflecting fillPct and updates after an allocation", async () => {
    const g = goal({ totalCents: 25000, fillPct: 0.25 });
    getWealthSummary
      .mockResolvedValueOnce(summary({ buckets: [bucket({})], goals: [g], allocatedCents: 25000, deployableCents: 100000 }))
      .mockResolvedValue(summary({ buckets: [bucket({})], goals: [{ ...g, totalCents: 30000, fillPct: 0.3 }], allocatedCents: 30000, deployableCents: 95000 }));
    allocate.mockResolvedValue({ allocation: { id: 1, goalId: 1, amountCents: 5000, note: null, createdAt: "x" } as FinAllocation, wealth: summary({}) });

    render(<WealthPanel />);
    const bucketHead = await screen.findByText("Trucking");
    fireEvent.click(bucketHead);
    await screen.findByText("First Truck");

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar.getAttribute("aria-valuenow")).toBe("25");

    const amountInput = screen.getByPlaceholderText("Amount $");
    fireEvent.change(amountInput, { target: { value: "50" } });
    const allocateBtn = screen.getByText("+ Allocate");
    await act(async () => { allocateBtn.click(); });
    expect(allocate).toHaveBeenCalledWith(1, 5000);
  });
});

describe("WealthPanel — point-of-action warning (IM-84: shared ConfirmDialog, not native confirm())", () => {
  it("asks for confirmation before allocating past Deployable, and proceeds only if confirmed", async () => {
    const g = goal({ totalCents: 0, fillPct: 0 });
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [g], allocatedCents: 0, deployableCents: 1000 })); // $10 deployable
    allocate.mockResolvedValue({ allocation: {} as FinAllocation, wealth: summary({}) });

    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));
    await screen.findByText("First Truck");

    fireEvent.change(screen.getByPlaceholderText("Amount $"), { target: { value: "50" } }); // $50 > $10 deployable
    await act(async () => { screen.getByText("+ Allocate").click(); });
    // The in-app dialog carries the warning — no native confirm() involved.
    await screen.findByText(/past what's currently deployable/);
    expect(allocate).not.toHaveBeenCalled(); // dialog open — write hasn't happened

    await act(async () => { screen.getByText("Cancel").click(); });
    expect(allocate).not.toHaveBeenCalled(); // cancelled — write never happens

    await act(async () => { screen.getByText("+ Allocate").click(); });
    await act(async () => { screen.getByText("Allocate anyway").click(); });
    expect(allocate).toHaveBeenCalledWith(1, 5000);
  });

  it("never warns for a withdrawal, since withdrawing only increases Deployable", async () => {
    const g = goal({ totalCents: 50000, fillPct: 0.5 });
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [g], allocatedCents: 50000, deployableCents: 0 }));
    allocate.mockResolvedValue({ allocation: {} as FinAllocation, wealth: summary({}) });

    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));
    await screen.findByText("First Truck");
    fireEvent.change(screen.getByPlaceholderText("Amount $"), { target: { value: "50" } });
    await act(async () => { screen.getByText("− Withdraw").click(); });
    expect(screen.queryByText(/past what's currently deployable/)).toBeNull();
    expect(allocate).toHaveBeenCalledWith(1, -5000);
  });
});

describe("WealthPanel — a rejected withdrawal surfaces an error, not a silent no-op (IM-84: inline, not alert())", () => {
  it("shows an inline error when allocate() returns null (server rejected an over-withdrawal)", async () => {
    const g = goal({ totalCents: 10000, fillPct: 0.1 });
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [g] }));
    allocate.mockResolvedValue(null);

    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));
    await screen.findByText("First Truck");
    fireEvent.change(screen.getByPlaceholderText("Amount $"), { target: { value: "500" } });
    await act(async () => { screen.getByText("− Withdraw").click(); });
    const err = await screen.findByRole("alert");
    expect(err.textContent).toContain("below zero");
  });
});

describe("WealthPanel — bucket category + edit (IM-82/IM-84)", () => {
  it("creates a bucket WITH its category when one is typed", async () => {
    getWealthSummary.mockResolvedValue(summary({}));
    createBucket.mockResolvedValue(bucket({}));
    render(<WealthPanel />);
    await screen.findByText(/No buckets yet/);

    fireEvent.change(screen.getByPlaceholderText(/New bucket name/), { target: { value: "Safety" } });
    fireEvent.change(screen.getByLabelText("New bucket category"), { target: { value: "emergency" } });
    await act(async () => { screen.getByText("➕ New bucket").click(); });
    expect(createBucket).toHaveBeenCalledWith({ name: "Safety", category: "emergency" });
  });

  it("edits a bucket's name + category inline via patchBucket — no native prompt()", async () => {
    const promptSpy = vi.fn();
    (window as unknown as { prompt: typeof promptSpy }).prompt = promptSpy;
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [] }));
    patchBucket.mockResolvedValue(bucket({ name: "Trucking Co", category: "fleet" }));
    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));

    await act(async () => { screen.getByText("✏️ Edit").click(); });
    fireEvent.change(screen.getByLabelText("Bucket name"), { target: { value: "Trucking Co" } });
    fireEvent.change(screen.getByLabelText("Bucket category"), { target: { value: "fleet" } });
    await act(async () => { screen.getByText("Save bucket").click(); });
    expect(promptSpy).not.toHaveBeenCalled();
    expect(patchBucket).toHaveBeenCalledWith(1, { name: "Trucking Co", category: "fleet" });
  });

  it("archives a bucket only after the shared ConfirmDialog is confirmed", async () => {
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [] }));
    archiveBucket.mockResolvedValue({ ok: true });
    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));

    await act(async () => { screen.getByText("📥 Archive").click(); });
    await screen.findByText(/Its goals stay, just tucked away/);
    expect(archiveBucket).not.toHaveBeenCalled();
    await act(async () => { screen.getByText("Archive").click(); });
    expect(archiveBucket).toHaveBeenCalledWith(1);
  });
});

describe("WealthPanel — goal create/edit with date + Vision (IM-82)", () => {
  it("creates a goal with a target date and a Life Vision link", async () => {
    getCognitive.mockResolvedValue([{ id: 42, kind: "life_vision", label: "Own a home", content: "", progress: null, completedAt: null, degree: 0, aliases: [], createdAt: "x", remindAt: null }]);
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [] }));
    createGoal.mockResolvedValue(goal({}));
    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));

    fireEvent.change(screen.getByPlaceholderText(/New goal/), { target: { value: "Down payment" } });
    fireEvent.change(screen.getByLabelText("Goal target date"), { target: { value: "2027-06-01" } });
    fireEvent.change(await screen.findByLabelText("Life Vision"), { target: { value: "42" } });
    await act(async () => { screen.getByText("➕ Add goal").click(); });
    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({ bucketId: 1, name: "Down payment", targetDate: "2027-06-01", visionNodeId: 42 }));
  });

  it("edits an existing goal's name/target/date/Vision via patchGoal", async () => {
    getCognitive.mockResolvedValue([{ id: 42, kind: "life_vision", label: "Own a home", content: "", progress: null, completedAt: null, degree: 0, aliases: [], createdAt: "x", remindAt: null }]);
    const g = goal({});
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [g] }));
    patchGoal.mockResolvedValue({ ...g, name: "First Truck XL" });
    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));
    await screen.findByText("First Truck");

    // Two "✏️ Edit" buttons exist (goal card + bucket actions) — the goal's renders first.
    const edits = screen.getAllByText("✏️ Edit");
    await act(async () => { edits[0]!.click(); });
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "First Truck XL" } });
    // Two date inputs + two Vision selects exist (goal edit form + new-goal form);
    // the GoalCard (and its edit form) renders BEFORE the new-goal form in the bucket body.
    const dateInputs = screen.getAllByLabelText("Goal target date");
    fireEvent.change(dateInputs[0]!, { target: { value: "2027-01-15" } });
    const visionSelects = await screen.findAllByLabelText("Life Vision");
    fireEvent.change(visionSelects[0]!, { target: { value: "42" } });
    await act(async () => { screen.getByText("Save goal").click(); });
    expect(patchGoal).toHaveBeenCalledWith(1, expect.objectContaining({ name: "First Truck XL", targetDate: "2027-01-15", visionNodeId: 42 }));
  });

  it("shows the linked Vision's label on the goal card", async () => {
    getCognitive.mockResolvedValue([{ id: 42, kind: "life_vision", label: "Own a home", content: "", progress: null, completedAt: null, degree: 0, aliases: [], createdAt: "x", remindAt: null }]);
    const g = goal({ visionNodeId: 42 });
    getWealthSummary.mockResolvedValue(summary({ buckets: [bucket({})], goals: [g] }));
    render(<WealthPanel />);
    fireEvent.click(await screen.findByText("Trucking"));
    // The label shows on the goal card (🌅 line) AND in the vision picker options.
    const matches = await screen.findAllByText(/Own a home/);
    expect(matches.some((el) => el.textContent?.includes("🌅"))).toBe(true);
  });
});

describe("WealthPanel — load error retry + Deployable motion (IM-84)", () => {
  it("offers Retry on the load-error state and recovers when it succeeds", async () => {
    getWealthSummary.mockResolvedValueOnce(null).mockResolvedValue(summary({ deployableCents: 5000 }));
    render(<WealthPanel />);
    await screen.findByText(/Couldn't reach Wealth/);
    await act(async () => { screen.getByText("Retry").click(); });
    await screen.findByText("Deployable");
    // IM-84: Deployable now counts up via the shared useCountUp hook (same motion
    // standard as the Money hero) — wait for the animation to land on the figure.
    await waitFor(() => expect(screen.getByText("$50.00")).toBeTruthy());
  });
});

describe("WealthPanel — reconciliation banner", () => {
  it("shows the over_committed warning with a plain, factual message", async () => {
    getWealthSummary.mockResolvedValue(summary({ deployableCents: -3000, reconciliation: "over_committed" }));
    render(<WealthPanel />);
    await screen.findByText(/Your current financial position is below/);
  });

  it("does not show the warning when reconciliation is ok", async () => {
    getWealthSummary.mockResolvedValue(summary({ deployableCents: 5000, reconciliation: "ok" }));
    render(<WealthPanel />);
    await waitFor(() => expect(getWealthSummary).toHaveBeenCalled());
    expect(screen.queryByText(/Your current financial position is below/)).toBeNull();
  });
});
