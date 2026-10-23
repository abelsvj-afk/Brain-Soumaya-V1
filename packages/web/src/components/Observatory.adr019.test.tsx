import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

/**
 * ADR-019 §3.7 (OB-03) — the Observatory money glance must state the
 * truncation and the TRUE count. The finance summary's `upcoming` array
 * is display-capped at 20 by the API; `upcomingTotal` is the live total.
 * Mirrors Observatory.im125126.test.tsx's mocking of the finance summary.
 */

const getDigestResult = vi.fn();
const getConstellationsResult = vi.fn();
const getDueReviewsResult = vi.fn();
const getDailyContact = vi.fn();
const getFinanceSummary = vi.fn();
const getJourneys = vi.fn();
const pushToast = vi.fn();

vi.mock("../api/client.js", () => ({
  getDigestResult: (...a: unknown[]) => getDigestResult(...a),
  getConstellationsResult: (...a: unknown[]) => getConstellationsResult(...a),
  getDueReviewsResult: (...a: unknown[]) => getDueReviewsResult(...a),
  getDailyContact: (...a: unknown[]) => getDailyContact(...a),
  answerDailyContact: vi.fn().mockResolvedValue(null),
}));
vi.mock("../api/finance.js", () => ({
  getFinanceSummary: (...a: unknown[]) => getFinanceSummary(...a),
}));
vi.mock("../api/journeys.js", () => ({
  getJourneys: (...a: unknown[]) => getJourneys(...a),
}));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("./SoumayaEye.js", () => ({ SoumayaEye: () => null }));

import { Observatory } from "./Observatory.js";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  getDigestResult.mockResolvedValue({ ok: true, insights: [] });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getDueReviewsResult.mockResolvedValue({ ok: true, reviews: [] });
  getDailyContact.mockResolvedValue({
    date: "2026-10-20",
    question: null,
    discovery: null,
    foresight: null,
    answered: false,
  });
  getJourneys.mockResolvedValue([]);
});

function memory(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "a memory", type: "memory", content: "", ...over } as GraphNode;
}

function renderObs() {
  return render(
    <Observatory
      spaceName="You"
      memories={[memory({ id: 1, label: "a memory" })]}
      streak={0}
      fedToday={false}
      onCapture={vi.fn()}
      onFocus={vi.fn()}
      onOpenInsights={vi.fn()}
      onEnter={vi.fn()}
    />,
  );
}

function financeWithUpcoming(count: number, upcomingTotal: number) {
  const upcoming = Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    billId: 200 + i,
    name: `Bill ${i + 1}`,
    dueDate: "2026-11-01",
    amountCents: 1_000,
    status: "upcoming",
  }));
  getFinanceSummary.mockResolvedValue({
    budget: {
      balanceCents: 50_000,
      safeToSpendCents: 12_300,
      shortfallCents: 0,
      nextIncomeDate: "2026-11-03",
      weekEarnedCents: 0,
      reservedCents: 0,
      reserved: [],
    },
    account: {},
    upcoming,
    upcomingTotal,
  });
}

describe("ADR-019 §3.7 (OB-03) — Observatory money glance states the true count", () => {
  it("case A: upcoming capped at 20 with upcomingTotal 25 → renders '25 bills coming up' and '+22 more in Money'", async () => {
    financeWithUpcoming(20, 25);
    renderObs();
    expect(await screen.findByText(/25 bills coming up/)).toBeTruthy();
    expect(screen.getByText("+22 more in Money")).toBeTruthy();
    expect(screen.queryByText(/20 bills coming up/)).toBeNull();
    expect(screen.queryByText("+17 more in Money")).toBeNull();
  });

  it("case B (control): 15 items, total 15 → renders '15 bills coming up' and '+12 more in Money'", async () => {
    financeWithUpcoming(15, 15);
    renderObs();
    expect(await screen.findByText(/15 bills coming up/)).toBeTruthy();
    expect(screen.getByText("+12 more in Money")).toBeTruthy();
  });
});
