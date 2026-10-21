import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import type { BudgetSummary, WealthSummary } from "@brain/shared";

const getFinanceSummary = vi.fn();
const getWealthSummary = vi.fn();
const listPaystubs = vi.fn();
const extractPaystubText = vi.fn();
const confirmPaystub = vi.fn();
const listAssets = vi.fn();
const getIncomeTrend = vi.fn();
const getNetWorthTrend = vi.fn();
const listBills = vi.fn();
const setBuffer = vi.fn();
vi.mock("../api/finance.js", () => ({
  getFinanceSummary: (...a: unknown[]) => getFinanceSummary(...a),
  getWealthSummary: (...a: unknown[]) => getWealthSummary(...a),
  setBuffer: (...a: unknown[]) => setBuffer(...a),
  setBalance: vi.fn(), addIncome: vi.fn(), addExpense: vi.fn(), createBill: vi.fn(), deleteBill: vi.fn(),
  listBills: (...a: unknown[]) => listBills(...a),
  markOccurrencePaid: vi.fn(), ingestPaste: vi.fn(), ingestImage: vi.fn(), confirmIngest: vi.fn(),
  listIncome: vi.fn().mockResolvedValue([]), listExpense: vi.fn().mockResolvedValue([]),
  editIncome: vi.fn(), deleteIncome: vi.fn(), editExpense: vi.fn(), deleteExpense: vi.fn(),
  getAfford: vi.fn(),
  createBucket: vi.fn(), patchBucket: vi.fn(), archiveBucket: vi.fn(),
  createGoal: vi.fn(), archiveGoal: vi.fn(), listAllocations: vi.fn(), allocate: vi.fn(),
  // docs/specs/paystub-ingestion.md
  extractPaystubText: (...a: unknown[]) => extractPaystubText(...a),
  extractPaystubImage: vi.fn(),
  confirmPaystub: (...a: unknown[]) => confirmPaystub(...a),
  listPaystubs: (...a: unknown[]) => listPaystubs(...a),
  deletePaystub: vi.fn(),
  paystubSourceObjectUrl: vi.fn(),
  // docs/specs/income-net-worth-trend.md
  listAssets: (...a: unknown[]) => listAssets(...a),
  createAsset: vi.fn(), archiveAsset: vi.fn(),
  listAssetSnapshots: vi.fn().mockResolvedValue([]), addAssetSnapshot: vi.fn(),
  getIncomeTrend: (...a: unknown[]) => getIncomeTrend(...a),
  getNetWorthTrend: (...a: unknown[]) => getNetWorthTrend(...a),
}));
vi.mock("../api/journeys.js", () => ({
  getJourneys: vi.fn().mockResolvedValue([]),
  journeysFor: vi.fn().mockResolvedValue([]),
  suggestJourneys: vi.fn().mockResolvedValue({ autoLink: [], suggested: [] }),
  linkToJourney: vi.fn(), unlinkFromJourney: vi.fn(),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
vi.mock("../lib/extractFileText.js", () => ({ extractFileText: vi.fn() }));

import { FinancePanel } from "./FinancePanel.js";

function budget(over: Partial<BudgetSummary>): BudgetSummary {
  return {
    balanceCents: 100000, bufferCents: 0, reservedCents: 0, reserved: [], safeToSpendCents: 100000,
    shortfallCents: 0, weekEarnedCents: 0, nextIncomeDate: "2026-01-15", avgWeeklyIncomeCents: 0, ...over,
  };
}
function wealth(over: Partial<WealthSummary>): WealthSummary {
  return { buckets: [], goals: [], allocatedCents: 0, deployableCents: 0, reconciliation: "ok", ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  getFinanceSummary.mockResolvedValue({ budget: budget({}), account: { id: 1, name: "Cash", currency: "USD", balanceCents: 100000, bufferCents: 0, updatedAt: "x" }, upcoming: [] });
  getWealthSummary.mockResolvedValue(wealth({}));
  listPaystubs.mockResolvedValue([]);
  listAssets.mockResolvedValue([]);
  getIncomeTrend.mockResolvedValue([]);
  getNetWorthTrend.mockResolvedValue([]);
  listBills.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("FinancePanel — the earmarked hint is a separate question from Safe-to-Spend", () => {
  it("hides the hint when nothing is earmarked", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    await waitFor(() => expect(getWealthSummary).toHaveBeenCalled());
    expect(screen.queryByText(/earmarked toward goals/)).toBeNull();
  });

  it("shows the hint with the real earmarked figure once Wealth has allocations, and opens Wealth on click", async () => {
    getWealthSummary.mockResolvedValue(wealth({ allocatedCents: 15000 }));
    render(<FinancePanel />);
    const hint = await screen.findByText(/earmarked toward goals/);
    expect(hint.textContent).toContain("150.00");

    expect(screen.queryByText(/No buckets yet/)).toBeNull();
    fireEvent.click(hint);
    await screen.findByText(/No buckets yet/); // WealthPanel is now expanded and rendered
  });
});

describe("FinancePanel — Wealth section is collapsed by default", () => {
  it("only mounts WealthPanel once the '🧭 Wealth' header is opened", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    expect(screen.queryByText(/No buckets yet/)).toBeNull();

    fireEvent.click(screen.getByText("🧭 Wealth"));
    await screen.findByText(/No buckets yet/);
  });

  it("only shows the '⛶ Expand' button once Wealth is open, and it dispatches the fullscreen event", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    expect(screen.queryByTitle("Expand to full-screen")).toBeNull();

    fireEvent.click(screen.getByText("🧭 Wealth"));
    await screen.findByText(/No buckets yet/);

    const onExpand = vi.fn();
    window.addEventListener("brain-open-wealth-fullscreen", onExpand);
    fireEvent.click(screen.getByTitle("Expand to full-screen"));
    expect(onExpand).toHaveBeenCalled();
    window.removeEventListener("brain-open-wealth-fullscreen", onExpand);
  });

  it("collapses the embedded copy when Expand is clicked, so only one WealthPanel is ever mounted at a time (defect #3 regression)", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");

    fireEvent.click(screen.getByText("🧭 Wealth"));
    await screen.findByText(/No buckets yet/); // the embedded WealthPanel is mounted

    fireEvent.click(screen.getByTitle("Expand to full-screen"));
    // RightDock/FinancePanel stays mounted underneath App.tsx's fullscreen overlay (they're
    // independent conditions) — without collapsing here, this embedded copy would keep
    // running (its own fetch, its own brain-finance-changed listener) alongside the
    // fullscreen instance. Confirm it actually unmounts instead.
    expect(screen.queryByText(/No buckets yet/)).toBeNull();
    expect(screen.queryByTitle("Expand to full-screen")).toBeNull();
  });
});

describe("FinancePanel — Money's own expand button (docs/specs/paystub-ingestion.md §7)", () => {
  it("shows a distinctly-titled expand button and dispatches the finance fullscreen event", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    const onExpand = vi.fn();
    window.addEventListener("brain-open-finance-fullscreen", onExpand);
    fireEvent.click(screen.getByTitle("Expand Money to full-screen"));
    expect(onExpand).toHaveBeenCalled();
    window.removeEventListener("brain-open-finance-fullscreen", onExpand);
  });

  it("hides its own expand button when embedded={false} (the fullscreen instance)", async () => {
    render(<FinancePanel embedded={false} />);
    await screen.findByText("Safe to Spend");
    expect(screen.queryByTitle("Expand Money to full-screen")).toBeNull();
  });
});

describe("FinancePanel — Pay Stubs section (docs/specs/paystub-ingestion.md)", () => {
  it("lists saved pay stubs once opened, and not before", async () => {
    listPaystubs.mockResolvedValue([{ id: 1, netCents: 90000, grossCents: 120000, employer: "Acme", payDate: "2026-03-01", earnings: [], deductions: [], hasSource: false, createdAt: "x" }]);
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    expect(listPaystubs).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("📄 Pay Stubs"));
    await screen.findByText(/Acme/);
  });

  it("uploading a PDF runs it through extractFileText -> extractPaystubText and opens the confirm draft", async () => {
    const { extractFileText } = await import("../lib/extractFileText.js");
    (extractFileText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "Net Pay 900.00", name: "stub" });
    extractPaystubText.mockResolvedValue({ result: { netCents: 90000, earnings: [], deductions: [], confidence: 0.6 } });
    confirmPaystub.mockResolvedValue({
      data: {
        paystub: { id: 1, netCents: 90000, earnings: [], deductions: [], hasSource: false, createdAt: "x" },
        budget: { balanceCents: 90000, bufferCents: 0, reservedCents: 0, reserved: [], safeToSpendCents: 90000, shortfallCents: 0, weekEarnedCents: 90000, nextIncomeDate: "2026-04-01", avgWeeklyIncomeCents: 90000 },
      },
    });

    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📄 Pay Stubs"));
    await screen.findByText("📤 Upload a pay stub");

    const input = screen.getByText("📤 Upload a pay stub").closest("label")!.querySelector("input")!;
    const file = new File(["dummy"], "stub.pdf", { type: "application/pdf" });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });

    await screen.findByText("Review your pay stub — confirm to save");
    expect(extractPaystubText).toHaveBeenCalledWith("Net Pay 900.00");

    fireEvent.click(screen.getByText("Save pay stub"));
    await waitFor(() => expect(confirmPaystub).toHaveBeenCalled());
    expect((confirmPaystub.mock.calls[0]![0] as { netCents: number }).netCents).toBe(90000);
    // A successful save closes the draft back to the list view.
    await waitFor(() => expect(screen.queryByText("Review your pay stub — confirm to save")).toBeNull());
  });

  it("a failed save surfaces the server's real reason and keeps the draft open with the user's entry intact (real 'still isn't saving' bug: the draft used to be discarded on any failure)", async () => {
    const { extractFileText } = await import("../lib/extractFileText.js");
    (extractFileText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "Net Pay 900.00", name: "stub" });
    extractPaystubText.mockResolvedValue({ result: { netCents: 90000, earnings: [], deductions: [], confidence: 0.6 } });
    confirmPaystub.mockResolvedValue({ error: "Original file too large (max 4.0 MB)." });

    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📄 Pay Stubs"));
    await screen.findByText("📤 Upload a pay stub");

    const input = screen.getByText("📤 Upload a pay stub").closest("label")!.querySelector("input")!;
    const file = new File(["dummy"], "stub.pdf", { type: "application/pdf" });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    await screen.findByText("Review your pay stub — confirm to save");

    // Edit the employer field before saving — this must survive the failed save.
    const employerInput = screen.getByLabelText("Employer") as HTMLInputElement;
    fireEvent.change(employerInput, { target: { value: "Acme Trucking" } });

    fireEvent.click(screen.getByText("Save pay stub"));
    await screen.findByText(/Couldn't save — Original file too large/);
    // The draft is still open (not discarded) and the user's typed edit is still there.
    expect(screen.getByText("Review your pay stub — confirm to save")).toBeTruthy();
    expect((screen.getByLabelText("Employer") as HTMLInputElement).value).toBe("Acme Trucking");
  });

  it("a failed extraction leaves Net pay EMPTY, not a misleading pre-filled 0.00", async () => {
    const { extractFileText } = await import("../lib/extractFileText.js");
    (extractFileText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "unreadable garbage", name: "stub" });
    extractPaystubText.mockResolvedValue({ result: { netCents: 0, earnings: [], deductions: [], confidence: 0 } });

    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📄 Pay Stubs"));
    await screen.findByText("📤 Upload a pay stub");

    const input = screen.getByText("📤 Upload a pay stub").closest("label")!.querySelector("input")!;
    const file = new File(["dummy"], "stub.pdf", { type: "application/pdf" });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });

    await screen.findByText("Review your pay stub — confirm to save");
    const netInput = screen.getByLabelText("Net pay") as HTMLInputElement;
    expect(netInput.value).toBe(""); // NOT "0.00" — a visibly empty required field, not a fake value
  });

  it("clicking Save with no net pay shows a VISIBLE error instead of silently doing nothing", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📄 Pay Stubs"));
    await screen.findByText("📤 Upload a pay stub");

    const input = screen.getByText("📤 Upload a pay stub").closest("label")!.querySelector("input")!;
    // No mocked extraction result registered for this test, so extractFileText's mock
    // resolves undefined and the draft opens blank (net pay empty) — the same end state
    // as a failed extraction, reached a different way.
    const { extractFileText } = await import("../lib/extractFileText.js");
    (extractFileText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "", name: "stub" });
    extractPaystubText.mockResolvedValue({ result: { netCents: 0, earnings: [], deductions: [], confidence: 0 } });
    const file = new File(["dummy"], "stub.pdf", { type: "application/pdf" });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    await screen.findByText("Review your pay stub — confirm to save");

    fireEvent.click(screen.getByText("Save pay stub"));
    // The draft form stays open (nothing to save yet) AND the error is now visible in
    // that same view — previously this message was set but rendered only in the list
    // view the user had already navigated away from, so Save looked like a no-op.
    await screen.findByText("Net pay is required.");
    expect(confirmPaystub).not.toHaveBeenCalled();
    expect(screen.getByText("Review your pay stub — confirm to save")).toBeTruthy();
  });
});

// Phase AC.1 (docs/specs/soumaya-connective-tissue-onboarding.md) — Galaxy Bill click closes
// the one remaining dead end (Goal/Journey already had panel-focus; Bill only had toast+fly-to).
describe("FinancePanel — Galaxy entity detail focus for a Bill (Phase AC.1)", () => {
  it("force-opens 'Manage recurring bills' and scrolls to the matching bill when focusBill targets it", async () => {
    listBills.mockResolvedValue([
      { id: 1, name: "Rent", amountCents: 120000, frequency: "monthly", anchorDate: "2026-01-01", autopay: false },
      { id: 2, name: "Water", amountCents: 4000, frequency: "monthly", anchorDate: "2026-01-05", autopay: false },
    ]);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<FinancePanel focusBill={{ id: 2, nonce: 1 }} />);
    await screen.findByText("Safe to Spend");

    // "Manage recurring bills" is collapsed by default — this must open on its own.
    await screen.findByText("Water");
    expect(screen.getByText("Rent")).toBeTruthy();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("stays collapsed with no focusBill, same as before this phase", async () => {
    listBills.mockResolvedValue([{ id: 1, name: "Rent", amountCents: 120000, frequency: "monthly", anchorDate: "2026-01-01", autopay: false }]);
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    expect(screen.queryByText("Rent")).toBeNull();
    expect(listBills).not.toHaveBeenCalled();
  });
});

describe("FinancePanel — safety buffer (IM-78)", () => {
  it("renders bufferCents in the summary and explains its effect on Safe to Spend", async () => {
    getFinanceSummary.mockResolvedValue({
      budget: budget({ balanceCents: 100000, bufferCents: 2500, safeToSpendCents: 97500 }),
      account: { id: 1, name: "Cash", currency: "USD", balanceCents: 100000, bufferCents: 2500, updatedAt: "x" },
      upcoming: [],
    });
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    expect(screen.getByText("Safety buffer")).toBeTruthy();
    // The actual buffer figure is rendered (not just a label)…
    await waitFor(() => expect(screen.getByText("$25.00")).toBeTruthy());
    // …and the copy explains WHY the hero is lower than the balance.
    expect(screen.getByText(/balance minus bills reserved and this buffer/)).toBeTruthy();
  });

  it("the set-buffer control calls setBuffer with integer cents and confirms success", async () => {
    setBuffer.mockResolvedValue({ id: 1, bufferCents: 4000 });
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");

    fireEvent.click(screen.getByText("Set safety buffer"));
    fireEvent.change(screen.getByLabelText("Safety buffer in dollars"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("Save buffer"));

    await waitFor(() => expect(setBuffer).toHaveBeenCalledWith(4000));
    await screen.findByText("Safety buffer updated.");
  });

  it("surfaces a failure instead of silently closing when setBuffer fails", async () => {
    setBuffer.mockResolvedValue(null); // api/finance send() collapses a failed PUT to null
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");

    fireEvent.click(screen.getByText("Set safety buffer"));
    fireEvent.change(screen.getByLabelText("Safety buffer in dollars"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("Save buffer"));

    await screen.findByText(/Couldn't save the safety buffer/);
    expect(setBuffer).toHaveBeenCalledWith(4000);
    // The editor stays open so the user can retry — the value is not lost.
    expect((screen.getByLabelText("Safety buffer in dollars") as HTMLInputElement).value).toBe("40");
  });
});

describe("FinancePanel — Growth section (docs/specs/income-net-worth-trend.md)", () => {
  it("fetches income and net-worth trends only once opened", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    expect(getIncomeTrend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("📈 Growth"));
    await waitFor(() => expect(getIncomeTrend).toHaveBeenCalled());
    expect(getNetWorthTrend).toHaveBeenCalled();
  });

  it("toggles between Income and Net Worth without refetching", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📈 Growth"));
    await waitFor(() => expect(getIncomeTrend).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Net Worth"));
    fireEvent.click(screen.getByText("Income"));
    expect(getIncomeTrend).toHaveBeenCalledTimes(1);
  });

  it("shows the projected-cash note only when a net-worth point is flagged cashIsProjected", async () => {
    getNetWorthTrend.mockResolvedValue([{ asOf: "2026-03-31", totalCents: 1000, cashIsProjected: true }]);
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📈 Growth"));
    await waitFor(() => expect(getNetWorthTrend).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Net Worth"));
    await screen.findByText(/Dashed = projected/);
  });
});
