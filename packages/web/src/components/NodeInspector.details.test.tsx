import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import type { GraphData, GraphEdge, GraphNode } from "@brain/shared";

/**
 * CL-2 (Immersion Round 2) — Details tab items IM-26/27/28/29/30/32/33/34.
 * Each describe names the item it pins; the honesty items (32/33) assert the
 * failure render, not just the happy path.
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

import { NodeInspector, fmtWhen } from "./NodeInspector.js";
import { updateNodeDetails, synthesizeNode, deleteNode, getNeighbors } from "../api/client.js";

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

function edge(source: number, target: number, relationship: GraphEdge["relationship"], weight: number, id = source * 1000 + target): GraphEdge {
  return { id, source, target, relationship, weight, createdAt: "2026-01-01T00:00:00Z" } as GraphEdge;
}

function graph(nodes: GraphNode[], links: GraphEdge[] = []): GraphData {
  return { nodes, links } as unknown as GraphData;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getNeighbors).mockResolvedValue({ nodes: [], links: [] });
});
afterEach(() => cleanup());

describe("IM-33 — fmtWhen never leaks the raw stored timestamp", () => {
  it("falls back to a human placeholder on an unparseable value", () => {
    expect(fmtWhen("not-a-real-date")).toBe("date unavailable");
    expect(fmtWhen("not-a-real-date")).not.toContain("not-a-real-date");
  });
  it("still formats a parseable value with its year", () => {
    expect(fmtWhen("2026-01-15T10:00:00Z")).toContain("2026");
  });
});

describe("IM-27 — the object's own dates and state render in Details", () => {
  it("shows Logged, Last tended, entropy and review strength", async () => {
    const n = node({
      createdAt: "2026-01-15T10:00:00Z",
      lastTendedAt: "2026-02-20T10:00:00Z",
      entropy: 0.8,
      reviewStrength: 0.42,
    });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    expect(screen.getByText(/📥 Logged/)).toBeTruthy();
    expect(screen.getByText(/🌱 Last tended/)).toBeTruthy();
    expect(screen.getByText(/entropy 80%/)).toBeTruthy();
    expect(screen.getByText(/🧠 Review strength 42%/)).toBeTruthy();
  });
});

describe("IM-26 — label + body are editable through the node PATCH route", () => {
  it("opens an editor prefilled with label/body, saves via updateNodeDetails, and notifies onChanged", async () => {
    vi.mocked(updateNodeDetails).mockResolvedValue(node({ label: "New title", content: "new body" }));
    const onChanged = vi.fn();
    const n = node({ label: "Old title", content: "old body" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} onChanged={onChanged} />);
    await act(async () => {
      screen.getByText("✎ Edit").click();
    });
    const labelInput = screen.getByDisplayValue("Old title") as HTMLInputElement;
    const bodyInput = screen.getByDisplayValue("old body") as HTMLTextAreaElement;
    fireEvent.change(labelInput, { target: { value: "New title" } });
    fireEvent.change(bodyInput, { target: { value: "new body" } });
    await act(async () => {
      screen.getByText("Save").click();
    });
    await waitFor(() => expect(updateNodeDetails).toHaveBeenCalledWith(1, { label: "New title", content: "new body" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(1));
    // Editor closed after a successful save.
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("a failed save stays in the editor with the error visible — never closes as if saved", async () => {
    vi.mocked(updateNodeDetails).mockRejectedValue(new Error("Update failed (500)"));
    const n = node({ label: "Old title" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await act(async () => {
      screen.getByText("✎ Edit").click();
    });
    await act(async () => {
      screen.getByText("Save").click();
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Update failed (500)");
    expect(screen.getByText("Save")).toBeTruthy(); // still editing
  });
});

describe("IM-28 — neighbours show relationship + weight, sourced from the neighbors endpoint", () => {
  it("renders edge semantics from the graph and calls GET /nodes/:id/neighbors", async () => {
    const a = node({ id: 2, label: "Builder" });
    const b = node({ id: 3, label: "Contradictor" });
    const n = node({ id: 1 });
    const g = graph([n, a, b], [edge(1, 2, "builds_on", 0.9, 11), edge(3, 1, "contradicts", 0.3, 12)]);
    render(<NodeInspector node={n} graph={g} onFocus={() => {}} />);
    expect(screen.getByText(/builds on · 90%/)).toBeTruthy();
    expect(screen.getByText(/contradicts · 30%/)).toBeTruthy();
    expect(getNeighbors).toHaveBeenCalledWith(1, 1);
  });

  it("the endpoint's answer replaces the graph's edge semantics when it lands", async () => {
    const a = node({ id: 2, label: "Builder" });
    const n = node({ id: 1 });
    vi.mocked(getNeighbors).mockResolvedValue({
      nodes: [n, a],
      links: [edge(1, 2, "caused_by", 0.55, 21)],
    });
    const g = graph([n, a], [edge(1, 2, "builds_on", 0.9, 11)]);
    render(<NodeInspector node={n} graph={g} onFocus={() => {}} />);
    await screen.findByText(/caused by · 55%/);
    expect(screen.queryByText(/builds on · 90%/)).toBeNull();
  });
});

describe("IM-30 — neighbour overflow is expandable, everything stays reachable", () => {
  it("caps the first screen at 40 and expands to all 45 on demand", async () => {
    const hub = node({ id: 1, label: "Hub" });
    const others = Array.from({ length: 45 }, (_, i) => node({ id: i + 2, label: `Neighbour ${i + 2}` }));
    const links = others.map((o, i) => edge(1, o.id, "relates_to", 0.5, 100 + i));
    render(<NodeInspector node={hub} graph={graph([hub, ...others], links)} onFocus={() => {}} />);
    expect(screen.getByText(/\+5 more — show all 45/)).toBeTruthy();
    expect(screen.queryByText("Neighbour 46")).toBeNull();
    await act(async () => {
      screen.getByText(/\+5 more — show all 45/).click();
    });
    expect(screen.getByText("Neighbour 46")).toBeTruthy();
    expect(screen.getByText("Show fewer connections")).toBeTruthy();
  });
});

describe("IM-29 — research answers, hub members and belief evidence are re-shown", () => {
  it("re-renders researchAnswers after the questions have cleared", async () => {
    const n = node({ researchAnswers: { "What year was this?": "Back in 2019." } });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    expect(screen.getByText("🛸 Your earlier answers")).toBeTruthy();
    expect(screen.getByText("What year was this?")).toBeTruthy();
    expect(screen.getByText("Back in 2019.")).toBeTruthy();
  });

  it("a hub shows its memberCount and a fly-to member list from its summarizes edges", async () => {
    const onFocus = vi.fn();
    const hub = node({ id: 1, kind: "moc", label: "Hub", memberCount: 3 });
    const m1 = node({ id: 2, label: "Member One" });
    const m2 = node({ id: 3, label: "Member Two" });
    const g = graph([hub, m1, m2], [edge(1, 2, "summarizes", 0.9, 31), edge(1, 3, "summarizes", 0.85, 32)]);
    render(<NodeInspector node={hub} graph={g} onFocus={onFocus} />);
    expect(screen.getByText(/🌌 3 members in this constellation/)).toBeTruthy();
    expect(screen.getByText("🌌 Members (3)")).toBeTruthy();
    // "Member One" also appears in the Connected list below — the members
    // drill-in is the first of the matches.
    await act(async () => {
      screen.getAllByText("Member One")[0]!.click();
    });
    expect(onFocus).toHaveBeenCalledWith(2);
  });

  it("a belief drills into the evidence it summarizes", async () => {
    const belief = node({ id: 1, kind: "belief", label: "A belief" });
    const ev = node({ id: 2, label: "Supporting memory" });
    const g = graph([belief, ev], [edge(1, 2, "summarizes", 0.85, 41)]);
    render(<NodeInspector node={belief} graph={g} onFocus={() => {}} />);
    expect(screen.getByText("🖤 Evidence she drew on (1)")).toBeTruthy();
    // Present in the evidence drill-in (and again in Connected, which is fine).
    expect(screen.getAllByText("Supporting memory").length).toBeGreaterThan(0);
  });
});

describe("IM-32 — synthesis failure goes to an error surface, never the insight body", () => {
  it("a rejected synthesis renders an alert and no insight text", async () => {
    vi.mocked(synthesizeNode).mockRejectedValue(new Error("Synthesis failed (503)"));
    const n = node({ label: "An idea" });
    const { container } = render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} />);
    await act(async () => {
      screen.getByText("✨ Connect the dots").click();
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Synthesis failed (503)");
    expect(container.querySelector(".insight-text")).toBeNull();
    expect(screen.queryByText(/couldn't synthesize/)).toBeNull();
  });
});

describe("IM-34 — node delete confirms through the app dialog, not window.confirm", () => {
  it("opens the dialog first; deleting only happens on confirm", async () => {
    vi.mocked(deleteNode).mockResolvedValue(undefined);
    // jsdom has no native confirm to spy on — install a trap: if the component
    // still used window.confirm, this records it.
    const confirmSpy = vi.fn(() => true);
    (window as unknown as { confirm: unknown }).confirm = confirmSpy;
    const onDeleted = vi.fn();
    const n = node({ label: "Doomed" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} onDeleted={onDeleted} />);
    await act(async () => {
      screen.getByText("🗑 Delete memory").click();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(deleteNode).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    await act(async () => {
      screen.getByText("Delete").click();
    });
    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("cancelling the dialog deletes nothing", async () => {
    const n = node({ label: "Safe" });
    render(<NodeInspector node={n} graph={graph([n])} onFocus={() => {}} onDeleted={vi.fn()} />);
    await act(async () => {
      screen.getByText("🗑 Delete memory").click();
    });
    await act(async () => {
      screen.getByText("Cancel").click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteNode).not.toHaveBeenCalled();
  });
});
