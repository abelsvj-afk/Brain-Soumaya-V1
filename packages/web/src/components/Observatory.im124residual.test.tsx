import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

/**
 * IM-124 RESIDUAL — the lone-failure collapse. With the legacy fail-soft
 * helpers, a dead /api/digest resolved `[]` — indistinguishable from a
 * genuinely empty digest — so the IM-124 error treatment could never fire
 * for the digest/constellations/reviews sources in production (it only
 * fired in tests whose mocks REJECTED, which the real helpers never do).
 *
 * Here the strict Result variants resolve `{ ok: false }` WITHOUT rejecting
 * — the real failure shape — and the Observatory must surface the error
 * naming exactly the failed sources, while healthy sources render as
 * genuinely empty (no error).
 *
 * Falsification: on the pre-change Observatory (which consumed the
 * fail-soft helpers and resolved []), no error card appears and these
 * assertions fail.
 */

const getDigestResult = vi.fn();
const getConstellationsResult = vi.fn();
const getDueReviewsResult = vi.fn();
const getDailyContact = vi.fn();
const getFinanceSummary = vi.fn();
const getJourneys = vi.fn();

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
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
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
  getFinanceSummary.mockResolvedValue({
    budget: { balanceCents: 0, safeToSpendCents: 0, shortfallCents: 0, nextIncomeDate: "" },
    upcoming: [],
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

describe("Observatory IM-124 residual — resolved-but-failed fetches surface honestly", () => {
  it("a lone digest failure ({ ok: false }, no rejection) names only 'her observations'", async () => {
    getDigestResult.mockResolvedValue({ ok: false });
    renderObs();
    const heading = await screen.findByText("Couldn't load everything");
    const alert = heading.closest("[role='alert']")!;
    expect(alert.textContent).toContain("her observations");
    expect(alert.textContent).not.toContain("your constellations");
    expect(alert.textContent).not.toContain("your recall pick");
  });

  it("constellations + reviews failing together name both, and no others", async () => {
    getConstellationsResult.mockResolvedValue({ ok: false });
    getDueReviewsResult.mockResolvedValue({ ok: false });
    renderObs();
    const heading = await screen.findByText("Couldn't load everything");
    const alert = heading.closest("[role='alert']")!;
    expect(alert.textContent).toContain("your constellations");
    expect(alert.textContent).toContain("your recall pick");
    expect(alert.textContent).not.toContain("her observations");
  });

  it("all three succeeding EMPTY renders no error card — true empty stays silent", async () => {
    renderObs();
    // Give every loader a chance to settle, then assert no error treatment.
    await screen.findByText("Welcome back, You.");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Couldn't load everything")).toBeNull();
  });
});
