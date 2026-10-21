import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import type { GraphData } from "@brain/shared";

/**
 * IM-93 (client half): an entry whose fuel claim FAILS must not be marked seen
 * (otherwise its reward can never be retried) and the failure must surface as a
 * toast instead of being swallowed. Before the fix the panel marked every
 * fresh entry seen synchronously, whatever the claim returned.
 */
const claimCodexReward = vi.fn();
const getCodexDiscoveries = vi.fn();
vi.mock("../api/client.js", () => ({
  claimCodexReward: (...a: unknown[]) => claimCodexReward(...a),
  getCodexDiscoveries: (...a: unknown[]) => getCodexDiscoveries(...a),
}));

const pushToast = vi.fn();
vi.mock("./Toasts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Toasts.js")>();
  return { ...actual, pushToast: (...a: unknown[]) => pushToast(...a) };
});

const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { CodexPanel } from "./CodexPanel.js";

// One goal memory → fresh discoveries: sector-daily, mind-goal,
// fleet-soumaya, fleet-station (all computed live by buildCodex).
const graph = {
  nodes: [
    {
      id: 1,
      label: "Launch the studio",
      type: "daily",
      kind: "goal",
      content: "x",
      importance: 0.5,
      celestial: "asteroid",
      degree: 0,
      entropy: 0,
      emotionalWeight: 0,
      createdAt: new Date().toISOString(),
    },
  ],
  links: [],
} as unknown as GraphData;

const seenIds = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem("codex.seen.s1") || "[]") as string[];
  } catch {
    return [];
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getCodexDiscoveries.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("CodexPanel — failed claims stay un-seen and surface (IM-93)", () => {
  it("does not mark an entry seen when its claim fails, and toasts the failure", async () => {
    claimCodexReward.mockImplementation(async (key: string) =>
      key === "mind-goal" ? { awarded: false, failed: true } : { awarded: true, fuel: 10 },
    );
    render(<CodexPanel graph={graph} onFocus={() => {}} spaceId="s1" />);

    // The successful claims settle and persist…
    await waitFor(() => expect(seenIds()).toContain("sector-daily"));
    expect(seenIds()).toContain("fleet-soumaya");
    // …but the failed mind-goal claim is NOT marked seen, so it can retry.
    expect(seenIds()).not.toContain("mind-goal");
    // And the failure surfaced instead of being swallowed.
    const texts = pushToast.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => /claim/i.test(t) && /retry/i.test(t))).toBe(true);
  });

  it("marks every fresh entry seen when all claims succeed", async () => {
    claimCodexReward.mockResolvedValue({ awarded: true, fuel: 10 });
    render(<CodexPanel graph={graph} onFocus={() => {}} spaceId="s1" />);

    await waitFor(() => expect(seenIds()).toContain("mind-goal"));
    expect(seenIds()).toEqual(expect.arrayContaining(["sector-daily", "mind-goal", "fleet-soumaya", "fleet-station"]));
    const texts = pushToast.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => /retry/i.test(t))).toBe(false);
  });
});
