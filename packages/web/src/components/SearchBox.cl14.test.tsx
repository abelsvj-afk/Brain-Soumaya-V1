import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const searchDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  searchDetailed: (...a: unknown[]) => searchDetailed(...a),
}));
import { SearchBox } from "./SearchBox.js";

const HIT = {
  id: 5, label: "Studio lease", celestialTitle: "The Lease Star", type: "project",
  content: "Signed a 12-month lease on the King Street studio with a break clause.", importance: 0.8,
  createdAt: "2026-09-01T12:00:00Z", similarity: 0.92,
};
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); searchDetailed.mockResolvedValue({ hits: [HIT] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function submit(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form")!);
}

describe("IM-115 — rich rows", () => {
  it("renders snippet, type, importance and date — not just the label", async () => {
    render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => { submit(input, "lease"); });
    await screen.findByText("Studio lease");
    expect(screen.getByText(/Signed a 12-month lease/)).toBeTruthy();
    expect(screen.getByText(/Project/)).toBeTruthy();
    expect(screen.getByText(/importance 80%/)).toBeTruthy();
    expect(screen.getByText(/The Lease Star/)).toBeTruthy();
  });
});

describe("IM-115 — results preserved on click", () => {
  it("clicking a hit flies to it but keeps the result set", async () => {
    const onFocus = vi.fn();
    render(<SearchBox onFocus={onFocus} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => { submit(input, "lease"); });
    await screen.findByText("Studio lease");
    fireEvent.click(screen.getByText("Studio lease"));
    expect(onFocus).toHaveBeenCalledWith(5);
    expect(screen.getByText("Studio lease")).toBeTruthy(); // still there
  });
});

describe("IM-115 — debounced as-you-type + recents + keyboard nav", () => {
  it("searches without submit after the debounce window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    fireEvent.change(input, { target: { value: "lease" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(searchDetailed).toHaveBeenCalledWith("lease");
    await screen.findByText("Studio lease");
  });

  it("records a submitted search as a recent and offers it on an empty query", async () => {
    render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => { submit(input, "lease"); });
    await screen.findByText("Studio lease");
    fireEvent.change(input, { target: { value: "" } });
    expect(await screen.findByText("Recent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "lease" })).toBeTruthy();
  });

  it("arrow keys move the active hit and Enter flies to it", async () => {
    searchDetailed.mockResolvedValue({ hits: [HIT, { ...HIT, id: 6, label: "Lease renewal" }] });
    const onFocus = vi.fn();
    render(<SearchBox onFocus={onFocus} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => { submit(input, "lease"); });
    await screen.findByText("Studio lease");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFocus).toHaveBeenCalledWith(6);
  });
});
