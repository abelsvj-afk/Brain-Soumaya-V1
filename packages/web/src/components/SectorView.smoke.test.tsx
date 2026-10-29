import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { GraphData, GraphNode } from "@brain/shared";

const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { SectorView } from "./SectorView.js";

function node(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "Hub", type: "concept", content: "", mass: 0.9, ...over } as GraphNode;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SectorView — a transient action never forms a sector", () => {
  it("excludes a heavy action-kind node from the sector list", () => {
    const graph: GraphData = {
      nodes: [node({ id: 1, label: "Real hub", mass: 0.9 }), node({ id: 2, label: "Busy action", mass: 0.95, kind: "action" })],
      links: [],
    } as unknown as GraphData;
    render(<SectorView graph={graph} onFocus={() => {}} onIsolate={() => {}} />);
    expect(screen.getByText("Real hub")).toBeTruthy();
    expect(screen.queryByText("Busy action")).toBeNull();
  });
});

describe("SectorView — the headline count equals the listable members (REG-117)", () => {
  it("headlines the listable count and names the remainder when the server degree is higher", () => {
    const graph: GraphData = {
      nodes: [node({ id: 1, label: "Hub", mass: 0.9, degree: 5 })], // 5 real edges server-side
      // No links array entry for the hub at all client-side (e.g. neighbors filtered out).
      links: [],
    } as unknown as GraphData;
    render(<SectorView graph={graph} onFocus={() => {}} onIsolate={() => {}} />);
    // The card used to headline the server's degree ("5 memories orbiting")
    // above a list that could show zero members — the same card disagreeing
    // with itself. Now the headline is the listable count, with the
    // remainder named on the card.
    expect(screen.getByText(/0 memories orbiting/)).toBeTruthy();
    expect(screen.getByText(/\+5 more not in this view/)).toBeTruthy();
  });

  it("headlines the member count with no remainder when every neighbor is present", () => {
    const graph: GraphData = {
      nodes: [
        node({ id: 1, label: "Hub", mass: 0.9, degree: 2 }),
        node({ id: 2, label: "Member one", mass: 0.1 }),
        node({ id: 3, label: "Member two", mass: 0.1 }),
      ],
      links: [
        { source: 1, target: 2 },
        { source: 1, target: 3 },
      ],
    } as unknown as GraphData;
    render(<SectorView graph={graph} onFocus={() => {}} onIsolate={() => {}} />);
    expect(screen.getByText(/2 memories orbiting/)).toBeTruthy();
    expect(screen.queryByText(/more not in this view/)).toBeNull();
  });
});

describe("SectorView — the 'no sectors yet' state shows real progress, not just a goal", () => {
  it("shows the heaviest memory's percent of the way to a sector", () => {
    const graph: GraphData = {
      nodes: [node({ id: 1, label: "Growing", mass: 0.22 })], // well under SECTOR_MASS (0.44)
      links: [],
    } as unknown as GraphData;
    render(<SectorView graph={graph} onFocus={() => {}} onIsolate={() => {}} />);
    expect(screen.getByText(/50% of the way/)).toBeTruthy();
  });
});

describe("SectorView — a newly-formed sector is celebrated, not silently listed", () => {
  it("plays a sound and toasts only on the real transition, never on initial mount", () => {
    const before: GraphData = { nodes: [node({ id: 1, label: "Old hub", mass: 0.9 })], links: [] } as unknown as GraphData;
    const { rerender } = render(<SectorView graph={before} onFocus={() => {}} onIsolate={() => {}} />);
    expect(playSfx).not.toHaveBeenCalled(); // mount alone must not celebrate the existing hub

    const after: GraphData = {
      nodes: [node({ id: 1, label: "Old hub", mass: 0.9 }), node({ id: 2, label: "Fresh hub", mass: 0.85 })],
      links: [],
    } as unknown as GraphData;
    rerender(<SectorView graph={after} onFocus={() => {}} onIsolate={() => {}} />);
    expect(playSfx).toHaveBeenCalledWith("milestone");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Fresh hub"), "🌌", expect.any(Number));
  });
});

describe("SectorView — IM-39: hub cards expand to list orbiting members with fly-to", () => {
  it("lists members on expand and flies to the clicked member", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onFocus = vi.fn();
    const graph: GraphData = {
      nodes: [
        node({ id: 1, label: "Hub", mass: 0.9, createdAt: "2026-01-01" }),
        node({ id: 2, label: "Orbiter one", mass: 0.2, createdAt: "2026-01-02" }),
        node({ id: 3, label: "Orbiter two", mass: 0.2, createdAt: "2026-01-03" }),
      ],
      links: [
        { source: 1, target: 2 },
        { source: 1, target: 3 },
      ],
    } as unknown as GraphData;
    render(<SectorView graph={graph} onFocus={onFocus} onIsolate={() => {}} />);
    // Members are announced as a count but not listed until expanded.
    expect(screen.queryByText("Orbiter one")).toBeNull();
    fireEvent.click(screen.getByText(/Show 2 orbiting memories/));
    const member = await screen.findByText(/Orbiter one/);
    fireEvent.click(member.closest("button")!);
    expect(onFocus).toHaveBeenCalledWith(2);
  });
});

describe("SectorView — IM-41: hub search + local dates", () => {
  it("shows the hub's own local date and the members' absolute span dates", () => {
    const graph: GraphData = {
      nodes: [
        node({ id: 1, label: "Hub", mass: 0.9, createdAt: "2026-01-15T12:00:00.000Z" }),
        node({ id: 2, label: "Orbiter", mass: 0.2, createdAt: "2026-03-15T12:00:00.000Z" }),
      ],
      links: [{ source: 1, target: 2 }],
    } as unknown as GraphData;
    render(<SectorView graph={graph} onFocus={() => {}} onIsolate={() => {}} />);
    const human = (iso: string) =>
      new Date(Date.parse(iso)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    expect(screen.getByText(new RegExp(`since ${human("2026-01-15T12:00:00.000Z")}`))).toBeTruthy();
    expect(screen.getByText(new RegExp(human("2026-03-15T12:00:00.000Z")))).toBeTruthy();
  });

  it("search finds a hub by an orbiting member's label and can be cleared", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const graph: GraphData = {
      nodes: [
        node({ id: 1, label: "Alpha hub", mass: 0.9 }),
        node({ id: 2, label: "Beta hub", mass: 0.85 }),
        node({ id: 3, label: "Needle memory", mass: 0.2 }),
      ],
      links: [{ source: 2, target: 3 }],
    } as unknown as GraphData;
    render(<SectorView graph={graph} onFocus={() => {}} onIsolate={() => {}} />);
    const search = screen.getByLabelText("Search hubs");
    fireEvent.change(search, { target: { value: "needle" } });
    expect(screen.queryByText("Alpha hub")).toBeNull();
    expect(screen.getByText("Beta hub")).toBeTruthy();
    fireEvent.change(search, { target: { value: "zzz-no-match" } });
    const clear = await screen.findByText("Clear search");
    fireEvent.click(clear);
    expect(screen.getByText("Alpha hub")).toBeTruthy();
  });
});
