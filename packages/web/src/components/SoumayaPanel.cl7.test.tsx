import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * CL-7 — Soumaya tab (IM-64..72). The api client is mocked; pushToast is a spy.
 * Falsification notes: on the pre-change panel there is no streak readout at
 * all (constellation came from the log feed), no identity header, no log
 * search/error state, no undertaking history, raw `Node #id` pills, a native
 * window.prompt, and the research toggle never rolled back — these tests fail
 * against that code.
 */
const api = vi.hoisted(() => ({
  getAgentLogsStrict: vi.fn(),
  getFuel: vi.fn(),
  getUndertaking: vi.fn(),
  getUndertakingHistory: vi.fn(),
  getStreak: vi.fn(),
  getSettings: vi.fn(),
  updateSetting: vi.fn(),
  getUsage: vi.fn(),
  setBudget: vi.fn(),
  resetUsage: vi.fn(),
  getAdminToken: vi.fn(),
  setAdminToken: vi.fn(),
  getSpaceId: vi.fn(),
  getHealth: vi.fn(),
  describeLlmStatus: vi.fn(),
  getToolHealth: vi.fn(),
  commissionWarm: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { SoumayaPanel } from "./SoumayaPanel.js";

const USAGE = {
  inputTokens: 0, outputTokens: 0, estCostUsd: 1, budgetUsd: 10,
  remainingUsd: 9, fractionUsed: 0.1, overBudget: false, low: false,
};

function dayStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function streakWith(over: Record<string, unknown> = {}) {
  const history = Array.from({ length: 14 }, (_, i) => ({
    date: dayStr(i - 13),
    tended: i >= 11 ? true : i === 10 ? false : null,
  }));
  return {
    current: 3, best: 5, today: true, shields: 1,
    lastActiveDate: dayStr(0), history, ...over,
  };
}

function makeLog(id: number, over: Record<string, unknown> = {}) {
  return {
    id, agent: "soumaya", action: "synthesis", description: `entry ${id}`,
    targets: "[]", result: null, createdAt: new Date().toISOString(), ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  pushToast.mockReset();
  api.getAgentLogsStrict.mockResolvedValue([]);
  api.getSettings.mockResolvedValue({ research_enabled: "false" });
  api.getUsage.mockResolvedValue(null);
  api.getFuel.mockResolvedValue({ fuel: 10, capacity: 100, jobCost: 5 });
  api.getUndertaking.mockResolvedValue(null);
  api.getUndertakingHistory.mockResolvedValue([]);
  api.getStreak.mockResolvedValue(streakWith());
  api.getHealth.mockResolvedValue(null);
  api.getToolHealth.mockResolvedValue([]);
  api.getAdminToken.mockReturnValue("tok");
  api.getSpaceId.mockReturnValue("s1");
  api.describeLlmStatus.mockReturnValue({ icon: "✓", text: "ok", tone: "ok" });
  api.updateSetting.mockResolvedValue({ ok: true });
  api.setBudget.mockResolvedValue(USAGE);
  api.resetUsage.mockResolvedValue(USAGE);
  api.commissionWarm.mockResolvedValue({ ok: true, warmed: 1, cost: 25 });
});
afterEach(cleanup);

describe("IM-64 — constellation is the streak, not the log feed", () => {
  it("renders streak number, legend, labeled cells from the streak endpoint", async () => {
    // Logs cover ONLY today — on the old log-derived grid that lights 1 cell
    // for the wrong reason; the streak history says 3 tended / 1 missed / 10 no-record.
    api.getAgentLogsStrict.mockResolvedValue([makeLog(1)]);
    const { container } = render(<SoumayaPanel onFocus={vi.fn()} />);
    expect((await screen.findAllByText(/3-day streak/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/best 5/)).toBeTruthy();
    expect(screen.getByText(/tended today/)).toBeTruthy();
    expect(container.querySelectorAll(".constellation-cell.lit")).toHaveLength(3);
    expect(container.querySelectorAll(".constellation-cell.missed")).toHaveLength(1);
    expect(container.querySelectorAll(".constellation-cell.unknown")).toHaveLength(10);
    expect(screen.getByText(/no record/)).toBeTruthy(); // legend
  });
});

describe("IM-65 — identity header from real state", () => {
  it("shows the eye + what she's doing now from the live task list", async () => {
    const tasks = [{ id: "t1", type: "maintenance", label: "Warming the cold belt", status: "doing" }];
    const { container } = render(<SoumayaPanel onFocus={vi.fn()} tasks={tasks} />);
    expect(await screen.findByText(/working on: Warming the cold belt/)).toBeTruthy();
    expect(container.querySelector(".soumaya-eye")).toBeTruthy();
    expect(screen.getByText(/Focused/)).toBeTruthy();
  });

  it("falls back to her latest real work when no task is running", async () => {
    api.getAgentLogsStrict.mockResolvedValue([makeLog(9, { description: "Linked two memories about sleep" })]);
    render(<SoumayaPanel onFocus={vi.fn()} tasks={[]} />);
    expect(await screen.findByText(/Her latest work: Linked two memories about sleep/)).toBeTruthy();
  });
});

describe("IM-66/70 — activity logs", () => {
  it("failed load renders a real error state, not an empty brain", async () => {
    api.getAgentLogsStrict.mockRejectedValue(new Error("down"));
    render(<SoumayaPanel onFocus={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load her activity/)).toBeTruthy();
    expect(screen.queryByText(/No recent logs recorded/)).toBeNull();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("groups by local day with full dates, humanized actions and memory labels", async () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();
    api.getAgentLogsStrict.mockResolvedValue([
      makeLog(2, { action: "tool:bill_risk", description: "Rent is due soon", createdAt: new Date().toISOString(), targets: "[42]" }),
      makeLog(1, { description: "older thing", createdAt: yesterday }),
    ]);
    render(<SoumayaPanel onFocus={vi.fn()} nodes={[{ id: 42, label: "Rent money" }]} />);
    expect(await screen.findByText(/Today ·/)).toBeTruthy();
    expect(screen.getByText(/Yesterday ·/)).toBeTruthy();
    // Humanized in BOTH the filter dropdown and the log row itself.
    expect(screen.getAllByText("Bill-risk warning").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/TOOL:BILL_RISK/)).toBeNull();
    expect(screen.getByText("Rent money")).toBeTruthy(); // target pill = label, not "Node #42"
    expect(screen.queryByText(/Node #42/)).toBeNull();
    // Full date (with year) distinguishes the days, not time-of-day only.
    expect(screen.getAllByText(new RegExp(`${new Date().getFullYear()} ·`)).length).toBeGreaterThan(0);
  });

  it("searches and paginates the log list", async () => {
    const logs = Array.from({ length: 12 }, (_, i) => makeLog(i + 1, { description: `chore ${i + 1}` }));
    api.getAgentLogsStrict.mockResolvedValue(logs);
    render(<SoumayaPanel onFocus={vi.fn()} />);
    expect(await screen.findByText(/Showing 10 of 12 entries/)).toBeTruthy();
    fireEvent.click(screen.getByText("Show more"));
    expect(await screen.findByText(/Showing 12 of 12 entries/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search activity logs"), { target: { value: "chore 3" } });
    expect(await screen.findByText(/Showing 1 of 1 entries/)).toBeTruthy();
  });
});

describe("IM-67 — undertaking history + celebration", () => {
  it("celebrates the latest completed arc and lists past ones when none is active", async () => {
    api.getUndertakingHistory.mockResolvedValue([
      { id: 2, kind: "weave_frontier", title: "Weaving the frontier", total: 5, done: 5, status: "done", startedAt: "2026-10-01", endsAt: null },
      { id: 1, kind: "warm_cold_belt", title: "Warming the cold belt", total: 5, done: 5, status: "done", startedAt: "2026-09-20", endsAt: null },
    ]);
    render(<SoumayaPanel onFocus={vi.fn()} />);
    expect(await screen.findByText(/Completed: Weaving the frontier/)).toBeTruthy();
    expect(screen.getByText("Past undertakings")).toBeTruthy();
    expect(screen.getByText(/Warming the cold belt/)).toBeTruthy();
  });
});

describe("IM-71 — admin token via in-app dialog, never window.prompt", () => {
  it("opens the dialog, stores the token, then runs the budget write", async () => {
    api.getUsage.mockResolvedValue(USAGE);
    api.getAdminToken.mockReturnValue(null);
    const promptSpy = vi.fn(() => null);
    window.prompt = promptSpy as typeof window.prompt;
    render(<SoumayaPanel onFocus={vi.fn()} />);
    const input = await screen.findByPlaceholderText("$10");
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.click(screen.getByText("Set budget"));
    expect(await screen.findByText("Admin token needed")).toBeTruthy();
    expect(promptSpy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Admin token"), { target: { value: "sekret" } });
    fireEvent.click(screen.getByText("Save token & continue"));
    await waitFor(() => expect(api.setAdminToken).toHaveBeenCalledWith("sekret"));
    await waitFor(() => expect(api.setBudget).toHaveBeenCalledWith(50));
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe("IM-72 — research toggle honours the write result", () => {
  it("rolls back + toasts when the write fails", async () => {
    api.updateSetting.mockRejectedValue(new Error("nope"));
    render(<SoumayaPanel onFocus={vi.fn()} />);
    const toggle = await screen.findByRole("button", { name: "OFF" });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't save Research Mode"), expect.anything(), expect.anything()),
    );
    // Rolled back: the toggle reads OFF again, not the optimistic ON.
    expect(await screen.findByRole("button", { name: "OFF" })).toBeTruthy();
  });

  it("stays flipped when the write succeeds", async () => {
    render(<SoumayaPanel onFocus={vi.fn()} />);
    const toggle = await screen.findByRole("button", { name: "OFF" });
    fireEvent.click(toggle);
    expect(await screen.findByRole("button", { name: "ON" })).toBeTruthy();
    expect(api.updateSetting).toHaveBeenCalledWith("research_enabled", "true");
  });
});
