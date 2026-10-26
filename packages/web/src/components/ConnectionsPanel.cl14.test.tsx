import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const getCandidates = vi.fn();
const acceptCandidate = vi.fn();
const dismissCandidate = vi.fn();
const restoreCandidate = vi.fn();
vi.mock("../api/client.js", () => ({
  getCandidates: (...a: unknown[]) => getCandidates(...a),
  acceptCandidate: (...a: unknown[]) => acceptCandidate(...a),
  dismissCandidate: (...a: unknown[]) => dismissCandidate(...a),
  restoreCandidate: (...a: unknown[]) => restoreCandidate(...a),
  linkMemories: vi.fn().mockResolvedValue(true),
  pruneWeakLinks: vi.fn().mockResolvedValue({ pruned: 0, anchorPruned: 0, weakPruned: 0 }),
  pruneWeakLinksResult: vi.fn().mockResolvedValue({ ok: true, pruned: 0, anchorPruned: 0, wrongPruned: 0, capTrimmed: 0, weakPruned: 0 }),
  search: vi.fn().mockResolvedValue([]),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
import { ConnectionsPanel } from "./ConnectionsPanel.js";

const CAND = {
  id: 7, a: 10, b: 11, aLabel: "alpha memory", bLabel: "beta memory", reason: "they rhyme",
  score: 0.8, origin: "suggested", createdAt: "2026-10-20T00:00:00Z",
  aContent: "alpha content about apples", bContent: "beta content about boats",
  aCreatedAt: "2026-09-01T00:00:00Z", bCreatedAt: "2026-09-02T00:00:00Z",
};
const CAND2 = { ...CAND, id: 8, aLabel: "gamma memory", bLabel: "delta memory", score: 0.35 };

beforeEach(() => {
  vi.resetAllMocks();
  acceptCandidate.mockResolvedValue(true);
  dismissCandidate.mockResolvedValue(true);
  restoreCandidate.mockResolvedValue(true);
  getCandidates.mockResolvedValue({ candidates: [CAND, CAND2], count: 2 });
});
afterEach(cleanup);

describe("IM-120 remainder — score/age rendered, own chrome", () => {
  it("renders each suggestion's score and date so certainty is triageable", async () => {
    const { container } = render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha memory");
    expect(screen.getByText("80% match")).toBeTruthy();
    expect(screen.getByText("35% match")).toBeTruthy();
    expect(screen.getAllByText(/suggested Oct \d+, 2026/).length).toBe(2);
    // Own chrome — no longer borrowing Settings' classes.
    expect(container.querySelector(".connections-overlay")).toBeTruthy();
    expect(container.querySelector(".settings-overlay")).toBeNull();
  });
});

describe("IM-120 remainder — context preview", () => {
  it("expands both memories' content in place", async () => {
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha memory");
    expect(screen.queryByText(/alpha content about apples/)).toBeNull();
    fireEvent.click(screen.getAllByText("Preview context")[0]!);
    expect(screen.getByText(/alpha content about apples/)).toBeTruthy();
    expect(screen.getByText(/beta content about boats/)).toBeTruthy();
  });
});

describe("IM-120 remainder — undo + bulk actions", () => {
  it("undo restores the row and calls the server restore", async () => {
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha memory");
    fireEvent.click(screen.getAllByText("Connect")[0]!);
    await waitFor(() => expect(screen.queryByText("alpha memory")).toBeNull());
    fireEvent.click(await screen.findByText(/Undo/));
    await waitFor(() => expect(restoreCandidate).toHaveBeenCalledWith(7));
    expect(await screen.findByText("alpha memory")).toBeTruthy();
  });

  it("bulk-connects every selected suggestion", async () => {
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha memory");
    fireEvent.click(screen.getByLabelText("Select alpha memory and beta memory"));
    fireEvent.click(screen.getByLabelText("Select gamma memory and delta memory"));
    fireEvent.click(await screen.findByText("Connect selected"));
    await waitFor(() => expect(acceptCandidate).toHaveBeenCalledTimes(2));
    expect(acceptCandidate).toHaveBeenCalledWith(7);
    expect(acceptCandidate).toHaveBeenCalledWith(8);
  });
});
