import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const currentSpace = vi.fn();
const updateProfile = vi.fn();
vi.mock("../api/client.js", () => ({
  currentSpace: (...a: unknown[]) => currentSpace(...a),
  updateProfile: (...a: unknown[]) => updateProfile(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { SettingsPanel } from "./SettingsPanel.js";
import { setBoundedLinksEnabled } from "../graph/renderModel.js";

beforeEach(() => {
  vi.resetAllMocks();
  currentSpace.mockResolvedValue({ id: "s1", name: "Sam", gamerTag: "sam99" });
  localStorage.clear();
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
});

afterEach(() => cleanup());

describe("SettingsPanel — the Seg segmented control keeps a stable identity across re-renders", () => {
  it("does not remount the FPS-cap control's DOM node as the live FPS readout updates", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    const fpsCapButtons = await screen.findAllByRole("button", { name: "30" });
    const before = fpsCapButtons[0];
    // Simulate the ~2x/sec re-render the live FPS sampler causes by forcing a
    // state update via a different control (colorblind toggle) rather than
    // waiting on real rAF timing.
    const cbToggle = screen.getByText("Colorblind-safe colours").closest("label")!.querySelector("button")!;
    act(() => { cbToggle.click(); });
    const after = screen.getAllByRole("button", { name: "30" })[0];
    expect(after).toBe(before); // same DOM node — Seg wasn't torn down and rebuilt
  });
});

describe("SettingsPanel — Lite mode warns before discarding an unsaved profile edit", () => {
  it("confirms before reloading when the name field has an unsaved change", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    const nameInput = await screen.findByPlaceholderText("Your name (anything)") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "New Name" } });

    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return true; };
    const liteToggle = screen.getByText(/Lite mode/).closest("label")!.querySelector("button")!;
    act(() => { liteToggle.click(); });
    expect(asked).toBe(true);
  });

  it("does not ask when there is no unsaved edit", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    await screen.findByPlaceholderText("Your name (anything)");
    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return true; };
    const liteToggle = screen.getByText(/Lite mode/).closest("label")!.querySelector("button")!;
    act(() => { liteToggle.click(); });
    expect(asked).toBe(false);
  });
});

describe("SettingsPanel — bounded detailed links (Phase 2.1 in-app toggle)", () => {
  // renderModel.ts caches isBoundedLinksEnabled() at module scope for the page's life
  // (by design — see its own doc comment); force a known OFF starting point before each
  // of these tests rather than relying on execution order or localStorage.clear() alone,
  // since the in-memory cache survives across tests within this one file/process.
  beforeEach(() => setBoundedLinksEnabled(false));

  it("is reachable without a URL — toggling flips state and warns before an unsaved-edit reload", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    const nameInput = await screen.findByPlaceholderText("Your name (anything)") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "New Name" } });

    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return true; };
    const toggle = screen.getByText(/Bounded detailed links/).closest("label")!.querySelector("button")!;
    act(() => { toggle.click(); });
    expect(asked).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a budget picker only once bounded mode is on", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    await screen.findByPlaceholderText("Your name (anything)");
    expect(screen.queryByText("Detailed-link budget")).toBeNull();
    const toggle = screen.getByText(/Bounded detailed links/).closest("label")!.querySelector("button")!;
    act(() => { toggle.click(); });
    expect(screen.getByText("Detailed-link budget")).toBeTruthy();
  });
});

describe("SettingsPanel — profile inputs lock while a save is in flight", () => {
  it("disables the name/gamer-tag fields while saveProfile() is pending", async () => {
    let resolveSave!: (v: { id: string; name: string; gamerTag: string }) => void;
    updateProfile.mockReturnValue(new Promise((r) => { resolveSave = r; }));
    render(<SettingsPanel onClose={() => {}} />);
    const nameInput = await screen.findByPlaceholderText("Your name (anything)") as HTMLInputElement;
    const saveBtn = screen.getByText("Save profile");
    await act(async () => { saveBtn.click(); });
    expect(nameInput.disabled).toBe(true);
    await act(async () => { resolveSave({ id: "s1", name: "Sam", gamerTag: "sam99" }); });
    expect(nameInput.disabled).toBe(false);
  });
});

describe("REG-026 Settings names what the Inbox actually keeps", () => {
  it("states the four recorded producers and where other messages live", async () => {
    render(<SettingsPanel onClose={() => {}} />);
    const note = await screen.findByText(/Your Inbox keeps the digests/i);
    expect(note.textContent).toMatch(/insights, discoveries, and bill-risk warnings/i);
    expect(note.textContent).toMatch(/reminders and check-ins, live only in the chat/i);
    expect(note.textContent).not.toMatch(/keeps everything she sends/i);
  });
});
