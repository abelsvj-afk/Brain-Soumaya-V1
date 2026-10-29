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

/**
 * Batch R — REG-232, UI half (REG-040's shape, mirrored): the finance paste
 * box states its 20,000-character limit before submission — a live counter
 * under the textarea, with a plain warning past the cap.
 */

const box = () => screen.getByLabelText("Type or paste transactions") as HTMLTextAreaElement;

async function openPaste() {
  render(<FinancePanel />);
  await screen.findByText("Safe to Spend");
  fireEvent.click(screen.getByText("✍️ Type or paste transactions"));
  expect(await screen.findByLabelText("Type or paste transactions")).toBeTruthy();
}

describe("REG-232 — the finance paste box states its 20,000-character limit before submit", () => {
  it("shows a live character counter under the paste box", async () => {
    await openPaste();
    expect(screen.getByText(/0 \/ 20,000/)).toBeTruthy();
    fireEvent.change(box(), { target: { value: "hello" } });
    expect(screen.getByText(/5 \/ 20,000/)).toBeTruthy();
  });

  it("warns before submission when the text is over the cap", async () => {
    await openPaste();
    fireEvent.change(box(), { target: { value: "x".repeat(20_001) } });
    expect(screen.getByText(/over the 20,000-character limit/i)).toBeTruthy();
    expect(screen.getByText(/20,001 \/ 20,000/)).toBeTruthy();
  });
});
