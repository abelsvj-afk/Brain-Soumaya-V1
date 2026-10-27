import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const getGraph = vi.fn();
const listIncome = vi.fn();
const listExpense = vi.fn();
const listBills = vi.fn();
const getWealthSummary = vi.fn();
vi.mock("../api/client.js", () => ({ getGraph: (...a: unknown[]) => getGraph(...a) }));
vi.mock("../api/finance.js", () => ({
  listIncome: (...a: unknown[]) => listIncome(...a),
  listExpense: (...a: unknown[]) => listExpense(...a),
  listBills: (...a: unknown[]) => listBills(...a),
  getWealthSummary: (...a: unknown[]) => getWealthSummary(...a),
}));
const linkToJourney = vi.fn();
vi.mock("../api/journeys.js", () => ({ linkToJourney: (...a: unknown[]) => linkToJourney(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { JourneyLinkPicker } from "./JourneyLinkPicker.js";

beforeEach(() => {
  vi.resetAllMocks();
  listIncome.mockResolvedValue([]);
  listExpense.mockResolvedValue([]);
  listBills.mockResolvedValue([]);
  getWealthSummary.mockResolvedValue({ goals: [] });
  linkToJourney.mockResolvedValue({ id: 1, journeyId: 1, kind: "node", refId: 1, createdAt: "" });
});
afterEach(() => cleanup());

function graphWith(n: number) {
  return {
    nodes: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      label: `Memory ${String(i + 1).padStart(2, "0")}`,
      kind: "memory",
    })),
    edges: [],
  };
}

describe("REG-163 (JN-06) — the link picker discloses truncation per section", () => {
  it("states 'Showing 20 of 25' when a section holds more than the 20-row slice", async () => {
    getGraph.mockResolvedValue(graphWith(25));
    render(<JourneyLinkPicker journeyId={1} linkedKeys={new Set()} onLinked={() => {}} />);
    await act(async () => { screen.getByText("＋ Link something").click(); });
    expect(await screen.findByText(/Showing 20 of 25/)).toBeTruthy();
    // Exactly the first 20 render; the 21st does not.
    expect(screen.getByText("Memory 20")).toBeTruthy();
    expect(screen.queryByText("Memory 21")).toBeNull();
  });

  it("states nothing when a section fits inside the slice", async () => {
    getGraph.mockResolvedValue(graphWith(5));
    render(<JourneyLinkPicker journeyId={1} linkedKeys={new Set()} onLinked={() => {}} />);
    await act(async () => { screen.getByText("＋ Link something").click(); });
    await screen.findByText("Memory 05");
    expect(screen.queryByText(/Showing .* of/)).toBeNull();
  });
});
