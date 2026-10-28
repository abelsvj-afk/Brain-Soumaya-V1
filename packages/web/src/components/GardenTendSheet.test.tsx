import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { GraphData, GraphNode } from "@brain/shared";

const tendGardenPlot = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(undefined));
vi.mock("../api/garden.js", () => ({ tendGardenPlot: (...a: unknown[]) => tendGardenPlot(...a) }));
const search = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve([]));
vi.mock("../api/client.js", () => ({ search: (...a: unknown[]) => search(...a) }));

import { GardenTendSheet } from "./GardenTendSheet.js";

const node = {
  id: 42,
  label: "A quiet memory",
  type: "memory",
  content: "A quiet memory",
  createdAt: "2026-01-01T00:00:00.000Z",
} as unknown as GraphNode;
const graph = { nodes: [node], links: [] } as GraphData;

beforeEach(() => {
  vi.resetAllMocks();
  search.mockImplementation(() => Promise.resolve([]));
});
afterEach(() => cleanup());

function renderSheet(onTended: (r: unknown) => void = () => {}) {
  return render(<GardenTendSheet node={node} graph={graph} onClose={() => {}} onTended={onTended as never} />);
}

describe("GardenTendSheet (Verb 1)", () => {
  it("states the fuel deal honestly before tending: edits earn +6, visits earn nothing", () => {
    renderSheet();
    expect(screen.getByText(/Tending with an edit or a link earns \+6 fuel as Mind work/)).toBeTruthy();
    fireEvent.click(screen.getByText("🌿 Just visit"));
    expect(screen.getByText("A visit earns no fuel — just warmth.")).toBeTruthy();
  });

  it("a line tend sends the line and reports the fuel it earned", async () => {
    const onTended = vi.fn();
    tendGardenPlot.mockResolvedValue({
      ok: true,
      node: { id: 42 },
      tend: { id: 1, nodeId: 42, kind: "line", targetNodeId: 99, edgeId: 7, changed: null, createdAt: "2026-10-27T00:00:00.000Z" },
      fuelEarned: 6,
      fuel: 42,
      newNodeId: 99,
      edgeId: 7,
    });
    renderSheet(onTended);
    fireEvent.change(screen.getByPlaceholderText("A line to add to this memory…"), {
      target: { value: "A new line on an old memory." },
    });
    fireEvent.click(screen.getByText("Tend it"));
    await waitFor(() => expect(tendGardenPlot).toHaveBeenCalledWith({ nodeId: 42, mode: "line", text: "A new line on an old memory.", targetId: undefined, changed: undefined }));
    expect(onTended).toHaveBeenCalled();
    expect(screen.getByText(/\+6 fuel — Soumaya noted the tend, and the plot is warm\./)).toBeTruthy();
  });

  it("a visit that earns 0 says so plainly — no guilt, no failure", async () => {
    tendGardenPlot.mockResolvedValue({
      ok: true,
      node: { id: 42 },
      tend: { id: 2, nodeId: 42, kind: "visit", targetNodeId: null, edgeId: null, changed: null, createdAt: "2026-10-27T00:00:00.000Z" },
      fuelEarned: 0,
      fuel: 42,
    });
    renderSheet();
    fireEvent.click(screen.getByText("🌿 Just visit"));
    fireEvent.click(screen.getByText("Sit with it"));
    await waitFor(() => expect(tendGardenPlot).toHaveBeenCalledWith({ nodeId: 42, mode: "visit", text: undefined, targetId: undefined, changed: undefined }));
    expect(screen.getByText("Sat with it. The plot is warm.")).toBeTruthy();
  });

  it("a tend past the cap says the fuel is used up — and that the tend still counted", async () => {
    tendGardenPlot.mockResolvedValue({
      ok: true,
      node: { id: 42 },
      tend: { id: 3, nodeId: 42, kind: "affirm", targetNodeId: null, edgeId: null, changed: false, createdAt: "2026-10-27T00:00:00.000Z" },
      fuelEarned: 0,
      fuel: 42,
    });
    renderSheet();
    fireEvent.click(screen.getByText("✓ Still true?"));
    fireEvent.click(screen.getByText("Still true"));
    fireEvent.click(screen.getByText("Tend it"));
    await waitFor(() =>
      expect(tendGardenPlot).toHaveBeenCalledWith({ nodeId: 42, mode: "affirm", text: undefined, targetId: undefined, changed: false }),
    );
    expect(screen.getByText(/The Mind fuel for today is used up — the tend still counted, and the plot is warm\./)).toBeTruthy();
  });

  it("a failed save keeps the sheet open with the words intact", async () => {
    tendGardenPlot.mockRejectedValue(new Error("tend failed (500)"));
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText("A line to add to this memory…"), {
      target: { value: "Words that must not be lost." },
    });
    fireEvent.click(screen.getByText("Tend it"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect((screen.getByPlaceholderText("A line to add to this memory…") as HTMLTextAreaElement).value).toBe(
      "Words that must not be lost.",
    );
  });
});
