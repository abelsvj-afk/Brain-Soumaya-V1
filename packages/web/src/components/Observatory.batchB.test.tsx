import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader HudDock.geometry.test.tsx uses. */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}
import type { GraphNode } from "@brain/shared";

/**
 * Batch B — Observatory items:
 *  OB-01 the Daily Contact send button has a name (visible caption +
 *        aria-label) and meets the 46px touch standard;
 *  OB-04 the money glance shows exact cents (formatCents), never rounded up;
 *  OB-06 a verified answer notifies App (onAnswered) so sibling state refreshes.
 */

const getDigestResult = vi.fn();
const getConstellationsResult = vi.fn();
const getDueReviewsResult = vi.fn();
const getDailyContact = vi.fn();
const answerDailyContact = vi.fn();
const getFinanceSummary = vi.fn();
const getJourneys = vi.fn();
const pushToast = vi.fn();

vi.mock("../api/client.js", () => ({
  getDigestResult: (...a: unknown[]) => getDigestResult(...a),
  getConstellationsResult: (...a: unknown[]) => getConstellationsResult(...a),
  getDueReviewsResult: (...a: unknown[]) => getDueReviewsResult(...a),
  getDailyContact: (...a: unknown[]) => getDailyContact(...a),
  answerDailyContact: (...a: unknown[]) => answerDailyContact(...a),
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

function memory(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "a memory", type: "memory", content: "", ...over } as GraphNode;
}

function renderObs(extra: Partial<React.ComponentProps<typeof Observatory>> = {}) {
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
      {...extra}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getDigestResult.mockResolvedValue({ ok: true, insights: [] });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getDueReviewsResult.mockResolvedValue({ ok: true, reviews: [] });
  getDailyContact.mockResolvedValue({
    date: "2026-10-23",
    question: { text: "What did the marina say?", nodeId: null, nodeLabel: null, source: "cooling" },
    discovery: null,
    foresight: null,
    answered: false,
  });
  answerDailyContact.mockResolvedValue({ nodeIds: [9], fuelEarned: 2, streakAdvanced: true });
  getFinanceSummary.mockResolvedValue({
    budget: { balanceCents: 0, safeToSpendCents: 0, shortfallCents: 0, nextIncomeDate: "", weekEarnedCents: 0, reservedCents: 0, reserved: [] },
    account: {},
    upcoming: [],
  });
  getJourneys.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("OB-01 — the answer send button has a name and meets the touch standard", () => {
  it("renders a visible 'Send' caption and an aria-label naming the action", async () => {
    renderObs();
    const btn = await screen.findByRole("button", { name: /send your answer/i });
    expect(btn.textContent).toContain("Send");
    expect(btn.className).toContain("obs-answer-send");
  });

  it("the CSS sizes it at the 46px standard, not 36px", () => {
    const css = readRepoFile("src/index.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.obs-answer-send\s*\{([^}]*)\}/.exec(css);
    expect(rule, ".obs-answer-send rule exists").toBeTruthy();
    expect(rule![1]).toMatch(/height:\s*46px/);
    expect(rule![1]).toMatch(/min-width:\s*46px/);
    expect(rule![1]).not.toMatch(/width:\s*36px/);
  });
});

describe("OB-04 — the money glance never rounds in the user's favour", () => {
  it("headline shows exact cents: $42.50, not $43", async () => {
    getFinanceSummary.mockResolvedValue({
      budget: { balanceCents: 10_000, safeToSpendCents: 4250, shortfallCents: 0, nextIncomeDate: "", weekEarnedCents: 0, reservedCents: 0, reserved: [] },
      account: {},
      upcoming: [{ id: 11, billId: 2, name: "Electric Co", dueDate: "2026-10-28", amountCents: 8650, status: "due" }],
    });
    renderObs();
    expect(await screen.findByText("$42.50")).toBeTruthy();
    expect(screen.queryByText("$43")).toBeNull();
  });

  it("the shortfall line shows exact cents too", async () => {
    getFinanceSummary.mockResolvedValue({
      budget: { balanceCents: 10_000, safeToSpendCents: 0, shortfallCents: 2575, nextIncomeDate: "2026-11-03", weekEarnedCents: 0, reservedCents: 0, reserved: [] },
      account: {},
      upcoming: [],
    });
    renderObs();
    expect(await screen.findByText(/short \$25\.75/)).toBeTruthy();
    expect(screen.queryByText(/short \$26\b/)).toBeNull();
  });
});

describe("OB-06 — a verified answer refreshes the App-level state it changed", () => {
  it("fires onAnswered on success (and the card flips to answered)", async () => {
    const onAnswered = vi.fn();
    renderObs({ onAnswered });
    const box = await screen.findByPlaceholderText(/Answer her/);
    fireEvent.change(box, { target: { value: "They said Tuesday." } });
    const btn = screen.getByRole("button", { name: /send your answer/i });
    await act(async () => { fireEvent.click(btn); });
    expect(answerDailyContact).toHaveBeenCalledWith("They said Tuesday.");
    expect(onAnswered).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("You answered her today")).toBeTruthy();
  });

  it("does NOT fire onAnswered when the answer fails", async () => {
    answerDailyContact.mockResolvedValue(null);
    const onAnswered = vi.fn();
    renderObs({ onAnswered });
    const box = await screen.findByPlaceholderText(/Answer her/);
    fireEvent.change(box, { target: { value: "They said Tuesday." } });
    const btn = document.querySelector(".obs-answer-send") as HTMLButtonElement;
    await act(async () => { fireEvent.click(btn); });
    expect(onAnswered).not.toHaveBeenCalled();
  });
});
