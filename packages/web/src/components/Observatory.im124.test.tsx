import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

/**
 * IM-124 — Observatory truthful loading/error states.
 *
 * Falsifiable contract:
 *  - ALL fetches fail  → the error treatment renders (naming every failed
 *    source, with a Retry), the loading skeleton is gone, and NO empty-state
 *    copy pretends the galaxy is simply empty.
 *  - Fetches succeed empty → the designed rendering is untouched: no error
 *    card, no skeleton, prop-derived cards present.
 *  - Retry re-invokes the failed fetch(es); a source that then succeeds
 *    renders its card and leaves the error treatment.
 *  - Fetches still in flight → the skeleton treatment shows, no error yet.
 *  - One source failing names only that source.
 *  - For the null-on-failure helpers (contact/finance/journeys), a resolved
 *    null is a failure, not an empty result.
 */

const getDigest = vi.fn();
const getConstellations = vi.fn();
const getDailyContact = vi.fn();
const answerDailyContact = vi.fn();
const getDueReviews = vi.fn();
const getFinanceSummary = vi.fn();
const getJourneys = vi.fn();

vi.mock("../api/client.js", () => ({
  getConstellations: (...a: unknown[]) => getConstellations(...a),
  getDigest: (...a: unknown[]) => getDigest(...a),
  getDailyContact: (...a: unknown[]) => getDailyContact(...a),
  answerDailyContact: (...a: unknown[]) => answerDailyContact(...a),
  getDueReviews: (...a: unknown[]) => getDueReviews(...a),
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
});

function memory(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "a memory", type: "memory", content: "", ...over } as GraphNode;
}

/** The server's real success-empty shapes (contact is an object, never null). */
function mockSucceedEmpty() {
  getDigest.mockResolvedValue([]);
  getConstellations.mockResolvedValue([]);
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
  getDueReviews.mockResolvedValue([]);
}

function mockAllReject() {
  const boom = () => Promise.reject(new Error("server down"));
  getDigest.mockImplementation(boom);
  getConstellations.mockImplementation(boom);
  getDailyContact.mockImplementation(boom);
  getFinanceSummary.mockImplementation(boom);
  getJourneys.mockImplementation(boom);
  getDueReviews.mockImplementation(boom);
}

function renderObs(memories: GraphNode[]) {
  return render(
    <Observatory
      spaceName="You"
      memories={memories}
      streak={0}
      fedToday={false}
      onCapture={vi.fn()}
      onFocus={vi.fn()}
      onOpenInsights={vi.fn()}
      onEnter={vi.fn()}
    />,
  );
}

describe("Observatory IM-124 — all fetches fail", () => {
  it("shows the error treatment naming all six sources, with Retry — not empty-state copy", async () => {
    mockAllReject();
    renderObs([memory({ id: 1, label: "a memory" })]);

    const heading = await screen.findByText("Couldn't load everything");
    expect(heading).toBeTruthy();
    const alert = heading.closest("[role='alert']")!;
    for (const label of [
      "her observations",
      "your constellations",
      "her daily question",
      "your money glance",
      "your journeys",
      "your recall pick",
    ]) {
      expect(alert.textContent).toContain(label);
    }
    expect(alert.textContent).toContain("not an empty galaxy");
    expect(screen.getByText("Retry")).toBeTruthy();
    // Not the empty state, and the loading skeleton has resolved away.
    expect(screen.queryByText(/Your galaxy is empty/)).toBeNull();
    expect(screen.queryByTestId("observatory-loading")).toBeNull();
  });

  it("still shows the error treatment on the empty-brain hero when fetches fail", async () => {
    mockAllReject();
    renderObs([]);
    expect(await screen.findByText("Couldn't load everything")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

describe("Observatory IM-124 — fetches succeed empty", () => {
  it("renders the designed screen with no error card and no skeleton", async () => {
    mockSucceedEmpty();
    renderObs([memory({ id: 1, label: "a memory" })]);

    // A prop-derived card proves the screen settled.
    expect(await screen.findByText("Today's tending")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("observatory-loading")).toBeNull());
    expect(screen.queryByText("Couldn't load everything")).toBeNull();
    expect(screen.queryByText("Retry")).toBeNull();
    // Genuinely-empty fetched sections render no cards, exactly as designed.
    expect(screen.queryByText("Your constellations")).toBeNull();
    expect(screen.queryByText("Worth a moment")).toBeNull();
    expect(screen.queryByText("Safe to spend")).toBeNull();
    expect(screen.queryByText("Your journeys")).toBeNull();
  });

  it("renders the designed empty-brain hero when there are no memories and fetches succeed empty", async () => {
    mockSucceedEmpty();
    renderObs([]);
    expect(await screen.findByText(/Your galaxy is empty/)).toBeTruthy();
    await waitFor(() => expect(getDigest).toHaveBeenCalled());
    expect(screen.queryByText("Couldn't load everything")).toBeNull();
  });
});

describe("Observatory IM-124 — loading and retry", () => {
  it("shows the skeleton treatment while fetches are in flight, and no error", async () => {
    const pending = () => new Promise(() => {});
    getDigest.mockImplementation(pending);
    getConstellations.mockImplementation(pending);
    getDailyContact.mockImplementation(pending);
    getFinanceSummary.mockImplementation(pending);
    getJourneys.mockImplementation(pending);
    getDueReviews.mockImplementation(pending);
    renderObs([memory({ id: 1, label: "a memory" })]);

    expect(await screen.findByTestId("observatory-loading")).toBeTruthy();
    expect(screen.getByText("Gathering your arrival briefing…")).toBeTruthy();
    expect(screen.queryByText("Couldn't load everything")).toBeNull();
  });

  it("Retry re-invokes the failed fetches; a source that then succeeds renders its card", async () => {
    mockSucceedEmpty();
    // First attempt: every fetch rejects. Second attempt (Retry): the
    // succeed-empty shapes above take over, and contact brings a question.
    for (const fn of [getDigest, getConstellations, getFinanceSummary, getJourneys, getDueReviews]) {
      const ok = fn.getMockImplementation()!;
      fn.mockReset();
      fn.mockRejectedValueOnce(new Error("server down")).mockImplementation(ok);
    }
    const okContact = getDailyContact.getMockImplementation()!;
    getDailyContact.mockReset();
    getDailyContact
      .mockRejectedValueOnce(new Error("server down"))
      .mockImplementation(okContact)
      .mockResolvedValue({
        date: "2026-10-20",
        question: { text: "What changed?", nodeId: null, nodeLabel: null, source: "cooling" },
        discovery: null,
        foresight: null,
        answered: false,
      });

    renderObs([memory({ id: 1, label: "a memory" })]);
    expect(await screen.findByText("Couldn't load everything")).toBeTruthy();
    expect(getDigest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Retry"));

    // The retried contact fetch's card renders; the error treatment clears.
    expect(await screen.findByText(/She has a question for you/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Couldn't load everything")).toBeNull());
    expect(getDigest).toHaveBeenCalledTimes(2);
    expect(getConstellations).toHaveBeenCalledTimes(2);
    expect(getDailyContact).toHaveBeenCalledTimes(2);
    expect(getFinanceSummary).toHaveBeenCalledTimes(2);
    expect(getJourneys).toHaveBeenCalledTimes(2);
    expect(getDueReviews).toHaveBeenCalledTimes(2);
  });
});

describe("Observatory IM-124 — per-source distinction", () => {
  it("names only the failed source when a single fetch fails", async () => {
    mockSucceedEmpty();
    getFinanceSummary.mockReset();
    getFinanceSummary.mockRejectedValue(new Error("server down"));
    renderObs([memory({ id: 1, label: "a memory" })]);

    const heading = await screen.findByText("Couldn't load everything");
    const alert = heading.closest("[role='alert']")!;
    expect(alert.textContent).toContain("your money glance");
    expect(alert.textContent).not.toContain("her daily question");
    expect(alert.textContent).not.toContain("your journeys");
  });

  it("treats a resolved null from the null-on-failure helpers as failure, not empty", async () => {
    mockSucceedEmpty();
    getDailyContact.mockReset().mockResolvedValue(null);
    getFinanceSummary.mockReset().mockResolvedValue(null);
    getJourneys.mockReset().mockResolvedValue(null);
    renderObs([memory({ id: 1, label: "a memory" })]);

    const heading = await screen.findByText("Couldn't load everything");
    const alert = heading.closest("[role='alert']")!;
    expect(alert.textContent).toContain("her daily question");
    expect(alert.textContent).toContain("your money glance");
    expect(alert.textContent).toContain("your journeys");
    expect(alert.textContent).not.toContain("her observations");
  });
});
