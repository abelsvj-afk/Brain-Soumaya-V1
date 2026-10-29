import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fuel } from "@brain/shared";
import { FuelEarnSheet } from "./FuelEarnSheet.js";

/**
 * Batch Q follow-ups — REG-152 (copy half) and REG-218 (Calm naming).
 * HelpPanel/FuelEarnSheet copy is pinned by rendering; the App.tsx sites
 * (fab aria-label, replay VERBS) are pinned by source text, since rendering
 * the full App is out of proportion here (the App.focus.test.ts precedent).
 */

const getSpaceId = vi.fn(() => "space1");
vi.mock("../api/client.js", () => ({ getSpaceId: () => getSpaceId() }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { HelpPanel } from "./HelpPanel.js";
import { Legend } from "./Legend.js";

beforeEach(() => {
  vi.resetAllMocks();
  getSpaceId.mockReturnValue("space1");
  localStorage.clear();
});
afterEach(() => cleanup());

const openTab = (name: string) => {
  fireEvent.click(screen.getByText(name));
};

const appSource = () =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");

const helpSource = () =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "./HelpPanel.tsx"), "utf8");

describe("REG-218 — the calm control is named Calm everywhere it is named", () => {
  it("the Tools-menu entry says Calm mode / Exit calm, never Focus", () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "./ToolsMenu.tsx"), "utf8");
    expect(src).toContain('label: p.focusMode ? "Exit calm" : "Calm mode"');
    expect(src).not.toContain('"Focus mode"');
  });

  it("nothing in the app says Deep-space focus mode", () => {
    expect(appSource()).not.toContain("Deep-space focus mode");
  });

  it("the Legend's modes entry says Calm mode, never Focus mode", () => {
    render(<Legend onClose={() => {}} />);
    expect(screen.getByText("Calm mode")).toBeTruthy();
    expect(screen.queryByText("Focus mode")).toBeNull();
  });
  it("Help's deep-space card says calm mode and names the real menu labels", () => {
    render(<HelpPanel onClose={() => {}} />);
    openTab("Controls & Flight");
    expect(screen.getByText("Deep-space calm mode")).toBeTruthy();
    expect(screen.getByText(/tap '🌌 Calm mode'/)).toBeTruthy();
    expect(screen.getByText(/now reads '🌐 Exit calm'/)).toBeTruthy();
    expect(screen.queryByText("Deep-space focus mode")).toBeNull();
    expect(screen.queryByText(/tap '🌌 Focus mode'/)).toBeNull();
  });
});

describe("REG-152 — Help and the fuel sheet name Research Mode research", () => {
  it("the Night Replay says researched, never deep-dived", () => {
    render(<HelpPanel onClose={() => {}} />);
    openTab("Talk & Companion");
    expect(screen.getByText(/the memory she researched/)).toBeTruthy();
    expect(screen.getByText(/Last night: researched/)).toBeTruthy();
    expect(screen.queryByText(/deep-dived/)).toBeNull();
  });

  it("the fuel and research cards say Research Mode research", () => {
    render(<HelpPanel onClose={() => {}} />);
    openTab("Economy & Fleet");
    expect(screen.getByText(/Research Mode research, sector charting/)).toBeTruthy();
    expect(screen.getByText(/researches the most meaningful blind spot/)).toBeTruthy();
    expect(screen.getByText(/Research Mode research on a memory/)).toBeTruthy();
    expect(screen.queryByText(/deep-dive research, sector charting/)).toBeNull();
    expect(screen.queryByText(/deep-dives the most meaningful blind spot/)).toBeNull();
    expect(screen.queryByText(/deep-dive research on a memory/)).toBeNull();
  });

  it("the fuel sheet's deep-jobs hint says Research Mode research", () => {
    const fuel = { fuel: 50, capacity: 200, jobCost: 2, warpCost: 10 } as Fuel;
    render(<FuelEarnSheet fuel={fuel} onAction={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/autonomous Research Mode research & sector charting/)).toBeTruthy();
    expect(screen.queryByText(/autonomous deep-dive research/)).toBeNull();
  });

  it("the research card's tag says research-mode, never deep-dive", () => {
    const src = helpSource();
    expect(src).toContain('"research-mode"');
    expect(src).not.toContain('"deep-dive"');
  });

  it("the replay VERBS say researched / just researched", () => {
    const src = appSource();
    expect(src).toContain('research: { replay: "researched", live: "just researched" }');
    expect(src).not.toContain('"deep-dived"');
    expect(src).not.toContain('"just deep-dived"');
  });
});
