import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * Batch O — Soumaya tab (REG-167 SF-01, REG-168 SF-03, REG-172 SF-07,
 * REG-173 SF-08). The api client is mocked, as in SoumayaPanel.cl7.test.tsx.
 *
 * Falsification notes: on the pre-change panel the six telemetry sources
 * load in one Promise.all whose catch only console.errors (one dead
 * endpoint blanks fuel/streak/usage/undertaking together and Research
 * Mode renders its unverified `false` default as OFF); the ship-task
 * toggle is a bare 🏷️ glyph; an empty budget field submits $0 with no
 * message; and "Tap to copy" writes the literal placeholder
 * `/link <name> <passcode>`. Every test below fails against that code.
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

const clipboardWrite = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  pushToast.mockReset();
  clipboardWrite.mockReset();
  // happy-dom's navigator.clipboard is a getter-only property — define it.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
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

describe("REG-167 (SF-01) — each telemetry source fails independently and visibly", () => {
  it("a dead usage endpoint does not blank fuel, streak, or the undertaking", async () => {
    api.getUsage.mockRejectedValue(new Error("usage down"));
    render(<SoumayaPanel onFocus={vi.fn()} />);
    // The surviving sections still render their real data…
    expect(await screen.findByText(/Fuel \(earned by tending\)/)).toBeTruthy();
    expect((await screen.findAllByText(/3-day streak/)).length).toBeGreaterThan(0);
    // …and the failed source says so, in its own section.
    expect(await screen.findByText(/Couldn't load the API budget/)).toBeTruthy();
  });

  it("a dead fuel endpoint shows a fuel error while the streak still renders", async () => {
    api.getFuel.mockRejectedValue(new Error("fuel down"));
    render(<SoumayaPanel onFocus={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load fuel/)).toBeTruthy();
    expect((await screen.findAllByText(/3-day streak/)).length).toBeGreaterThan(0);
  });

  it("a dead streak endpoint names the failure instead of the wrong-cause 'unavailable'", async () => {
    api.getStreak.mockRejectedValue(new Error("streak down"));
    render(<SoumayaPanel onFocus={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load your streak/)).toBeTruthy();
    expect(await screen.findByText(/Fuel \(earned by tending\)/)).toBeTruthy();
  });

  it("a dead undertaking endpoint shows its own error, not a silent absence", async () => {
    api.getUndertaking.mockRejectedValue(new Error("arc down"));
    api.getUndertakingHistory.mockRejectedValue(new Error("history down"));
    render(<SoumayaPanel onFocus={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load the current undertaking/)).toBeTruthy();
    expect(await screen.findByText(/Couldn't load past undertakings/)).toBeTruthy();
    expect(await screen.findByText(/Fuel \(earned by tending\)/)).toBeTruthy();
  });

  it("Research Mode renders an unknown state until its setting has actually been read", async () => {
    api.getSettings.mockRejectedValue(new Error("settings down"));
    render(<SoumayaPanel onFocus={vi.fn()} />);
    // Not OFF-as-fact: the toggle is an unknown, disabled "…"…
    const toggle = await screen.findByRole("button", { name: "…" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    // …and the panel says why.
    expect(await screen.findByText(/Research Mode state unknown/)).toBeTruthy();
    // The identity line must not claim the mode either way.
    expect(screen.queryByText(/Research Mode on/)).toBeNull();
  });

  it("a failed source recovers on the next successful poll round", async () => {
    api.getUsage.mockRejectedValueOnce(new Error("usage down"));
    api.getUsage.mockResolvedValue(USAGE);
    render(<SoumayaPanel onFocus={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load the API budget/)).toBeTruthy();
    // The 10s poll re-reads; the error clears once the source answers again.
    await waitFor(() => expect(screen.queryByText(/Couldn't load the API budget/)).toBeNull(), { timeout: 12000 });
  }, 15000);
});

describe("REG-168 (SF-03) — the ship-task toggle carries a visible caption", () => {
  it("the toggle reads as a captioned control like its camera neighbour", async () => {
    render(
      <SoumayaPanel
        onFocus={vi.fn()}
        showShipTask={false}
        setShowShipTask={vi.fn()}
        shipViewMode="orbit"
        setShipViewMode={vi.fn()}
      />,
    );
    await screen.findAllByText(/3-day streak/);
    expect(screen.getByRole("button", { name: /Labels/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /🎥 Free/ })).toBeTruthy();
  });

  it("planned tasks expose reorder controls with real accessible names", async () => {
    const tasks = [
      { id: "a", label: "First task", status: "planned" },
      { id: "b", label: "Second task", status: "planned" },
    ];
    render(<SoumayaPanel onFocus={vi.fn()} tasks={tasks} onReorderTasks={vi.fn()} />);
    await screen.findAllByText(/3-day streak/);
    expect(screen.getAllByRole("button", { name: /Move .* up in priority/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Move .* down in priority/i })).toHaveLength(2);
  });
});

describe("REG-172 (SF-07) — 'Set budget' validates locally and $0 asks first", () => {
  async function openBudgetBox() {
    api.getUsage.mockResolvedValue(USAGE);
    render(<SoumayaPanel onFocus={vi.fn()} />);
    const input = await screen.findByPlaceholderText("$10");
    return input as HTMLInputElement;
  }

  it("an empty field shows 'enter an amount' and never submits", async () => {
    await openBudgetBox();
    fireEvent.click(screen.getByText("Set budget"));
    expect(await screen.findByText(/Enter an amount/)).toBeTruthy();
    expect(api.setBudget).not.toHaveBeenCalled();
  });

  it("a negative amount shows 'enter an amount' and never submits", async () => {
    const input = await openBudgetBox();
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByText("Set budget"));
    expect(await screen.findByText(/Enter an amount/)).toBeTruthy();
    expect(api.setBudget).not.toHaveBeenCalled();
  });

  it("a $0 budget asks for confirmation in the panel's own terms before submitting", async () => {
    const input = await openBudgetBox();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByText("Set budget"));
    // No submit yet — the panel asks first, in its own "AI is paused" terms.
    expect(await screen.findByText(/AI is paused/)).toBeTruthy();
    expect(api.setBudget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Yes, set \$0/));
    await waitFor(() => expect(api.setBudget).toHaveBeenCalledWith(0));
  });

  it("cancelling the $0 confirmation submits nothing", async () => {
    const input = await openBudgetBox();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByText("Set budget"));
    expect(await screen.findByText(/AI is paused/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText(/AI is paused/)).toBeNull());
    expect(api.setBudget).not.toHaveBeenCalled();
  });
});

describe("REG-173 (SF-08) — the Telegram block is a labelled template, not a copyable command", () => {
  it("clicking the block does not copy the literal placeholder", async () => {
    render(<SoumayaPanel onFocus={vi.fn()} spaceName="My Brain" />);
    const block = await screen.findByText(/\/link/);
    fireEvent.click(block);
    expect(clipboardWrite).not.toHaveBeenCalledWith("/link <name> <passcode>");
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("the block is labelled as a template to fill in, not 'Tap to copy'", async () => {
    render(<SoumayaPanel onFocus={vi.fn()} spaceName="My Brain" />);
    expect(await screen.findByText(/Template/)).toBeTruthy();
    expect(screen.queryByTitle("Tap to copy")).toBeNull();
  });
});
