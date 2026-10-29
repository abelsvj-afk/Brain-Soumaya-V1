import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { InvestigationReport } from "@brain/shared";

/**
 * CL-2 (Immersion Round 2) — IM-37: the Investigator gets a face in Details.
 * POST /api/investigate (via investigateNode) with truthful idle/loading/
 * error states and cited evidence rendering.
 */

const investigateNode = vi.fn();
vi.mock("../api/client.js", () => ({
  investigateNode: (...a: unknown[]) => investigateNode(...a),
}));

import { DeepDive } from "./DeepDive.js";

const report: InvestigationReport = {
  subjectId: 1,
  subjectLabel: "Rent stress",
  researchType: "financial",
  summary: "I looked through your own memories around “Rent stress” and found 1 that connects.",
  evidence: [{ nodeId: 7, label: "Payday", why: "linked via builds_on" }],
  openQuestions: ["Which of these is the real priority?"],
};

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("IM-37 — Deep-dive surface over POST /api/investigate", () => {
  it("starts honest: no run yet, no fabricated report", () => {
    render(<DeepDive nodeId={1} nodeLabel="Rent stress" onFocus={() => {}} />);
    expect(screen.getByText("No Investigator deep-dive run in this visit yet.")).toBeTruthy();
    expect(investigateNode).not.toHaveBeenCalled();
  });

  it("runs the investigation for this node and renders the cited report", async () => {
    investigateNode.mockResolvedValue(report);
    const onFocus = vi.fn();
    render(<DeepDive nodeId={1} nodeLabel="Rent stress" onFocus={onFocus} />);
    await act(async () => {
      screen.getByText("Investigate").click();
    });
    expect(investigateNode).toHaveBeenCalledWith(1);
    await screen.findByText(/found 1 that connects/);
    expect(screen.getByText("financial")).toBeTruthy();
    // Citation: the evidence label is a fly-to button; its "why" is the citation text.
    expect(screen.getByText("linked via builds_on")).toBeTruthy();
    await act(async () => {
      screen.getByText("Payday").click();
    });
    expect(onFocus).toHaveBeenCalledWith(7);
    // The report's open questions are rendered.
    expect(screen.getByText("Which of these is the real priority?")).toBeTruthy();
  });

  it("while running it says so", async () => {
    investigateNode.mockReturnValue(new Promise(() => {}));
    render(<DeepDive nodeId={1} nodeLabel="Rent stress" onFocus={() => {}} />);
    await act(async () => {
      screen.getByText("Investigate").click();
    });
    expect(screen.getByText("Digging through your memories…")).toBeTruthy();
    expect(screen.queryByText("No Investigator deep-dive run yet for this memory.")).toBeNull();
  });

  it("a failure lands on an error surface with Retry — never inside a report body", async () => {
    investigateNode.mockRejectedValue(new Error("Memory not found"));
    render(<DeepDive nodeId={1} nodeLabel="Rent stress" onFocus={() => {}} />);
    await act(async () => {
      screen.getByText("Investigate").click();
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Memory not found");
    expect(screen.queryByText(/found .* that connects/)).toBeNull();
    // Retry actually re-runs.
    investigateNode.mockResolvedValue(report);
    await act(async () => {
      screen.getByText("Retry").click();
    });
    await waitFor(() => expect(investigateNode).toHaveBeenCalledTimes(2));
    await screen.findByText(/found 1 that connects/);
  });
});
