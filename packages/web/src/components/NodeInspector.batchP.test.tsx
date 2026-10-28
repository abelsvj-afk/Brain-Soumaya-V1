import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { GraphData, GraphEdge, GraphNode } from "@brain/shared";

/**
 * Batch P — Details tab:
 *  REG-106: the derived mass % and the importance slider carry distinct
 *           names, and the copy makes their relationship predictable.
 *  REG-107 (copy half): the delete confirmation names what else is removed.
 */

vi.mock("../api/client.js", () => ({
  deleteNode: vi.fn(),
  archiveNode: vi.fn(),
  setImportance: vi.fn(),
  synthesizeNode: vi.fn(),
  answerResearch: vi.fn(),
  requestMaintenance: vi.fn(),
  ingestText: vi.fn(),
  updateNodeDetails: vi.fn(),
  getNeighbors: vi.fn(async () => ({ nodes: [], links: [] })),
}));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("./MarkdownView.js", () => ({ MarkdownView: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("./Chronicle.js", () => ({ Chronicle: () => null }));
vi.mock("./MemoryAttachments.js", () => ({ MemoryAttachments: () => null }));
vi.mock("./JourneyChips.js", () => ({ JourneyChips: () => null }));
vi.mock("./DeepDive.js", () => ({ DeepDive: () => null }));

import { NodeInspector } from "./NodeInspector.js";
import { getNeighbors } from "../api/client.js";

function node(over: Partial<GraphNode>): GraphNode {
  return {
    id: 1,
    label: "A memory",
    type: "concept",
    content: "original body",
    kind: "memory",
    celestial: "moon",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  } as GraphNode;
}

function graph(nodes: GraphNode[], links: GraphEdge[] = []): GraphData {
  return { nodes, links } as unknown as GraphData;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getNeighbors).mockResolvedValue({ nodes: [], links: [] });
});
afterEach(() => cleanup());

describe("REG-106 — mass and importance are two different names", () => {
  it("the header prints the derived figure as mass, the slider as importance", async () => {
    // importance 1.0, young + unconnected: deriveMass stays far below 100%,
    // which is exactly the confusion the old shared 'weight' label caused.
    const n = node({ importance: 1, mass: 0.42, degree: 0 });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    expect(screen.getByText(/mass 42%/)).toBeTruthy();
    expect(screen.queryByText(/weight 42%/)).toBeNull();
    expect(screen.getByText("Importance")).toBeTruthy();
    expect(screen.queryByText("Weight (gravity)")).toBeNull();
    // The copy makes the slider's relationship to the displayed figure predictable.
    expect(screen.getByText(/one ingredient in the memory's mass/i)).toBeTruthy();
  });
});

describe("REG-107 — the delete confirmation names what else goes with it", () => {
  it("names connections and attachments in the dialog's own terms", async () => {
    const n = node({ label: "Doomed" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} onDeleted={vi.fn()} />);
    await act(async () => {
      screen.getByText("🗑 Delete memory").click();
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/connections/i);
    expect(dialog.textContent).toMatch(/attachments/i);
    expect(dialog.textContent).toMatch(/permanently deleted/i);
  });
});
