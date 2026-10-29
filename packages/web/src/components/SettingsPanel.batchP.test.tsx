import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/**
 * Batch P — Settings:
 *  REG-216: "UTC" is absent from the user-facing timezone list.
 *  REG-217: closing Settings with unsaved notification prefs prompts,
 *           like unsaved profile edits already do.
 */

const currentSpace = vi.fn();
const updateProfile = vi.fn();
vi.mock("../api/client.js", () => ({
  currentSpace: (...a: unknown[]) => currentSpace(...a),
  updateProfile: (...a: unknown[]) => updateProfile(...a),
}));
const pushToast = vi.fn();
// REG-216 is about a space STORED as UTC on a device that isn't. Pin the
// device zone so the test means the same thing on any machine — including
// a UTC sandbox, where "show the device zone" would legitimately show UTC.
vi.mock("../utils/spaceTimezone.js", async (orig) => ({
  ...(await orig<typeof import("../utils/spaceTimezone.js")>()),
  deviceTimeZone: () => "America/New_York",
}));
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
  getUsage.mockResolvedValue({ inputTokens: 0, outputTokens: 0, estCostUsd: 0, budgetUsd: 10, remainingUsd: 10, fractionUsed: 0, overBudget: false, low: false });
  getToolHealth.mockResolvedValue([]);
  getSettings.mockResolvedValue({ research_enabled: "false" });
  updateSetting.mockResolvedValue({ ok: true });
  getSpacePreferences.mockResolvedValue({ ...PREFS });
  updateSpacePreferences.mockImplementation(async (patch: object) => ({ ...PREFS, ...patch }));
  getGraphExport.mockResolvedValue({ exportedAt: "2026-10-21T00:00:00Z", spaceId: "s1", nodes: [], edges: [] });
  localStorage.clear();
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
});
afterEach(() => cleanup());

describe("REG-216 — no UTC in the user-facing timezone list", () => {
  it("the timezone picker offers no UTC option", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    const tz = (await screen.findByDisplayValue("Europe/London")) as HTMLSelectElement;
    const options = [...tz.options].map((o) => o.value);
    expect(options).not.toContain("UTC");
    expect(options.length).toBeGreaterThan(5);
  });

  it("a space already stored as UTC shows the device zone instead, never a UTC option", async () => {
    getSpacePreferences.mockResolvedValue({ ...PREFS, timezone: "UTC" });
    render(<SettingsPanel onClose={() => {}} />);
    // The device zone is pinned above. The select displays the zone with
    // spaces ("America/New York").
    const deviceZone = "America/New_York";
    const tz = (await screen.findByDisplayValue(deviceZone.replaceAll("_", " "))) as HTMLSelectElement;
    expect(tz.value).toBe(deviceZone);
    const options = [...tz.options].map((o) => o.value);
    expect(options).not.toContain("UTC");
  });
});

describe("REG-217 — unsaved notification prefs are guarded on close", () => {
  it("closing with a dirty digest time asks first, and stays when the user says no", async () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);
    await screen.findByPlaceholderText("Your name (anything)");
    // Digest time lives in the prefs section; changing it dirties prefs only.
    const digest = screen.getByLabelText("Daily digest time") as HTMLInputElement;
    fireEvent.change(digest, { target: { value: "07:30" } });

    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return false; };
    fireEvent.click(screen.getByLabelText("Close"));
    expect(asked).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // Saying yes lets the close through.
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("a reload toggle also asks when only notification prefs are dirty", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    await screen.findByPlaceholderText("Your name (anything)");
    const digest = screen.getByLabelText("Daily digest time") as HTMLInputElement;
    fireEvent.change(digest, { target: { value: "07:30" } });

    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return true; };
    const liteToggle = screen.getByText(/Lite mode/).closest("label")!.querySelector("button")!;
    fireEvent.click(liteToggle);
    expect(asked).toBe(true);
  });

  it("the Soumaya-tab button also asks when notification prefs are dirty, and stays when the user says no", async () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);
    await screen.findByPlaceholderText("Your name (anything)");
    const digest = screen.getByLabelText("Daily digest time") as HTMLInputElement;
    fireEvent.change(digest, { target: { value: "07:30" } });

    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return false; };
    fireEvent.click(screen.getByText(/Open the Soumaya tab/));
    expect(asked).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // Saying yes lets the tab-switch close through.
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
    fireEvent.click(screen.getByText(/Open the Soumaya tab/));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not ask when nothing is dirty", async () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);
    await screen.findByPlaceholderText("Your name (anything)");
    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return true; };
    fireEvent.click(screen.getByLabelText("Close"));
    expect(asked).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });
});
