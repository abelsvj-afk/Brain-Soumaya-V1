import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import type { BudgetSummary, WealthSummary } from "@brain/shared";

const getFinanceSummary = vi.fn();
const getWealthSummary = vi.fn();
const listPaystubs = vi.fn();
const getPaystub = vi.fn();
const extractPaystubText = vi.fn();
const confirmPaystub = vi.fn();
const listAssets = vi.fn();
const listAssetSnapshots = vi.fn();
const patchAsset = vi.fn();
const getIncomeTrend = vi.fn();
const getNetWorthTrend = vi.fn();
const listBills = vi.fn();
const createBill = vi.fn();
const patchBill = vi.fn();
const deleteBill = vi.fn();
const setBuffer = vi.fn();
const getAfford = vi.fn();
const addIncome = vi.fn();
const listIncome = vi.fn();
const listExpense = vi.fn();
const markOccurrencePaid = vi.fn();
const skipOccurrence = vi.fn();
const editIncome = vi.fn();
const deleteIncome = vi.fn();
const deleteExpense = vi.fn();
vi.mock("../api/finance.js", () => ({
  getFinanceSummary: (...a: unknown[]) => getFinanceSummary(...a),
  getWealthSummary: (...a: unknown[]) => getWealthSummary(...a),
  setBuffer: (...a: unknown[]) => setBuffer(...a),
  setBalance: vi.fn(),
  addIncome: (...a: unknown[]) => addIncome(...a), addExpense: vi.fn(),
  createBill: (...a: unknown[]) => createBill(...a),
  patchBill: (...a: unknown[]) => patchBill(...a),
  deleteBill: (...a: unknown[]) => deleteBill(...a),
  listBills: (...a: unknown[]) => listBills(...a),
  markOccurrencePaid: (...a: unknown[]) => markOccurrencePaid(...a),
  skipOccurrence: (...a: unknown[]) => skipOccurrence(...a),
  ingestPaste: vi.fn(), ingestImage: vi.fn(), confirmIngest: vi.fn(),
  listIncome: (...a: unknown[]) => listIncome(...a), listExpense: (...a: unknown[]) => listExpense(...a),
  editIncome: (...a: unknown[]) => editIncome(...a),
  deleteIncome: (...a: unknown[]) => deleteIncome(...a),
  editExpense: vi.fn(), deleteExpense: (...a: unknown[]) => deleteExpense(...a),
  getAfford: (...a: unknown[]) => getAfford(...a),
  createBucket: vi.fn(), patchBucket: vi.fn(), archiveBucket: vi.fn(),
  createGoal: vi.fn(), patchGoal: vi.fn(), archiveGoal: vi.fn(), listAllocations: vi.fn(), allocate: vi.fn(),
  // docs/specs/paystub-ingestion.md
  extractPaystubText: (...a: unknown[]) => extractPaystubText(...a),
  extractPaystubImage: vi.fn(),
  confirmPaystub: (...a: unknown[]) => confirmPaystub(...a),
  listPaystubs: (...a: unknown[]) => listPaystubs(...a),
  getPaystub: (...a: unknown[]) => getPaystub(...a),
  deletePaystub: vi.fn(),
  paystubSourceObjectUrl: vi.fn(),
  // docs/specs/income-net-worth-trend.md
  listAssets: (...a: unknown[]) => listAssets(...a),
  createAsset: vi.fn(), patchAsset: (...a: unknown[]) => patchAsset(...a), archiveAsset: vi.fn(),
  listAssetSnapshots: (...a: unknown[]) => listAssetSnapshots(...a), addAssetSnapshot: vi.fn(),
  getIncomeTrend: (...a: unknown[]) => getIncomeTrend(...a),
  getNetWorthTrend: (...a: unknown[]) => getNetWorthTrend(...a),
}));
const getCognitiveMind = vi.fn();
vi.mock("../api/mind.js", () => ({ getCognitive: (...a: unknown[]) => getCognitiveMind(...a) }));
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
  getFinanceSummary.mockResolvedValue({ budget: budget({}), account: { id: 1, name: "Cash", currency: "USD", balanceCents: 100000, bufferCents: 0, updatedAt: "x" }, upcoming: [], upcomingTotal: 0 });
  getWealthSummary.mockResolvedValue(wealth({}));
  listPaystubs.mockResolvedValue([]);
  getPaystub.mockResolvedValue(null);
  listAssets.mockResolvedValue([]);
  listAssetSnapshots.mockResolvedValue([]);
  getIncomeTrend.mockResolvedValue([]);
  getNetWorthTrend.mockResolvedValue([]);
  listBills.mockResolvedValue([]);
  listIncome.mockResolvedValue([]);
  listExpense.mockResolvedValue([]);
  getAfford.mockResolvedValue(null);
  getCognitiveMind.mockResolvedValue([]);
  markOccurrencePaid.mockResolvedValue({ ok: true, budget: budget({}) });
  skipOccurrence.mockResolvedValue({ ok: true, budget: budget({}) });
  addIncome.mockResolvedValue({ income: {}, duplicate: false, budget: budget({}) });
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
      upcoming: [], upcomingTotal: 0,
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

describe("FinancePanel — hero freshness + avg weekly income (IM-81)", () => {
  it("renders account name/currency/updatedAt and avgWeeklyIncomeCents", async () => {
    getFinanceSummary.mockResolvedValue({
      budget: budget({ avgWeeklyIncomeCents: 42000 }),
      account: { id: 1, name: "Everyday Checking", currency: "USD", balanceCents: 100000, bufferCents: 0, updatedAt: "2026-10-18T09:30:00" },
      upcoming: [], upcomingTotal: 0,
    });
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    expect(screen.getByText(/Everyday Checking · USD/)).toBeTruthy();
    expect(screen.getByText(/Updated Oct 18, 2026/)).toBeTruthy();
    expect(screen.getByText("Avg weekly income")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("$420")).toBeTruthy());
  });

  it("upcoming bills render a localized, relativized date — not the bare ISO string (IM-83)", async () => {
    getFinanceSummary.mockResolvedValue({
      budget: budget({}),
      account: { id: 1, name: "Cash", currency: "USD", balanceCents: 100000, bufferCents: 0, updatedAt: "x" },
      upcoming: [{ id: 9, billId: 3, name: "Rent", dueDate: "2027-01-05", amountCents: 120000, status: "upcoming" }], upcomingTotal: 1,
    });
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    // 2027-01-05 is a Tuesday.
    expect(screen.getByText(/Tue, Jan 5/)).toBeTruthy();
    expect(screen.queryByText("2027-01-05")).toBeNull();
  });
});

describe("FinancePanel — afford calculator explanation (IM-81)", () => {
  it("renders surplus + weekly bill load behind the weeks answer", async () => {
    getAfford.mockResolvedValue({ weeks: 3, surplusCents: 20000, weeklyBillLoadCents: 15000 });
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText(/What can I afford/));
    fireEvent.change(screen.getByLabelText("Target amount in dollars"), { target: { value: "400" } });
    await act(async () => { screen.getByText("Check").click(); });
    await screen.findByText(/~3 weeks/);
    expect(screen.getByText(/\$200\.00\/week of surplus after \$150\.00\/week of bills/)).toBeTruthy();
  });
});

describe("FinancePanel — BillManager full schema + edit (IM-80)", () => {
  const openBills = async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("Manage recurring bills"));
    await waitFor(() => expect(listBills).toHaveBeenCalled());
  };

  it("creates a custom bill WITH its interval and the rest of the schema", async () => {
    createBill.mockResolvedValue({});
    await openBills();
    fireEvent.change(screen.getByLabelText("Bill name"), { target: { value: "Gym" } });
    fireEvent.change(screen.getByLabelText("Bill amount in dollars"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Every how many days"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Bill category"), { target: { value: "health" } });
    fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "GymCo" } });
    fireEvent.click(screen.getByLabelText("Autopay"));
    await act(async () => { screen.getByText("Add bill").click(); });
    expect(createBill).toHaveBeenCalledWith(expect.objectContaining({
      name: "Gym", amountCents: 3000, frequency: "custom", everyDays: 10,
      category: "health", payee: "GymCo", autopay: true,
    }));
  });

  it("a custom bill with NO interval is not submitted (the interval defines it)", async () => {
    await openBills();
    fireEvent.change(screen.getByLabelText("Bill name"), { target: { value: "Gym" } });
    fireEvent.change(screen.getByLabelText("Bill amount in dollars"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "custom" } });
    await act(async () => { screen.getByText("Add bill").click(); });
    expect(createBill).not.toHaveBeenCalled();
  });

  it("edits an existing bill via patchBill and shows its stored fields on the row", async () => {
    listBills.mockResolvedValue([{
      id: 5, name: "Internet", amountCents: 8000, frequency: "monthly", anchorDate: "2026-01-15",
      autopay: true, category: "utilities", payee: "ISP Inc", graceDays: 5, lateFeeCents: 1000, accountLast4: "4321", active: true,
    }]);
    patchBill.mockResolvedValue({});
    await openBills();
    await screen.findByText("Internet");
    expect(screen.getByText(/autopay/)).toBeTruthy();
    expect(screen.getByText(/ISP Inc/)).toBeTruthy();
    expect(screen.getByText(/••4321/)).toBeTruthy();

    await act(async () => { screen.getByText("Edit").click(); });
    // The edit form lives inside the bill's <li>, BEFORE the create form in DOM order.
    const nameInputs = screen.getAllByLabelText("Bill name");
    fireEvent.change(nameInputs[0]!, { target: { value: "Fiber Internet" } });
    await act(async () => { screen.getByText("Save bill").click(); });
    expect(patchBill).toHaveBeenCalledWith(5, expect.objectContaining({ name: "Fiber Internet", amountCents: 8000 }));
  });
});

describe("FinancePanel — AssetManager snapshot history + edit (IM-79/IM-82)", () => {
  const openAssets = async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📈 Growth"));
    fireEvent.click(await screen.findByText(/Manage accounts/));
  };

  it("shows the current balance from the newest snapshot and the full history on demand", async () => {
    listAssets.mockResolvedValue([{ id: 7, kind: "savings", label: "Emergency fund", archived: false, createdAt: "x" }]);
    listAssetSnapshots.mockResolvedValue([
      { id: 2, assetId: 7, amountCents: 150000, asOf: "2026-10-01", createdAt: "x" },
      { id: 1, assetId: 7, amountCents: 100000, asOf: "2026-09-01", createdAt: "x" },
    ]);
    await openAssets();
    await screen.findByText(/Current balance/);
    expect(screen.getByText(/\$1,500\.00/)).toBeTruthy();
    expect(listAssetSnapshots).toHaveBeenCalledWith(7);

    await act(async () => { screen.getByText("History").click(); });
    expect(screen.getByText(/\$1,000\.00/)).toBeTruthy(); // the older snapshot is listed too
  });

  it("edits an asset's label/kind via patchAsset", async () => {
    listAssets.mockResolvedValue([{ id: 7, kind: "savings", label: "Emergency fund", archived: false, createdAt: "x" }]);
    patchAsset.mockResolvedValue({});
    await openAssets();
    await screen.findByText("Emergency fund");
    await act(async () => { screen.getByLabelText("Edit Emergency fund").click(); });
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Rainy day fund" } });
    await act(async () => { screen.getByText("Save account").click(); });
    expect(patchAsset).toHaveBeenCalledWith(7, { label: "Rainy day fund", kind: "savings" });
  });
});

describe("FinancePanel — History search/filter/totals + income detail (IM-82)", () => {
  const openHistory = async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText(/View \/ edit history/));
    await waitFor(() => expect(listIncome).toHaveBeenCalled());
  };

  it("shows monthly totals and filters rows by search", async () => {
    listIncome.mockResolvedValue([
      { id: 1, date: "2026-10-02", netCents: 90000, platform: "Acme", createdAt: "x" },
      { id: 2, date: "2026-09-01", netCents: 90000, platform: "Acme", createdAt: "x" },
    ]);
    listExpense.mockResolvedValue([
      { id: 3, date: "2026-10-03", amountCents: 12000, merchant: "Store", category: "food", direction: "out", createdAt: "x" },
    ]);
    await openHistory();
    await screen.findByText("Oct 2026");
    expect(screen.getByText(/net \$780\.00/)).toBeTruthy();
    expect(screen.getByText("Sep 2026")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search history"), { target: { value: "store" } });
    expect(screen.queryByText("Oct 2026")).toBeTruthy(); // October still has the Store row
    expect(screen.queryByText("Sep 2026")).toBeNull(); // September filtered out entirely
    fireEvent.change(screen.getByLabelText("Search history"), { target: { value: "zzz" } });
    await screen.findByText(/No transactions match those filters/);
  });

  it("captures gross/tax/hours when adding income manually", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("＋ Income"));
    fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "900" } });
    fireEvent.change(screen.getByLabelText("Gross pay"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Tax"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "40" } });
    await act(async () => { screen.getByText("Save").click(); });
    expect(addIncome).toHaveBeenCalledWith(expect.objectContaining({ netCents: 90000, grossCents: 120000, taxCents: 30000, hours: 40 }));
  });

  it("edits an income row's gross/tax/hours via editIncome", async () => {
    listIncome.mockResolvedValue([{ id: 1, date: "2026-10-02", netCents: 90000, platform: "Acme", createdAt: "x" }]);
    editIncome.mockResolvedValue({});
    await openHistory();
    await screen.findByText("Acme");
    await act(async () => { screen.getByLabelText("Edit").click(); });
    fireEvent.change(screen.getByLabelText("Gross pay"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "38" } });
    await act(async () => { screen.getByLabelText("Save").click(); });
    expect(editIncome).toHaveBeenCalledWith(1, expect.objectContaining({ grossCents: 120000, hours: 38 }));
  });
});

describe("FinancePanel — paystub detail via getPaystub (IM-82)", () => {
  it("opens the detail from the single-stub endpoint, not just the list row", async () => {
    listPaystubs.mockResolvedValue([{ id: 4, netCents: 90000, employer: "Acme", payDate: "2026-03-01", earnings: [], deductions: [], hasSource: false, createdAt: "x" }]);
    getPaystub.mockResolvedValue({ id: 4, netCents: 90000, grossCents: 120000, employer: "Acme Fresh", payDate: "2026-03-01", periodStart: "2026-02-16", periodEnd: "2026-02-28", earnings: [], deductions: [], hasSource: false, createdAt: "x" });
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📄 Pay Stubs"));
    const row = await screen.findByText(/Acme/);
    await act(async () => { row.click(); });
    await waitFor(() => expect(getPaystub).toHaveBeenCalledWith(4));
    await screen.findByText("Acme Fresh"); // the fresh single-stub read, not the stale list row
  });
});

describe("FinancePanel — load retry + confirmed deletes (IM-84)", () => {
  it("the load-error state has a Retry button that recovers the panel", async () => {
    getFinanceSummary
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ budget: budget({}), account: { id: 1, name: "Cash", currency: "USD", balanceCents: 100000, bufferCents: 0, updatedAt: "x" }, upcoming: [], upcomingTotal: 0 });
    render(<FinancePanel />);
    await screen.findByText(/Couldn't reach the budget/);
    await act(async () => { screen.getByText("Retry").click(); });
    await screen.findByText("Safe to Spend");
  });

  it("History delete asks first — deleteIncome fires only after confirming", async () => {
    listIncome.mockResolvedValue([{ id: 1, date: "2026-10-02", netCents: 90000, platform: "Acme", createdAt: "x" }]);
    deleteIncome.mockResolvedValue({});
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText(/View \/ edit history/));
    await screen.findByText("Acme");
    await act(async () => { screen.getByLabelText("Delete").click(); });
    await screen.findByText("Delete this transaction?");
    expect(deleteIncome).not.toHaveBeenCalled();
    await act(async () => { screen.getByText("Delete").click(); });
    expect(deleteIncome).toHaveBeenCalledWith(1);
  });

  it("BillManager remove asks first — deleteBill fires only after confirming", async () => {
    listBills.mockResolvedValue([{ id: 5, name: "Internet", amountCents: 8000, frequency: "monthly", anchorDate: "2026-01-15", autopay: false, category: "utilities", active: true }]);
    deleteBill.mockResolvedValue({});
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("Manage recurring bills"));
    await screen.findByText("Internet");
    await act(async () => { screen.getByText("Remove").click(); });
    await screen.findByText("Remove this bill?");
    expect(deleteBill).not.toHaveBeenCalled();
    // The dialog's confirm button is also labelled "Remove" — it's the last one in the DOM.
    const removes = screen.getAllByText("Remove");
    await act(async () => { removes[removes.length - 1]!.click(); });
    expect(deleteBill).toHaveBeenCalledWith(5);
  });
});

describe("FinancePanel — ADR-019 bill lifecycle (web half)", () => {
  const account = { id: 1, name: "Cash", currency: "USD", balanceCents: 100000, bufferCents: 0, updatedAt: "x" };
  const rentOccurrence = { id: 9, billId: 3, name: "Rent", dueDate: "2027-01-05", amountCents: 120000, status: "upcoming" as const };
  const withUpcoming = (upcomingTotal: number) =>
    getFinanceSummary.mockResolvedValue({ budget: budget({}), account, upcoming: [rentOccurrence], upcomingTotal });

  it("T14: states the truncation and the true count when Upcoming is display-limited", async () => {
    withUpcoming(48);
    render(<FinancePanel />);
    await screen.findByText("Rent");
    expect(screen.getByText(/Showing 1 of 48/)).toBeTruthy();
    expect(screen.getByText(/…and 47 more/)).toBeTruthy();
  });

  it("shows no truncation line when the whole Upcoming list is shown", async () => {
    withUpcoming(1);
    render(<FinancePanel />);
    await screen.findByText("Rent");
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("Skip calls skipOccurrence for that occurrence and refreshes (P4)", async () => {
    withUpcoming(1);
    render(<FinancePanel />);
    await screen.findByText("Rent");
    fireEvent.click(screen.getByText("Skip"));
    await waitFor(() => expect(skipOccurrence).toHaveBeenCalledWith(9));
    await waitFor(() => expect(getFinanceSummary).toHaveBeenCalledTimes(2));
  });

  it("Paid records a payment via markOccurrencePaid with no matched expense (P1)", async () => {
    withUpcoming(1);
    render(<FinancePanel />);
    await screen.findByText("Rent");
    fireEvent.click(screen.getByText("Paid"));
    await waitFor(() => expect(markOccurrencePaid).toHaveBeenCalledWith(9));
  });

  it("Match… lists recent expenses and choosing one matches it to the occurrence (P1)", async () => {
    listExpense.mockResolvedValue([
      { id: 31, date: "2026-10-19", amountCents: 120000, merchant: "Landlord LLC", category: "housing", direction: "out", createdAt: "x" },
      { id: 30, date: "2026-10-18", amountCents: 5000, merchant: "Store", category: "food", direction: "out", createdAt: "x" },
    ]);
    withUpcoming(1);
    render(<FinancePanel />);
    await screen.findByText("Rent");
    fireEvent.click(screen.getByText("Match…"));
    const option = await screen.findByText(/Landlord LLC/);
    expect(screen.getByText(/Store/)).toBeTruthy();
    fireEvent.click(option);
    await waitFor(() => expect(markOccurrencePaid).toHaveBeenCalledWith(9, 31));
  });

  it("Match surfaces the server's 409 already-linked error inline by the row", async () => {
    listExpense.mockResolvedValue([
      { id: 31, date: "2026-10-19", amountCents: 120000, merchant: "Landlord LLC", category: "housing", direction: "out", createdAt: "x" },
    ]);
    markOccurrencePaid.mockResolvedValue({ ok: false, error: "Expense is already linked to an occurrence" });
    withUpcoming(1);
    render(<FinancePanel />);
    await screen.findByText("Rent");
    fireEvent.click(screen.getByText("Match…"));
    fireEvent.click(await screen.findByText(/Landlord LLC/));
    await screen.findByText("Expense is already linked to an occurrence");
  });

  it("History tags an entry as scheduled only while its settlement marker is null (§3.6)", async () => {
    listIncome.mockResolvedValue([
      { id: 1, date: "2026-10-02", netCents: 90000, platform: "Acme", createdAt: "x", balanceAppliedAt: "2026-10-02T00:00:00Z" },
      { id: 2, date: "2026-11-02", netCents: 50000, platform: "Future Co", createdAt: "x", balanceAppliedAt: null },
    ]);
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText(/View \/ edit history/));
    await screen.findByText("Future Co");
    expect(screen.getAllByText("scheduled")).toHaveLength(1);
  });

  it("Add income shows the scheduled hint only when the chosen date is in the future (§3.6)", async () => {
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("＋ Income"));
    expect(screen.queryByText(/Scheduled — won't affect your balance until/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2999-01-01" } });
    await screen.findByText(/Scheduled — won't affect your balance until/);
  });

  it("the History edit form shows the scheduled hint for a future date (§3.6)", async () => {
    listIncome.mockResolvedValue([{ id: 1, date: "2026-10-02", netCents: 90000, platform: "Acme", createdAt: "x", balanceAppliedAt: "2026-10-02T00:00:00Z" }]);
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText(/View \/ edit history/));
    await screen.findByText("Acme");
    await act(async () => { screen.getByLabelText("Edit").click(); });
    expect(screen.queryByText(/Scheduled — won't affect your balance until/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2999-01-01" } });
    await screen.findByText(/Scheduled — won't affect your balance until/);
  });

  it("T4: the remove-bill dialog copy states the true effects", async () => {
    listBills.mockResolvedValue([{ id: 5, name: "Internet", amountCents: 8000, frequency: "monthly", anchorDate: "2026-01-15", autopay: false, active: true }]);
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("Manage recurring bills"));
    await screen.findByText("Internet");
    await act(async () => { screen.getByText("Remove").click(); });
    await screen.findByText(/cancels its future occurrences/);
    expect(screen.getByText(/Past-due unpaid occurrences stay listed and reserving until you resolve them/)).toBeTruthy();
    expect(screen.getByText(/payment history is kept/)).toBeTruthy();
  });

  it("the pay stub delete dialog states the income and balance effects (§3.5)", async () => {
    listPaystubs.mockResolvedValue([{ id: 4, netCents: 90000, employer: "Acme", payDate: "2026-03-01", earnings: [], deductions: [], hasSource: false, createdAt: "x" }]);
    getPaystub.mockResolvedValue({ id: 4, netCents: 90000, grossCents: 120000, employer: "Acme", payDate: "2026-03-01", earnings: [], deductions: [], hasSource: false, createdAt: "x" });
    render(<FinancePanel />);
    await screen.findByText("Safe to Spend");
    fireEvent.click(screen.getByText("📄 Pay Stubs"));
    const row = await screen.findByText(/Acme/);
    await act(async () => { row.click(); });
    await screen.findByText("Delete");
    await act(async () => { screen.getByText("Delete").click(); });
    await screen.findByText(/also removes the income it created/);
    expect(screen.getByText(/reverses that income's effect on your balance/)).toBeTruthy();
  });
});
