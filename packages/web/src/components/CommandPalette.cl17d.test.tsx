import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const searchDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  searchDetailed: (...a: unknown[]) => searchDetailed(...a),
}));

import { CommandPalette } from "./CommandPalette.js";

beforeEach(() => {
  vi.resetAllMocks();
  searchDetailed.mockResolvedValue({ hits: [] });
});
afterEach(() => cleanup());

function renderPalette() {
  const onClose = vi.fn();
  const onCommand = vi.fn();
  const onFocusNode = vi.fn();
  render(<CommandPalette onClose={onClose} onCommand={onCommand} onFocusNode={onFocusNode} />);
  return { onClose, onCommand, onFocusNode };
}

const input = () => screen.getByPlaceholderText(/Search memories or jump to/);

describe("CommandPalette — IM-142", () => {
  it("lists the jump-to/action commands before any query is typed", () => {
    renderPalette();
    expect(screen.getByText("Capture a thought")).toBeTruthy();
    expect(screen.getByText(/Money/)).toBeTruthy();
    expect(screen.getByText(/Journeys/)).toBeTruthy();
  });

  it("runs a command on click", () => {
    const { onCommand } = renderPalette();
    act(() => screen.getByText("Capture a thought").click());
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ id: "capture" });
  });

  it("filters commands as you type", () => {
    renderPalette();
    fireEvent.change(input(), { target: { value: "money" } });
    expect(screen.getByText(/Money/)).toBeTruthy();
    expect(screen.queryByText("Capture a thought")).toBeNull();
  });

  it("searches memories via the existing search API and focuses a hit on Enter", async () => {
    searchDetailed.mockResolvedValue({
      hits: [{ id: 42, label: "The lighthouse idea", type: "concept", similarity: 0.87 }],
    });
    const { onFocusNode } = renderPalette();
    fireEvent.change(input(), { target: { value: "lighthouse" } });
    await screen.findByText("The lighthouse idea", undefined, { timeout: 3000 });
    expect(searchDetailed).toHaveBeenCalledWith("lighthouse");
    // The hit is the active row (commands filtered to none for this query) —
    // Enter jumps straight to the memory.
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onFocusNode).toHaveBeenCalledWith(42);
  });

  it("arrow keys move the active row and Enter runs it", async () => {
    searchDetailed.mockResolvedValue({ hits: [] });
    const { onCommand } = renderPalette();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onCommand).toHaveBeenCalledTimes(1);
    // Second command in the list (index 1) — the one ArrowDown landed on.
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ id: "chat" });
  });

  it("shows an honest loading state while the search is in flight", async () => {
    searchDetailed.mockImplementation(() => new Promise(() => {})); // never resolves
    renderPalette();
    fireEvent.change(input(), { target: { value: "slowquery" } });
    await screen.findByText(/Searching/, undefined, { timeout: 3000 });
  });

  it("shows the search error instead of pretending there were no matches", async () => {
    searchDetailed.mockResolvedValue({ hits: [], error: "Couldn't reach the server." });
    renderPalette();
    fireEvent.change(input(), { target: { value: "anything" } });
    await screen.findByText(/Couldn't reach the server/, undefined, { timeout: 3000 });
    expect(screen.queryByText(/No memories match/)).toBeNull();
  });

  it("shows an honest empty state when a search succeeds with zero hits", async () => {
    searchDetailed.mockResolvedValue({ hits: [] });
    renderPalette();
    fireEvent.change(input(), { target: { value: "zzzz" } });
    await screen.findByText(/No memories match/, undefined, { timeout: 3000 });
  });

  it("Escape closes the palette", () => {
    const { onClose } = renderPalette();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
