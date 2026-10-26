import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LensChips } from "./LensChips.js";
import * as api from "../api/lenses.js";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

describe("LensChips", () => {
  it("renders only pinned lenses and opens one on tap (isolate)", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 1, name: "Pinned view", query: {}, pinned: true, count: 3 },
      { id: 2, name: "Unpinned", query: {}, pinned: false, count: 9 },
    ]);
    vi.spyOn(api, "lensNodes").mockResolvedValue({ ids: [5, 6], total: 2, capped: false, totalIsLowerBound: false, shown: 2 });
    const onOpen = vi.fn();

    render(<LensChips activeLens={null} onOpen={onOpen} onExit={vi.fn()} />);
    await waitFor(() => screen.getByText("Pinned view"));
    expect(screen.queryByText("Unpinned")).toBeNull(); // only pinned show

    fireEvent.click(screen.getByText("Pinned view"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith([5, 6], "Pinned view", 2));
  });

  it("tapping the ACTIVE chip exits instead of re-opening", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 1, name: "Active one", query: {}, pinned: true, count: 3 },
    ]);
    const nodes = vi.spyOn(api, "lensNodes");
    const onExit = vi.fn();

    render(<LensChips activeLens="Active one" onOpen={vi.fn()} onExit={onExit} />);
    await waitFor(() => screen.getByText("Active one"));
    fireEvent.click(screen.getByText("Active one"));
    expect(onExit).toHaveBeenCalled();
    expect(nodes).not.toHaveBeenCalled(); // no re-evaluation on exit
  });

  it("renders nothing when hidden or no pinned lenses", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    const { container } = render(<LensChips activeLens={null} onOpen={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(api.getLenses).toHaveBeenCalled());
    expect(container.querySelector(".lens-list")).toBeNull();
  });
});
