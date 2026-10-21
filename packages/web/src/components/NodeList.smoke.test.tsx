import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

const getConstellations = vi.fn();
const getVisitorActivity = vi.fn();
vi.mock("../api/client.js", () => ({
  getConstellations: (...a: unknown[]) => getConstellations(...a),
  getVisitorActivity: (...a: unknown[]) => getVisitorActivity(...a),
  useProcessingNodes: () => new Set<number>(),
}));

import { NodeList } from "./NodeList.js";

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

beforeEach(() => {
  vi.resetAllMocks();
  getConstellations.mockResolvedValue([]);
  getVisitorActivity.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("NodeList — the 'reminder incoming' banner shows the SOONEST reminder", () => {
  it("picks the earliest remindAt as [0], not just array order", async () => {
    const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // in 2h
    const later = new Date(Date.now() + 20 * 3600 * 1000).toISOString(); // in 20h
    const nodes = [
      node({ id: 1, label: "Later one", remindAt: later }),
      node({ id: 2, label: "Sooner one", remindAt: soon }),
    ];
    render(<NodeList nodes={nodes} onFocus={() => {}} />);
    await screen.findByText(/Reminder incoming/);
    expect(screen.getByText(/"Sooner one/)).toBeTruthy();
  });

  // Life Vision (docs/specs/life-vision.md, C2.1/C3.2-locked): a Vision's target date
  // is not a reminder and must never appear in this banner.
  it("never shows a life_vision node's target date in the 'Reminder incoming' banner", async () => {
    const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const nodes = [node({ id: 1, kind: "life_vision", label: "Our first house", remindAt: soon })];
    render(<NodeList nodes={nodes} onFocus={() => {}} />);
    await waitFor(() => expect(getConstellations).toHaveBeenCalled());
    expect(screen.queryByText(/Reminder incoming/)).toBeNull();
  });
});

describe("NodeList — constellations refresh when one is newly promoted", () => {
  it("refetches getConstellations() on the brain-constellation-formed event", async () => {
    render(<NodeList nodes={[node({ id: 1 })]} onFocus={() => {}} />);
    await waitFor(() => expect(getConstellations).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new CustomEvent("brain-constellation-formed", { detail: { id: 99 } })));
    await waitFor(() => expect(getConstellations).toHaveBeenCalledTimes(2));
  });
});

describe("NodeList — a huge matching set doesn't render unbounded", () => {
  it("caps rendered rows and shows a '+N more' hint past the cap", async () => {
    const many = Array.from({ length: 320 }, (_, i) => node({ id: i + 1, label: `Memory ${i + 1}` }));
    render(<NodeList nodes={many} onFocus={() => {}} />);
    await screen.findByText("Memory 1");
    expect(screen.queryByText("Memory 301")).toBeNull();
    expect(screen.getByText(/\+20 more/)).toBeTruthy();
  });
});

describe("NodeList — a dead-end 'No matches' now offers a way out", () => {
  it("clears every filter when the button is clicked", async () => {
    render(<NodeList nodes={[node({ id: 1, label: "Only match", type: "person" })]} onFocus={() => {}} />);
    const search = await screen.findByPlaceholderText(/Search/);
    fireEvent.change(search, { target: { value: "nothing will match this" } });
    await screen.findByText("Clear all filters");
    fireEvent.click(screen.getByText("Clear all filters"));
    await screen.findByText("Only match");
  });
});

describe("NodeList — emotion is never color-alone", () => {
  it("shows a visible warm/neutral/heavy label next to the emotion dot, not just a hover title", async () => {
    render(<NodeList nodes={[node({ id: 1, label: "Happy memory", emotionalWeight: 0.8 })]} onFocus={() => {}} />);
    const label = await screen.findByText("Happy memory");
    expect(label.closest("li")?.textContent).toContain("warm");
  });
});

describe("NodeList — IM-42: enrichment failures are surfaced, not silent", () => {
  it("shows a retry notice when the visitor fetch fails, and clears it after a successful retry", async () => {
    getVisitorActivity.mockRejectedValue(new Error("down"));
    render(<NodeList nodes={[node({ id: 1 })]} onFocus={() => {}} />);
    await screen.findByText(/Couldn't load visitor info/);
    getVisitorActivity.mockResolvedValue([]);
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.queryByText(/Couldn't load/)).toBeNull());
  });

  it("shows a retry notice when the constellation fetch fails", async () => {
    getConstellations.mockRejectedValue(new Error("down"));
    render(<NodeList nodes={[node({ id: 1 })]} onFocus={() => {}} />);
    await screen.findByText(/Couldn't load constellation info/);
  });

  it("shows no failure notice when both enrichments succeed", async () => {
    render(<NodeList nodes={[node({ id: 1 })]} onFocus={() => {}} />);
    await waitFor(() => expect(getConstellations).toHaveBeenCalled());
    await waitFor(() => expect(getVisitorActivity).toHaveBeenCalled());
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });
});
