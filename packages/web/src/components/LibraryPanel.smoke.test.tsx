import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { GraphData, GraphNode } from "@brain/shared";

const getArchivedNodes = vi.fn();
const archiveNode = vi.fn();
vi.mock("../api/client.js", () => ({
  getArchivedNodes: (...a: unknown[]) => getArchivedNodes(...a),
  archiveNode: (...a: unknown[]) => archiveNode(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { LibraryPanel } from "./LibraryPanel.js";

function node(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "A memory", type: "concept", kind: "node", createdAt: "2026-01-01", ...over } as GraphNode;
}

function graph(nodes: GraphNode[]): GraphData {
  return { nodes, links: [] } as unknown as GraphData;
}

beforeEach(() => {
  vi.resetAllMocks();
  getArchivedNodes.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("LibraryPanel — export failure surfaces a toast instead of doing nothing", () => {
  it("toasts when the browser blocks the 'Export all' download", async () => {
    // download() catches internally on any thrown step and returns false — reproduce
    // that by making URL.createObjectURL throw, the way a restricted context would.
    const orig = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => { throw new Error("blocked"); }) as unknown as typeof URL.createObjectURL;
    try {
      render(<LibraryPanel graph={graph([node({ id: 1 })])} onFocus={() => {}} />);
      const btn = await screen.findByTitle("Download every memory as Markdown");
      act(() => btn.click());
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't export"), "⚠️", expect.any(Number));
    } finally {
      URL.createObjectURL = orig;
    }
  });

  it("does not toast when the download succeeds", async () => {
    URL.createObjectURL = vi.fn(() => "blob:ok") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    render(<LibraryPanel graph={graph([node({ id: 1 })])} onFocus={() => {}} />);
    const btn = await screen.findByTitle("Download every memory as Markdown");
    act(() => btn.click());
    expect(pushToast).not.toHaveBeenCalled();
  });
});

describe("LibraryPanel — restore failure surfaces a toast instead of doing nothing", () => {
  it("toasts when archiveNode(id, false) fails during a restore", async () => {
    getArchivedNodes.mockResolvedValue([node({ id: 9, label: "Resting memory" })]);
    archiveNode.mockResolvedValue(false);
    render(<LibraryPanel graph={graph([node({ id: 1 })])} onFocus={() => {}} />);

    const archivedHeader = await screen.findByText("📥 Archived");
    act(() => archivedHeader.click());
    const restoreBtn = await screen.findByText("↩ Restore");
    await act(async () => { restoreBtn.click(); await Promise.resolve(); });

    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't restore"), "⚠️", expect.any(Number));
  });
});

describe("LibraryPanel — a failed archived-list fetch is retryable, not permanent", () => {
  it("shows a Retry option (not a fake empty list) after the fetch fails, and recovers", async () => {
    getArchivedNodes.mockRejectedValueOnce(new Error("network down"));
    render(<LibraryPanel graph={graph([node({ id: 1 })])} onFocus={() => {}} />);

    const archivedHeader = await screen.findByText("📥 Archived");
    act(() => archivedHeader.click());
    await screen.findByText(/Couldn't load your archived memories/);
    // A real failure must not be silently reported as "nothing archived".
    expect(screen.queryByText(/Nothing archived/)).toBeNull();

    getArchivedNodes.mockResolvedValueOnce([node({ id: 9, label: "Resting memory" })]);
    const retryBtn = screen.getByText("Retry");
    await act(async () => { retryBtn.click(); await Promise.resolve(); });
    await screen.findByText("Resting memory");
  });
});

describe("LibraryPanel — memory date is the viewer's LOCAL date (date/time rule 4)", () => {
  // IM-43: Folders renders the same human local format as All ("Oct 20, 2026
  // (…relative…)") instead of the raw YYYY-MM-DD storage shape — but it must
  // still be the LOCAL calendar day of the instant, not the UTC slice.
  const humanLocalDateOf = (iso: string): string =>
    new Date(Date.parse(iso)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  it("renders the local date of the instant in human format, not the UTC slice or raw ISO", async () => {
    // 02:30 UTC is the previous evening in UTC-negative zones; 11:30 UTC is
    // already the next day at UTC+14. Across the multi-TZ gate legs
    // (America/New_York, Pacific/Kiritimati) at least one of these differs
    // from its UTC calendar date, so a regression to `.slice(0, 10)` fails.
    const a = node({ id: 1, label: "Early UTC memory", createdAt: "2026-10-20T02:30:00.000Z" });
    const b = node({ id: 2, label: "Late UTC memory", createdAt: "2026-10-20T11:30:00.000Z" });
    render(<LibraryPanel graph={graph([a, b])} onFocus={() => {}} />);
    const folder = await screen.findByText("Concepts", { selector: "span" });
    act(() => folder.click());
    await screen.findByText("Early UTC memory");
    expect(screen.getAllByText(new RegExp(humanLocalDateOf("2026-10-20T02:30:00.000Z"))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(humanLocalDateOf("2026-10-20T11:30:00.000Z"))).length).toBeGreaterThan(0);
    // The raw storage shape must not be what the row shows.
    expect(screen.queryByText("2026-10-20")).toBeNull();
  });
});

describe("LibraryPanel — IM-38: Folders has search, kind filter, and sort like All", () => {
  const nodes = () => [
    node({ id: 1, label: "Alpha concept", type: "concept", content: "about zebras", createdAt: "2026-01-03" }),
    node({ id: 2, label: "Beta person", type: "person", content: "met at the fair", createdAt: "2026-01-02" }),
    node({ id: 3, label: "Gamma concept", type: "concept", content: "about yaks", createdAt: "2026-01-01" }),
  ];

  it("search filters memories across folders and reports the filtered count", async () => {
    render(<LibraryPanel graph={graph(nodes())} onFocus={() => {}} />);
    const search = await screen.findByLabelText("Search folders");
    fireEvent.change(search, { target: { value: "zebras" } });
    await screen.findByText("Alpha concept");
    expect(screen.queryByText("Beta person")).toBeNull();
    expect(screen.queryByText("Gamma concept")).toBeNull();
    expect(screen.getByText(/Showing 1 of 3 memories/)).toBeTruthy();
  });

  it("kind filter narrows to one folder kind", async () => {
    render(<LibraryPanel graph={graph(nodes())} onFocus={() => {}} />);
    const kind = await screen.findByLabelText("Filter folders by kind");
    fireEvent.change(kind, { target: { value: "person" } });
    await screen.findByText("Beta person");
    expect(screen.queryByText("Alpha concept")).toBeNull();
    expect(screen.queryByText("Gamma concept")).toBeNull();
  });

  it("sort by name orders rows A–Z inside a folder", async () => {
    render(<LibraryPanel graph={graph(nodes())} onFocus={() => {}} />);
    const sortSel = await screen.findByLabelText("Sort memories in folders");
    fireEvent.change(sortSel, { target: { value: "name" } });
    const folder = await screen.findByText("Concepts", { selector: "span" });
    act(() => folder.click());
    const alpha = await screen.findByText("Alpha concept");
    const gamma = await screen.findByText("Gamma concept");
    // Alpha must come before Gamma in document order under name sort
    // (recent sort would put Alpha first too — use the reverse fixture check
    // via content positions of the two rows' <li> elements).
    const items = [...document.querySelectorAll("li")].map((li) => li.textContent ?? "");
    const ai = items.findIndex((t) => t.includes("Alpha concept"));
    const gi = items.findIndex((t) => t.includes("Gamma concept"));
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(gi).toBeGreaterThan(ai);
    expect(alpha).toBeTruthy();
    expect(gamma).toBeTruthy();
  });

  it("a search with no matches offers to clear search & filters", async () => {
    render(<LibraryPanel graph={graph(nodes())} onFocus={() => {}} />);
    const search = await screen.findByLabelText("Search folders");
    fireEvent.change(search, { target: { value: "nothing matches this" } });
    const clear = await screen.findByText("Clear search & filters");
    fireEvent.click(clear);
    await screen.findByText("Concepts", { selector: "span" });
  });
});

describe("LibraryPanel — IM-40: previews expand in place; rows show tier/tags/emotion", () => {
  it("clicking a preview expands the full content in place without flying to the memory", async () => {
    const long = "x".repeat(500);
    const onFocus = vi.fn();
    render(
      <LibraryPanel
        graph={graph([
          node({
            id: 1,
            label: "Long note",
            type: "concept",
            content: long,
            celestial: "planet",
            tags: ["deep", "work"],
            emotionalWeight: 0.8,
            degree: 3,
          }),
        ])}
        onFocus={onFocus}
      />,
    );
    const folder = await screen.findByText("Concepts", { selector: "span" });
    act(() => folder.click());
    await screen.findByText("Long note");
    // Row richness (IM-40): tier label, emotion label, tags, link count.
    const row = screen.getByText("Long note").closest("li")!;
    expect(row.textContent).toContain("planet");
    expect(row.textContent).toContain("warm");
    expect(row.textContent).toContain("#deep");
    expect(row.textContent).toContain("3 links");
    // Preview starts capped; clicking it expands the FULL body in place.
    expect(row.textContent).not.toContain(long);
    const readHere = screen.getByText("▾ Read here");
    fireEvent.click(readHere);
    expect(row.textContent).toContain(long);
    expect(onFocus).not.toHaveBeenCalled();
  });
});
