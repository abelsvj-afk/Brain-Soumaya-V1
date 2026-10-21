import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { GraphData, GraphNode } from "@brain/shared";

vi.mock("../api/client.js", () => ({
  deleteNode: vi.fn(),
  archiveNode: vi.fn(),
  setImportance: vi.fn(),
  synthesizeNode: vi.fn(),
  answerResearch: vi.fn(),
  requestMaintenance: vi.fn(),
  ingestText: vi.fn(),
  // CL-2 (IM-26/IM-28): the inspector now also PATCHes details and calls the
  // neighbors endpoint on mount.
  updateNodeDetails: vi.fn(),
  getNeighbors: vi.fn(async () => ({ nodes: [], links: [] })),
}));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("./MarkdownView.js", () => ({ MarkdownView: () => null }));
vi.mock("./Chronicle.js", () => ({ Chronicle: () => null }));
vi.mock("./MemoryAttachments.js", () => ({ MemoryAttachments: () => null }));
vi.mock("./JourneyChips.js", () => ({ JourneyChips: () => null }));

import { NodeInspector } from "./NodeInspector.js";
import { synthesizeNode, ingestText, archiveNode } from "../api/client.js";

function node(over: Partial<GraphNode>): GraphNode {
  return {
    id: 1,
    label: "A memory",
    type: "concept",
    content: "",
    kind: "memory",
    celestial: "moon",
    createdAt: "2026-01-01 00:00:00",
    ...over,
  } as GraphNode;
}

function graph(nodes: GraphNode[]): GraphData {
  return { nodes, links: [] } as unknown as GraphData;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("NodeInspector — a memory leveling up into a new tier is celebrated", () => {
  it("does not celebrate the tier a memory already has on first view", async () => {
    const n = node({ id: 1, label: "Growing idea", celestial: "moon" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await screen.findByText("Growing idea");
    expect(playSfx).not.toHaveBeenCalled();
  });

  it("plays a milestone sound when the SAME memory is later seen in a higher tier", async () => {
    const moon = node({ id: 1, label: "Growing idea", celestial: "moon" });
    const { rerender } = render(<NodeInspector node={moon} graph={graph([moon])} onFocus={() => {}} />);
    await screen.findByText("Growing idea");
    expect(playSfx).not.toHaveBeenCalled();

    const planet = node({ id: 1, label: "Growing idea", celestial: "planet" });
    rerender(<NodeInspector node={planet} graph={graph([planet])} onFocus={() => {}} />);
    expect(playSfx).toHaveBeenCalledWith("milestone");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Growing idea"), "✨", expect.any(Number));
  });

  it("does not celebrate a memory that drops back down a tier", async () => {
    const planet = node({ id: 1, label: "Cooling idea", celestial: "planet" });
    const { rerender } = render(<NodeInspector node={planet} graph={graph([planet])} onFocus={() => {}} />);
    await screen.findByText("Cooling idea");

    const moon = node({ id: 1, label: "Cooling idea", celestial: "moon" });
    rerender(<NodeInspector node={moon} graph={graph([moon])} onFocus={() => {}} />);
    expect(playSfx).not.toHaveBeenCalled();
  });
});

describe("NodeInspector — a synthesis insight is no longer a dead end", () => {
  it("offers to save the insight as a memory, then disables once saved", async () => {
    vi.mocked(synthesizeNode).mockResolvedValue({ text: "This connects to your goal of X.", connected: 2 });
    vi.mocked(ingestText).mockResolvedValue({ nodes: [{ id: 9 }] } as never);
    const n = node({ id: 1, label: "An idea" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    const connectBtn = await screen.findByText("✨ Connect the dots");
    await act(async () => { connectBtn.click(); });
    await screen.findByText("This connects to your goal of X.");

    const saveBtn = screen.getByText("★ Save as memory");
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalledTimes(1));
    expect(ingestText).toHaveBeenCalledWith(expect.stringContaining("This connects to your goal of X."));
    const savedBtn = await screen.findByText("✓ Saved");
    expect(savedBtn.getAttribute("disabled")).not.toBeNull();
  });
});

// Life Vision (docs/specs/life-vision.md, C2.1/C3.2-locked): remindAt is a passive,
// harmless display here (it never fires anything) but must never be MISLABELED as a
// reminder for a Vision, since C3.2 now lets a Vision actually carry a remindAt value.
describe("NodeInspector — remindAt label reflects what it actually means for this node's kind", () => {
  it("labels a life_vision's remindAt as a target date, not a reminder", async () => {
    const n = node({ id: 1, kind: "life_vision", label: "Our first house", remindAt: "2030-06-01T00:00:00Z" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/🌅 Target date/)).toBeTruthy();
    expect(screen.queryByText(/⏰ Reminder/)).toBeNull();
  });

  it("still labels every other kind's remindAt as a Reminder (regression)", async () => {
    const n = node({ id: 1, kind: "memory", label: "Call the landlord", remindAt: "2030-06-01T00:00:00Z" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await screen.findByText("Call the landlord");
    expect(screen.getByText(/⏰ Reminder/)).toBeTruthy();
    expect(screen.queryByText(/🌅 Target date/)).toBeNull();
  });
});

// Life Vision (docs/specs/life-vision.md, C3.3): the archive control widened to cover
// this kind, reusing the existing archive mechanism verbatim (no new archive system).
describe("NodeInspector — Life Vision archive", () => {
  it("shows an Archive control for a life_vision node and calls the existing archiveNode()", async () => {
    vi.mocked(archiveNode).mockResolvedValue(true);
    const onDeleted = vi.fn();
    const n = node({ id: 1, kind: "life_vision", label: "Our first house" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} onDeleted={onDeleted} />);
    await screen.findByText("Our first house");
    const archiveBtn = screen.getByText("📥 Archive Life Vision");
    await act(async () => { archiveBtn.click(); });
    await waitFor(() => expect(archiveNode).toHaveBeenCalledWith(1, true));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("does not show an Archive control for a Mind Goal (regression — gate unchanged for other cognitive kinds)", async () => {
    const n = node({ id: 1, kind: "goal", label: "Run a 5k" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} onDeleted={vi.fn()} />);
    await screen.findByText("Run a 5k");
    expect(screen.queryByText(/📥 Archive/)).toBeNull();
  });

  it("still shows the plain-memory archive copy for kind:null (regression)", async () => {
    const n = node({ id: 1, kind: undefined, label: "A plain memory" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} onDeleted={vi.fn()} />);
    await screen.findByText("A plain memory");
    expect(screen.getByText("📥 Archive (rest it)")).toBeTruthy();
  });
});

// Phase M (docs/specs/soumaya-product-audit.md, "NodeInspector identity") — every cognitive
// kind used to collapse to one generic "Concept" chip; it now reuses COGNITIVE_META (the SAME
// single source of truth the galaxy renderer/Legend/Mind panel already use — no new metadata).
describe("NodeInspector — cognitive kind identity (Phase M)", () => {
  it("a Life Vision shows its own icon/label, not the generic Concept chip", async () => {
    const n = node({ id: 1, kind: "life_vision", type: "concept", label: "Own a small fleet" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await screen.findByText("Own a small fleet");
    expect(screen.getByText("🌅 Life Vision")).toBeTruthy();
    expect(screen.queryByText("Concept")).toBeNull();
  });

  it("a Mind Goal shows its own icon/label, distinct from a Life Vision", async () => {
    const n = node({ id: 1, kind: "goal", type: "concept", label: "Run a 5k" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getByText("🎯 Goal")).toBeTruthy();
    expect(screen.queryByText("🌅 Life Vision")).toBeNull();
    expect(screen.queryByText("Concept")).toBeNull();
  });

  it("a plain memory (no cognitive kind) is unaffected — still the generic type chip", async () => {
    const n = node({ id: 1, kind: undefined, type: "concept", label: "A regular thought" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await screen.findByText("A regular thought");
    expect(screen.getByText("Concept")).toBeTruthy();
  });

  it("belief/moc special-cases are unaffected (regression)", async () => {
    const belief = node({ id: 1, kind: "belief", label: "A belief" });
    const { rerender } = render(<NodeInspector node={belief} graph={graph([belief])} onFocus={() => {}} />);
    await screen.findByText("A belief");
    expect(screen.getByText("🖤 Belief she formed")).toBeTruthy();

    const moc = node({ id: 1, kind: "moc", label: "A hub" });
    rerender(<NodeInspector node={moc} graph={graph([moc])} onFocus={() => {}} />);
    expect(screen.getByText("🌌 Constellation")).toBeTruthy();
  });

  it("shows a read-only progress bar for a kind with hasProgress, none for one without", async () => {
    const goal = node({ id: 1, kind: "goal", label: "Run a 5k", progress: 0.4 });
    const { container, rerender } = render(<NodeInspector node={goal} graph={graph([goal])} onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(container.querySelector(".mind-progress .mind-pct")?.textContent).toBe("40%");

    const idea = node({ id: 1, kind: "idea", label: "A new idea", progress: 0.4 });
    rerender(<NodeInspector node={idea} graph={graph([idea])} onFocus={() => {}} />);
    await screen.findByText("A new idea");
    expect(container.querySelector(".mind-progress")).toBeNull(); // idea has no hasProgress in COGNITIVE_META
  });

  it("a skill's progress bar also shows its mastery tier", async () => {
    const skill = node({ id: 1, kind: "skill", label: "Spanish", progress: 0.75 });
    render(<NodeInspector node={skill} graph={graph([skill])} onFocus={() => {}} />);
    await screen.findByText("Spanish");
    expect(screen.getByText("Skilled")).toBeTruthy(); // skillTier(0.75) === "Skilled"
  });
});
