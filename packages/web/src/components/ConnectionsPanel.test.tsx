import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// IM-120 (honesty subset): loading / error / true-empty must be distinguishable,
// and a failed accept/dismiss must restore the row + toast instead of silently
// vanishing. getCandidates is mocked to THROW on failure, mirroring the real
// client (api/mind.ts no longer swallows errors into an empty queue).
const getCandidates = vi.fn();
const acceptCandidate = vi.fn();
const dismissCandidate = vi.fn();
vi.mock("../api/client.js", () => ({
  getCandidates: (...a: unknown[]) => getCandidates(...a),
  acceptCandidate: (...a: unknown[]) => acceptCandidate(...a),
  dismissCandidate: (...a: unknown[]) => dismissCandidate(...a),
  linkMemories: vi.fn().mockResolvedValue(true),
  pruneWeakLinks: vi.fn().mockResolvedValue({ pruned: 0, anchorPruned: 0, weakPruned: 0 }),
  pruneWeakLinksResult: vi.fn().mockResolvedValue({ ok: true, pruned: 0, anchorPruned: 0, wrongPruned: 0, capTrimmed: 0, weakPruned: 0 }),
  search: vi.fn().mockResolvedValue([]),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));

import { ConnectionsPanel } from "./ConnectionsPanel.js";

const CANDIDATE = {
  id: 7,
  a: 10,
  b: 11,
  aLabel: "alpha memory",
  bLabel: "beta memory",
  reason: "they rhyme",
  score: 0.8,
  origin: "suggested",
  createdAt: "2026-10-20T00:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  acceptCandidate.mockResolvedValue(true);
  dismissCandidate.mockResolvedValue(true);
});

afterEach(cleanup);

describe("ConnectionsPanel — truthful load states (IM-120)", () => {
  it("shows a loading state, not the empty state, while the fetch is in flight", () => {
    getCandidates.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ConnectionsPanel onClose={vi.fn()} />);
    expect(screen.getByText(/Loading suggestions/)).toBeTruthy();
    expect(screen.queryByText(/Nothing waiting/)).toBeNull();
  });

  it("renders an error state distinct from empty when the fetch fails", async () => {
    getCandidates.mockRejectedValue(new Error("network down"));
    render(<ConnectionsPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load suggestions/)).toBeTruthy();
    expect(screen.queryByText(/Nothing waiting/)).toBeNull();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("renders the true-empty state only after a successful empty fetch", async () => {
    getCandidates.mockResolvedValue({ candidates: [], count: 0 });
    render(<ConnectionsPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Nothing waiting/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load suggestions/)).toBeNull();
  });
});

describe("ConnectionsPanel — failed actions restore the row (IM-120)", () => {
  it("a failed accept restores the suggestion and toasts", async () => {
    getCandidates.mockResolvedValue({ candidates: [CANDIDATE], count: 1 });
    acceptCandidate.mockResolvedValue(false);
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha memory");
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't connect"), "⚠️", expect.any(Number)),
    );
    // The row is back — a failed accept no longer looks like a successful one.
    expect(screen.getByText("alpha memory")).toBeTruthy();
    expect(screen.getByText("beta memory")).toBeTruthy();
  });

  it("a failed dismiss restores the suggestion and toasts", async () => {
    getCandidates.mockResolvedValue({ candidates: [CANDIDATE], count: 1 });
    dismissCandidate.mockResolvedValue(false);
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha memory");
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't dismiss"), "⚠️", expect.any(Number)),
    );
    expect(screen.getByText("alpha memory")).toBeTruthy();
  });

  it("a successful accept removes the row without an error toast", async () => {
    getCandidates.mockResolvedValue({ candidates: [CANDIDATE], count: 1 });
    acceptCandidate.mockResolvedValue(true);
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha memory");
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() => expect(screen.queryByText("alpha memory")).toBeNull());
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("Couldn't"), "⚠️", expect.any(Number));
  });
});
