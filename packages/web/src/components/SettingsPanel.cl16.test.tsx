import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

/**
 * CL-16 pins for SettingsPanel:
 *  IM-127 — the render-diagnostics apparatus is fenced behind a
 *           Developer/Advanced disclosure, closed by default.
 *  IM-128 — ops data (usage INCLUDING token counts, budget, tool health)
 *           surfaces here; Research Mode flips the SAME server setting the
 *           Soumaya tab uses, honouring the write result (CL-7 contract).
 *  IM-129 — timezone + notification preferences read/write the server store;
 *           a graph-JSON export downloads.
 *  IM-130 — the Lite-mode page reload is announced inline BEFORE the toggle.
 */

const currentSpace = vi.fn();
const updateProfile = vi.fn();
vi.mock("../api/client.js", () => ({
  currentSpace: (...a: unknown[]) => currentSpace(...a),
  updateProfile: (...a: unknown[]) => updateProfile(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

const getUsage = vi.fn();
const getToolHealth = vi.fn();
const getSettings = vi.fn();
const updateSetting = vi.fn();
vi.mock("../api/ops.js", () => ({
  getUsage: (...a: unknown[]) => getUsage(...a),
  getToolHealth: (...a: unknown[]) => getToolHealth(...a),
  getSettings: (...a: unknown[]) => getSettings(...a),
  updateSetting: (...a: unknown[]) => updateSetting(...a),
}));

const getSpacePreferences = vi.fn();
const updateSpacePreferences = vi.fn();
const getGraphExport = vi.fn();
vi.mock("../api/preferences.js", () => ({
  getSpacePreferences: (...a: unknown[]) => getSpacePreferences(...a),
  updateSpacePreferences: (...a: unknown[]) => updateSpacePreferences(...a),
  getGraphExport: (...a: unknown[]) => getGraphExport(...a),
}));

import { SettingsPanel } from "./SettingsPanel.js";

const PREFS = { timezone: "Europe/London", quietStart: "21:00", quietEnd: "04:30", digestTime: "06:00", dailyProactiveCap: 5 };

beforeEach(() => {
  vi.resetAllMocks();
  currentSpace.mockResolvedValue({ id: "s1", name: "Sam", gamerTag: "sam99" });
  getUsage.mockResolvedValue({
    inputTokens: 12345, outputTokens: 6789, estCostUsd: 0.42, budgetUsd: 10,
    remainingUsd: 9.58, fractionUsed: 0.042, overBudget: false, low: false,
  });
  getToolHealth.mockResolvedValue([
    { tool: "fire_reminder", lastRanAt: "2026-10-20T00:00:00Z" },
    { tool: "weekly_review", lastRanAt: null },
  ]);
  getSettings.mockResolvedValue({ research_enabled: "false" });
  updateSetting.mockResolvedValue({ ok: true });
  getSpacePreferences.mockResolvedValue({ ...PREFS });
  updateSpacePreferences.mockImplementation(async (patch: object) => ({ ...PREFS, ...patch }));
  getGraphExport.mockResolvedValue({ exportedAt: "2026-10-21T00:00:00Z", spaceId: "s1", nodes: [{ id: 1 }], edges: [] });
  localStorage.clear();
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
});

afterEach(() => cleanup());

describe("IM-127 — diagnostics fenced behind Developer/Advanced, closed by default", () => {
  it("hides the whole apparatus until the disclosure is opened", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    await screen.findByPlaceholderText("Your name (anything)");
    expect(screen.getByText("🛠 Developer / Advanced")).toBeTruthy();
    expect(screen.queryByText(/Bypass post-processing composer/)).toBeNull();
    expect(screen.queryByText(/Galaxy render isolation sweep/)).toBeNull();
    expect(screen.queryByText(/Diagnostic recording/)).toBeNull();
    expect(screen.queryByText(/BAD-vs-GOOD state snapshot/)).toBeNull();
    // User-facing sections are NOT fenced.
    expect(screen.getByText("🎨 Graphics & performance")).toBeTruthy();
    expect(screen.getByText("♿ Accessibility")).toBeTruthy();

    fireEvent.click(screen.getByText("Show developer tools"));
    expect(screen.getByText(/Bypass post-processing composer/)).toBeTruthy();
    expect(screen.getByText(/Galaxy render isolation sweep/)).toBeTruthy();
    expect(screen.getByText(/Diagnostic recording/)).toBeTruthy();
  });
});

describe("IM-128 — ops data + Research Mode in Settings", () => {
  it("displays usage INCLUDING the token counts, budget and a tool-health summary", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    expect(await screen.findByText("12,345")).toBeTruthy(); // inputTokens — displayed nowhere before IM-128
    expect(screen.getByText("6,789")).toBeTruthy(); // outputTokens
    expect(screen.getByText("$9.58")).toBeTruthy(); // remaining budget
    expect(screen.getByText(/2 tracked · 1 have run/)).toBeTruthy();
    expect(screen.getByText(/Open the Soumaya tab/)).toBeTruthy(); // deep-link to the full views
  });

  it("Research Mode toggle writes the shared server setting and honours the result", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    const toggle = (await screen.findByText("Research Mode")).closest("label")!.querySelector("button")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { toggle.click(); });
    expect(updateSetting).toHaveBeenCalledWith("research_enabled", "true");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    // A rejected write rolls back + toasts (the CL-7 contract — no lying toggle).
    updateSetting.mockResolvedValue({ ok: false });
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't save Research Mode"), "⚠️", 4000);
  });
});

describe("IM-129 — time/notification preferences + export", () => {
  it("loads the stored timezone and saves changes through the server store", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    const tz = (await screen.findByDisplayValue("Europe/London")) as HTMLSelectElement;
    expect(tz.value).toBe("Europe/London");
    fireEvent.change(tz, { target: { value: "America/Chicago" } });
    await act(async () => { screen.getByText("Save time & notifications").click(); });
    expect(updateSpacePreferences).toHaveBeenCalledWith(expect.objectContaining({ timezone: "America/Chicago" }));
  });

  it("export button fetches the graph JSON and reports real counts", async () => {
    const createUrl = vi.fn(() => "blob:fake");
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    render(<SettingsPanel onClose={() => {}} />);
    await act(async () => { screen.getByText(/Download brain export/).click(); });
    expect(getGraphExport).toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Exported 1 memories and 0 connections"), "💾", 4000);
  });
});

describe("IM-130 — reloads are announced inline before the toggle", () => {
  it("Lite mode carries a reload badge and says so in its own copy", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    await screen.findByPlaceholderText("Your name (anything)");
    const label = screen.getByText(/Lite mode/).closest("label")!;
    expect(label.textContent).toContain("reload");
    expect(label.textContent).toMatch(/reloading the page/i);
  });
});
