import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { GraphData, GraphNode } from "@brain/shared";

const getConstellations = vi.fn();
const getVisitorActivity = vi.fn();
const getArchivedNodes = vi.fn();
const archiveNode = vi.fn();
const searchDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  getConstellations: (...a: unknown[]) => getConstellations(...a),
  getVisitorActivity: (...a: unknown[]) => getVisitorActivity(...a),
  useProcessingNodes: () => new Set<number>(),
  getArchivedNodes: (...a: unknown[]) => getArchivedNodes(...a),
  archiveNode: (...a: unknown[]) => archiveNode(...a),
  searchDetailed: (...a: unknown[]) => searchDetailed(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { NodeList } from "./NodeList.js";
import { LibraryPanel } from "./LibraryPanel.js";
import { SectorView } from "./SectorView.js";
import { SearchBox } from "./SearchBox.js";
import { CommandPalette } from "./CommandPalette.js";

function node(over: Partial<GraphNode>): GraphNode {
  return {
    id: 1,
    label: "A memory",
    type: "concept",
    content: "",
    createdAt: "2026-01-01 00:00:00",
    ...over,
  } as GraphNode;
}

function graph(nodes: GraphNode[]): GraphData {
  return { nodes, links: [] } as unknown as GraphData;
}

beforeEach(() => {
  vi.resetAllMocks();
  getConstellations.mockResolvedValue([]);
  getVisitorActivity.mockResolvedValue([]);
  getArchivedNodes.mockResolvedValue([]);
  searchDetailed.mockResolvedValue({ hits: [] });
});
afterEach(() => cleanup());

describe("Batch F — REG-114: the tag facet discloses and reveals beyond 12", () => {
  it("shows '+N more tags' and reveals the rest on click", async () => {
    const nodes = Array.from({ length: 14 }, (_, i) =>
      node({ id: i + 1, label: `Memory ${i + 1}`, tags: [`tag${i + 1}`] }),
    );
    render(<NodeList nodes={nodes} onFocus={() => {}} />);
    await screen.findByText("Memory 1");
    expect(screen.getByText("+2 more tags")).toBeTruthy();
    expect(screen.queryByTitle("Filter by tag #tag13 (1 memories)")).toBeNull();
    act(() => screen.getByText("+2 more tags").click());
    expect(screen.getByTitle("Filter by tag #tag13 (1 memories)")).toBeTruthy();
    expect(screen.getByTitle("Filter by tag #tag14 (1 memories)")).toBeTruthy();
    // A 13th-ranked tag is filter-reachable once revealed.
    act(() => screen.getByTitle("Filter by tag #tag13 (1 memories)").click());
    expect(screen.getByText("Memory 13")).toBeTruthy();
    expect(screen.queryByText("Memory 1")).toBeNull();
  });
});

describe("Batch F — REG-115: unscored memories show no emotion label", () => {
  it("NodeList renders no emotion dot/label for a memory with no weight", async () => {
    const { container } = render(
      <NodeList
        nodes={[node({ id: 1, label: "No score" }), node({ id: 2, label: "Scored neutral", emotionalWeight: 0 })]}
        onFocus={() => {}}
      />,
    );
    await screen.findByText("No score");
    // Exactly one emotion span: the scored-neutral row. The unscored row has none.
    expect(container.querySelectorAll('[title="neutral feeling"]')).toHaveLength(1);
    expect(container.querySelectorAll('[title="warm feeling"]')).toHaveLength(0);
    expect(container.querySelectorAll('[title="heavy feeling"]')).toHaveLength(0);
  });

  it("NodeList's neutral filter excludes unscored memories", async () => {
    render(
      <NodeList
        nodes={[node({ id: 1, label: "No score" }), node({ id: 2, label: "Scored neutral", emotionalWeight: 0 })]}
        onFocus={() => {}}
      />,
    );
    await screen.findByText("No score");
    const select = screen.getByTitle("Emotional signature");
    fireEvent.change(select, { target: { value: "neutral" } });
    expect(screen.queryByText("No score")).toBeNull();
    expect(screen.getByText("Scored neutral")).toBeTruthy();
  });

  it("LibraryPanel renders no emotion label for a memory with no weight", async () => {
    const { container } = render(
      <LibraryPanel graph={graph([node({ id: 1, label: "No score" })])} onFocus={() => {}} />,
    );
    // Folders start closed — open the (first, only) folder header.
    const header = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(header).not.toBeNull();
    act(() => fireEvent.click(header!));
    await screen.findByText("No score");
    expect(container.querySelector('[title="neutral feeling"]')).toBeNull();
  });

  it("SectorView shows no tone for an all-unscored hub, and a real tone when scored", async () => {
    const unscored: GraphData = {
      nodes: [
        node({ id: 1, label: "Hub", mass: 0.9 }),
        node({ id: 2, label: "Member one", mass: 0.1 }),
      ],
      links: [{ source: 1, target: 2 }],
    } as unknown as GraphData;
    const { container, unmount } = render(<SectorView graph={unscored} onFocus={() => {}} onIsolate={() => {}} />);
    await screen.findByText("Hub");
    expect(container.querySelector('[title="emotional tone"]')).toBeNull();
    unmount();
    const scored: GraphData = {
      nodes: [
        node({ id: 1, label: "Hub", mass: 0.9 }),
        node({ id: 2, label: "Member one", mass: 0.1, emotionalWeight: 0.9 }),
      ],
      links: [{ source: 1, target: 2 }],
    } as unknown as GraphData;
    render(<SectorView graph={scored} onFocus={() => {}} onIsolate={() => {}} />);
    expect(await screen.findByText("warm")).toBeTruthy();
  });
});

describe("Batch F — REG-118: text search matches tags in All and Folders", () => {
  it("NodeList finds a memory by its tag alone", async () => {
    render(
      <NodeList
        nodes={[
          node({ id: 1, label: "Trip notes", content: "scribbles from the road", tags: ["paris-trip"] }),
          node({ id: 2, label: "Other note", content: "nothing relevant" }),
        ]}
        onFocus={() => {}}
      />,
    );
    const input = await screen.findByPlaceholderText(/Search/);
    fireEvent.change(input, { target: { value: "paris" } });
    expect(screen.getByText("Trip notes")).toBeTruthy();
    expect(screen.queryByText("Other note")).toBeNull();
  });

  it("LibraryPanel finds a folder's memory by its tag alone", async () => {
    render(
      <LibraryPanel
        graph={graph([
          node({ id: 1, label: "Trip notes", type: "person", content: "scribbles", tags: ["paris-trip"] }),
          node({ id: 2, label: "Other note", type: "person", content: "nothing relevant" }),
        ])}
        onFocus={() => {}}
      />,
    );
    const input = await screen.findByPlaceholderText(/Search/);
    fireEvent.change(input, { target: { value: "paris" } });
    expect(screen.getByText("Trip notes")).toBeTruthy();
    expect(screen.queryByText("Other note")).toBeNull();
  });
});

describe("Batch F — REG-119: the reminder strip's ellipsis only after a real truncation", () => {
  it("a short label renders without '...'", async () => {
    const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    render(<NodeList nodes={[node({ id: 1, label: "Call mom", remindAt: soon })]} onFocus={() => {}} />);
    await screen.findByText(/Reminder incoming/);
    expect(screen.getByText(/"Call mom"/)).toBeTruthy();
    expect(screen.queryByText(/Call mom\.\.\./)).toBeNull();
  });

  it("a long label still truncates with '...'", async () => {
    const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const long = "A very long reminder label that exceeds thirty characters for sure";
    render(<NodeList nodes={[node({ id: 1, label: long, remindAt: soon })]} onFocus={() => {}} />);
    await screen.findByText(/Reminder incoming/);
    expect(screen.getByText(/A very long reminder label tha\.\.\./)).toBeTruthy();
  });
});

describe("Batch F — REG-113: a per-folder export contains the whole folder", () => {
  it("exports all folder members even while a filter matches only one", async () => {
    const blobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:x";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    try {
      render(
        <LibraryPanel
          graph={graph([
            node({ id: 1, label: "Alpha person", type: "person" }),
            node({ id: 2, label: "Beta person", type: "person" }),
            node({ id: 3, label: "Gamma person", type: "person" }),
          ])}
          onFocus={() => {}}
        />,
      );
      const input = await screen.findByPlaceholderText(/Search/);
      fireEvent.change(input, { target: { value: "alpha" } });
      expect(screen.getByText("Alpha person")).toBeTruthy();
      expect(screen.queryByText("Beta person")).toBeNull();
      const btn = await screen.findByTitle("Export the full People folder as Markdown (3 memories)");
      act(() => btn.click());
      expect(blobs).toHaveLength(1);
      const text = await blobs[0]!.text();
      expect(text).toContain("Alpha person");
      expect(text).toContain("Beta person");
      expect(text).toContain("Gamma person");
      expect(text).toContain("_3 memories");
    } finally {
      URL.createObjectURL = origCreate;
    }
  });
});

describe("Batch F — REG-116: Folders bounds long contents like All", () => {
  it("caps a folder's rendered rows at 100 with a '+N more' disclosure", async () => {
    const nodes = Array.from({ length: 120 }, (_, i) =>
      node({ id: i + 1, label: `Person ${i + 1}`, type: "person" }),
    );
    const { container } = render(<LibraryPanel graph={graph(nodes)} onFocus={() => {}} />);
    // The folder label text also appears in the kind-filter <option>, so open
    // the folder via its header button instead of by text.
    const header = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(header).not.toBeNull();
    act(() => fireEvent.click(header!));
    // Wait on the cap disclosure itself (row order is date-sort dependent
    // when every node shares one date, so no single label is waited on).
    await screen.findByText("+20 more in People — narrow your search or filters to see them");
    expect(container.querySelectorAll(".pill")).toHaveLength(100);
  });
});

describe("Batch F — REG-185: no invented percentage on search hits", () => {
  it("SearchBox names the match kind instead of a percentage", async () => {
    searchDetailed.mockResolvedValue({
      hits: [
        { id: 1, label: "Keyword hit", type: "concept", similarity: null, matchKind: "keyword" },
        { id: 2, label: "Both hit", type: "concept", similarity: 0.87, matchKind: "both" },
      ],
    });
    const { container } = render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => {
      fireEvent.change(input, { target: { value: "hello" } });
      fireEvent.submit(input.closest("form")!);
    });
    await screen.findByText("Keyword hit");
    expect(screen.getByText("keyword match")).toBeTruthy();
    expect(screen.getByText("keyword · semantic")).toBeTruthy();
    expect(container.textContent).not.toContain("%");
  });

  it("CommandPalette names the match kind instead of a percentage", async () => {
    searchDetailed.mockResolvedValue({
      hits: [{ id: 42, label: "The lighthouse idea", type: "concept", similarity: null, matchKind: "keyword" }],
    });
    render(<CommandPalette onClose={() => {}} onCommand={() => {}} onFocusNode={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search memories or jump to/), { target: { value: "lighthouse" } });
    await screen.findByText("The lighthouse idea", undefined, { timeout: 3000 });
    expect(screen.getByText("keyword match")).toBeTruthy();
  });
});

describe("Batch F — REG-186: the top-k page says when more matches exist", () => {
  it("SearchBox shows 'Top N of M matches' when the envelope says so", async () => {
    searchDetailed.mockResolvedValue({
      hits: [{ id: 1, label: "First", type: "concept", similarity: null, matchKind: "keyword" }],
      total: 3,
      hasMore: true,
      totalCapped: false,
    });
    render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => {
      fireEvent.change(input, { target: { value: "hello" } });
      fireEvent.submit(input.closest("form")!);
    });
    await screen.findByText("Top 1 of 3 matches");
  });

  it("SearchBox says 'more than N' when the total is a lower bound", async () => {
    searchDetailed.mockResolvedValue({
      hits: [{ id: 1, label: "First", type: "concept", similarity: null, matchKind: "keyword" }],
      total: 47,
      hasMore: true,
      totalCapped: true,
    });
    render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => {
      fireEvent.change(input, { target: { value: "hello" } });
      fireEvent.submit(input.closest("form")!);
    });
    await screen.findByText("Top 1 shown — more than 47 matches exist");
  });

  it("CommandPalette shows the same disclosure", async () => {
    searchDetailed.mockResolvedValue({
      hits: [{ id: 42, label: "The lighthouse idea", type: "concept", similarity: null, matchKind: "keyword" }],
      total: 12,
      hasMore: true,
      totalCapped: false,
    });
    render(<CommandPalette onClose={() => {}} onCommand={() => {}} onFocusNode={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search memories or jump to/), { target: { value: "lighthouse" } });
    await screen.findByText("Top 1 of 12 matches", undefined, { timeout: 3000 });
  });
});
