import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import type { GraphData } from "@brain/shared";

/**
 * REG-047 (PG-04): Codex discoveries were neither celebrated nor paid until
 * the user happened to open the Codex panel — its claim effect was the only
 * caller. The hook below is mounted at App level, so a discovery is announced
 * and its reward claimed at the moment it first becomes true, on any surface;
 * opening the panel afterwards shows no backlog burst.
 *
 * Fail-before: there was no hook to mount outside the panel — the claim only
 * ever fired from CodexPanel.
 */
const claimCodexReward = vi.fn();
vi.mock("../api/client.js", () => ({
  claimCodexReward: (...a: unknown[]) => claimCodexReward(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Toasts.js")>();
  return { ...actual, pushToast: (...a: unknown[]) => pushToast(...a) };
});
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { buildCodex } from "./codex.js";
import { useCodexDiscoveryClaims } from "./useCodexDiscoveryClaims.js";
import type { GraphNode } from "@brain/shared";

function Probe({ graph }: { graph: GraphData }) {
  const nodes = graph.nodes as GraphNode[];
  const entries = buildCodex({
    memories: nodes.filter((n) => n.kind !== "action" && n.kind !== "moc"),
    constellations: nodes.filter((n) => n.kind === "moc"),
    links: graph.links.length,
  });
  useCodexDiscoveryClaims(entries, "s1", () => {});
  return null;
}

// One goal memory → fresh discoveries (same fixture as CodexPanel.test.tsx).
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

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  claimCodexReward.mockResolvedValue({ awarded: true, fuel: 30 });
});
afterEach(cleanup);

describe("REG-047 — Codex claims fire at App level, not only on panel open", () => {
  it("claims + toasts fresh discoveries on mount, without any panel", async () => {
    render(<Probe graph={graph} />);
    await waitFor(() => expect(claimCodexReward).toHaveBeenCalled());
    const claimed = claimCodexReward.mock.calls.map((c) => c[0] as string);
    expect(claimed.length).toBeGreaterThan(0);
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Codex: discovered"), "📖", 6000, "normal");
    expect(playSfx).toHaveBeenCalledWith("achievement");
    const seen = JSON.parse(localStorage.getItem("codex.seen.s1") || "[]") as string[];
    for (const id of claimed) expect(seen).toContain(id);
  });

  it("a second mount with the same entries claims nothing (no backlog burst)", async () => {
    const { unmount } = render(<Probe graph={graph} />);
    await waitFor(() => expect(claimCodexReward).toHaveBeenCalled());
    const firstCount = claimCodexReward.mock.calls.length;
    unmount();
    cleanup();
    claimCodexReward.mockClear();
    pushToast.mockClear();
    render(<Probe graph={graph} />);
    // Let any effect + async claim settle, then assert silence.
    await new Promise((r) => setTimeout(r, 50));
    expect(claimCodexReward).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
    expect(firstCount).toBeGreaterThan(0);
  });
});
