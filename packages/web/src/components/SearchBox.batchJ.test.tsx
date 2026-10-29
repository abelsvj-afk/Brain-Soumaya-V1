import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const searchDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  searchDetailed: (...a: unknown[]) => searchDetailed(...a),
}));
import { SearchBox, type SearchSession } from "./SearchBox.js";
import type { SearchHit } from "../api/client.js";

const HIT: SearchHit = {
  id: 5, label: "Studio lease", celestialTitle: "The Lease Star", type: "project",
  content: "Signed a 12-month lease on the King Street studio with a break clause.", importance: 0.8,
  createdAt: "2026-09-01T12:00:00Z", similarity: 0.92,
};
const SESSION: SearchSession = {
  q: "lease", hits: [HIT], total: 1, hasMore: false, totalCapped: false,
};

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); searchDetailed.mockResolvedValue({ hits: [HIT] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function submit(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form")!);
}

describe("REG-187 — the search session survives the panel switch (SP-04)", () => {
  it("restores the query and its result set from the lifted session without re-searching", async () => {
    render(<SearchBox onFocus={() => {}} initialSession={SESSION} />);
    expect((screen.getByPlaceholderText("Search your mind…") as HTMLInputElement).value).toBe("lease");
    await screen.findByText("Studio lease");
    expect(searchDetailed).not.toHaveBeenCalled();
  });

  it("reports the session upward after a search, so the shell can hold it past unmount", async () => {
    const onSessionChange = vi.fn();
    render(<SearchBox onFocus={() => {}} onSessionChange={onSessionChange} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => { submit(input, "lease"); });
    await screen.findByText("Studio lease");
    const last = onSessionChange.mock.calls[onSessionChange.mock.calls.length - 1]![0] as SearchSession;
    expect(last.q).toBe("lease");
    expect(last.hits.map((h) => h.id)).toEqual([5]);
  });

  it("a remount with the reported session shows the same query and results", async () => {
    const onSessionChange = vi.fn();
    const { unmount } = render(<SearchBox onFocus={() => {}} onSessionChange={onSessionChange} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => { submit(input, "lease"); });
    await screen.findByText("Studio lease");
    const saved = onSessionChange.mock.calls[onSessionChange.mock.calls.length - 1]![0] as SearchSession;
    unmount();
    cleanup();
    searchDetailed.mockClear();
    render(<SearchBox onFocus={() => {}} initialSession={saved} />);
    expect((screen.getByPlaceholderText("Search your mind…") as HTMLInputElement).value).toBe("lease");
    await screen.findByText("Studio lease");
    expect(searchDetailed).not.toHaveBeenCalled();
  });
});

describe("REG-188 — the zero-results hatches carry the query they were invoked from (SP-05)", () => {
  function captureAction() {
    const seen: unknown[] = [];
    const onAction = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("brain-toast-action", onAction);
    return { seen, stop: () => window.removeEventListener("brain-toast-action", onAction) };
  }

  it("'Ask Soumaya' carries the searched text as the question", async () => {
    searchDetailed.mockResolvedValue({ hits: [] });
    const { seen, stop } = captureAction();
    try {
      render(<SearchBox onFocus={() => {}} />);
      const input = screen.getByPlaceholderText("Search your mind…");
      await act(async () => { submit(input, "my lost thought"); });
      await screen.findByText("No matches.");
      fireEvent.click(screen.getByText("💬 Ask Soumaya"));
      expect(seen).toContainEqual({ kind: "chat", value: "my lost thought" });
    } finally {
      stop();
    }
  });

  it("'Add as memory' carries the searched text for the capture box", async () => {
    searchDetailed.mockResolvedValue({ hits: [] });
    const { seen, stop } = captureAction();
    try {
      render(<SearchBox onFocus={() => {}} />);
      const input = screen.getByPlaceholderText("Search your mind…");
      await act(async () => { submit(input, "my lost thought"); });
      await screen.findByText("No matches.");
      fireEvent.click(screen.getByText("➕ Add as memory"));
      expect(seen).toContainEqual({ kind: "panel", value: "ingest", text: "my lost thought" });
    } finally {
      stop();
    }
  });
});

describe("REG-189 — recents record every path that produces a search (SP-06)", () => {
  it("an as-you-type search is recorded as a recent (no submit needed)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    fireEvent.change(input, { target: { value: "lease" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    await screen.findByText("Studio lease");
    fireEvent.change(input, { target: { value: "" } });
    expect(await screen.findByText("Recent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "lease" })).toBeTruthy();
  });

  it("choosing a hit records the query that produced it", async () => {
    // Seed the session directly (no search runs in this mount), so the only
    // recording site the test can observe is choose() itself — submitting
    // or typing first would record the query before choose() ever runs.
    render(<SearchBox onFocus={() => {}} initialSession={SESSION} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await screen.findByText("Studio lease");
    fireEvent.click(screen.getByText("Studio lease"));
    fireEvent.change(input, { target: { value: "" } });
    expect(await screen.findByText("Recent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "lease" })).toBeTruthy();
  });

  it("re-running a recent refreshes its recency (it moves to the front)", async () => {
    render(<SearchBox onFocus={() => {}} />);
    const input = screen.getByPlaceholderText("Search your mind…");
    await act(async () => { submit(input, "alpha"); });
    await screen.findByText("Studio lease");
    await act(async () => { submit(input, "beta"); });
    await screen.findByText("Studio lease");
    fireEvent.change(input, { target: { value: "" } });
    await screen.findByText("Recent");
    const before = [...document.querySelectorAll(".search-recent")].map((b) => b.textContent);
    expect(before[0]).toBe("beta");
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    await screen.findByText("Studio lease");
    fireEvent.change(input, { target: { value: "" } });
    await screen.findByText("Recent");
    const after = [...document.querySelectorAll(".search-recent")].map((b) => b.textContent);
    expect(after[0]).toBe("alpha");
  });
});
