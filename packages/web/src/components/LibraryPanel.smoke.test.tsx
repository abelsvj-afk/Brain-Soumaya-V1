import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
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
  const localDateOf = (iso: string): string => {
    const d = new Date(Date.parse(iso));
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  };

  it("renders the local date of the instant, not the UTC slice — agreeing with NodeInspector", async () => {
    // 02:30 UTC is the previous evening in UTC-negative zones; 11:30 UTC is
    // already the next day at UTC+14. Across the multi-TZ gate legs
    // (America/New_York, Pacific/Kiritimati) at least one of these differs
    // from its UTC calendar date, so a regression to `.slice(0, 10)` fails.
    const a = node({ id: 1, label: "Early UTC memory", createdAt: "2026-10-20T02:30:00.000Z" });
    const b = node({ id: 2, label: "Late UTC memory", createdAt: "2026-10-20T11:30:00.000Z" });
    render(<LibraryPanel graph={graph([a, b])} onFocus={() => {}} />);
    const folder = await screen.findByText("Concepts");
    act(() => folder.click());
    await screen.findByText("Early UTC memory");
    expect(screen.getAllByText(localDateOf("2026-10-20T02:30:00.000Z")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(localDateOf("2026-10-20T11:30:00.000Z")).length).toBeGreaterThan(0);
  });
});
