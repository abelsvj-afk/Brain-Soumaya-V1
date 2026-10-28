import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/**
 * Batch P — Help copy corrections (documentation-only rows):
 *  REG-219: "Tabs that unlock" — all three tabs appear with the first real memory.
 *  REG-220: Research Mode has no "single home" — the toggle also lives in Settings.
 *  REG-221: the activity-log line that actually appears is the executed research job.
 *  REG-222: the provenance card names the belief exclusion.
 */

const getSpaceId = vi.fn(() => "space1");
vi.mock("../api/client.js", () => ({ getSpaceId: () => getSpaceId() }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { HelpPanel } from "./HelpPanel.js";

beforeEach(() => {
  vi.resetAllMocks();
  getSpaceId.mockReturnValue("space1");
  localStorage.clear();
});
afterEach(() => cleanup());

const openTab = (name: string) => {
  fireEvent.click(screen.getByText(name));
};

describe("REG-219 — Help says all three tabs unlock with the first real memory", () => {
  it("names the first real memory as the only trigger, not a synthesized connection", () => {
    render(<HelpPanel onClose={() => {}} />);
    openTab("Organize & Explore");
    expect(screen.getByText(/appear once you log your first real memory/i)).toBeTruthy();
    expect(screen.getByText(/only trigger for all three/i)).toBeTruthy();
    expect(screen.queryByText(/first synthesized connection/i)).toBeNull();
  });
});

describe("REG-220 — Help drops the 'single home' claim", () => {
  it("names both homes of the Research Mode toggle", () => {
    render(<HelpPanel onClose={() => {}} />);
    openTab("Economy & Fleet");
    expect(screen.queryByText(/single home/i)).toBeNull();
    expect(screen.getByText(/also lives in Settings/i)).toBeTruthy();
  });
});

describe("REG-221 — Help describes the research line that actually appears", () => {
  it("says the executed job shows as a Research entry; the picking itself isn't logged", () => {
    render(<HelpPanel onClose={() => {}} />);
    openTab("Economy & Fleet");
    expect(screen.getByText(/shows up in her activity log as a Research entry/i)).toBeTruthy();
    expect(screen.queryByText(/says what it was 'prioritized for'/i)).toBeNull();
  });
});

describe("REG-222 — Help names the belief exclusion on the Charted mark", () => {
  it("says beliefs never carry the mark", () => {
    render(<HelpPanel onClose={() => {}} />);
    openTab("Structure & Taxonomy");
    expect(screen.getByText(/except beliefs/i)).toBeTruthy();
  });
});
