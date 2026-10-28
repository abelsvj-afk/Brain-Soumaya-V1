import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * Batch N — REG-152 / INS-05 (naming half): the two systems that share the
 * name "deep-dive" must be distinguishable on the surface. The Investigator
 * (Details — internal, cited, free) is named as the Investigator; Research
 * Mode research (paid, gated, persistent, mutating) is named as Research
 * Mode research. The reachability half (where past reports live) is a
 * genuine fork — see ~/workspace/ui-audit/reg152-investigations-reachability-design-note.md —
 * and is NOT built here.
 */

const investigateNode = vi.fn();
vi.mock("../api/client.js", () => ({
  investigateNode: (...a: unknown[]) => investigateNode(...a),
}));

import { DeepDive } from "./DeepDive.js";

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("REG-152 / INS-05 — the Investigator names itself", () => {
  it("the heading says Investigator deep-dive, and the hint separates it from Research Mode research", () => {
    render(<DeepDive nodeId={1} nodeLabel="Rent stress" onFocus={() => {}} />);
    expect(screen.getByRole("heading", { name: /Investigator deep-dive/ })).toBeTruthy();
    expect(screen.getByText(/Research Mode research/)).toBeTruthy();
    expect(screen.getByText(/free/i)).toBeTruthy();
  });

  it("the empty copy names the Investigator, not a bare deep-dive", () => {
    render(<DeepDive nodeId={1} nodeLabel="Rent stress" onFocus={() => {}} />);
    expect(screen.getByText(/No Investigator deep-dive run yet/)).toBeTruthy();
    expect(screen.queryByText("No deep-dive run yet for this memory.")).toBeNull();
  });
});
