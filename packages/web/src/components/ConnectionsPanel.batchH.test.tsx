import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const getCandidates = vi.fn();
const acceptCandidate = vi.fn();
const dismissCandidate = vi.fn();
const searchMock = vi.fn();
const linkMemories = vi.fn();
const playSfx = vi.fn();
vi.mock("../api/client.js", () => ({
  getCandidates: (...a: unknown[]) => getCandidates(...a),
  acceptCandidate: (...a: unknown[]) => acceptCandidate(...a),
  dismissCandidate: (...a: unknown[]) => dismissCandidate(...a),
  linkMemories: (...a: unknown[]) => linkMemories(...a),
  pruneWeakLinks: vi.fn().mockResolvedValue({ pruned: 0, anchorPruned: 0, weakPruned: 0 }),
  search: (...a: unknown[]) => searchMock(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { ConnectionsPanel } from "./ConnectionsPanel.js";

const cand = (id: number, origin: string, score: number) => ({
  id,
  a: id * 10,
  b: id * 10 + 1,
  aLabel: `alpha ${id}`,
  bLabel: `beta ${id}`,
  reason: "they rhyme",
  score,
  origin,
  createdAt: "2026-10-20T00:00:00Z",
});

beforeEach(() => {
  vi.resetAllMocks();
  acceptCandidate.mockResolvedValue(true);
  dismissCandidate.mockResolvedValue(true);
  linkMemories.mockResolvedValue(true);
  searchMock.mockResolvedValue([]);
});
afterEach(cleanup);

describe("REG-201 — the panel header agrees with the badge's true total (CN-02)", () => {
  it("shows the true total (60) when the list is capped at 50, and says so", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => cand(i + 1, "withheld", 0.9));
    getCandidates.mockResolvedValue({ candidates: fifty, count: 60 });
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha 1");
    // The header names the true total the badge polls — not the capped list length.
    expect(screen.getByText(/Suggested \(60\)/)).toBeTruthy();
    expect(screen.getByText(/showing the first 50 of 60/i)).toBeTruthy();
  });

  it("shows just the count when nothing is capped", async () => {
    getCandidates.mockResolvedValue({ candidates: [cand(1, "withheld", 0.9)], count: 1 });
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText(/alpha 1/);
    expect(screen.getByText(/Suggested \(1\)/)).toBeTruthy();
    expect(screen.queryByText(/showing the first/i)).toBeNull();
  });
});

describe("REG-202 — a pruned row's number is the removed link's weight, not a % match (CN-03)", () => {
  it("labels a pruned row's number as link weight; withheld rows keep % match", async () => {
    getCandidates.mockResolvedValue({
      candidates: [cand(1, "pruned", 0.3), cand(2, "withheld", 0.3)],
      count: 2,
    });
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText(/alpha 1/);
    const pruned = screen.getByText(/30% link weight/i);
    expect(pruned).toBeTruthy();
    // Exactly one "% match" on the page — the withheld row. The pruned row's
    // 30% is the weight of the link Soumaya already drew, not a match score.
    expect(screen.getAllByText(/% match/i)).toHaveLength(1);
    expect(pruned.getAttribute("title")).toMatch(/removed link/i);
  });
});

describe("REG-212 — accept / hand-link play a neutral confirmation, not the achievement jingle (CN-13)", () => {
  it("accepting a suggestion plays 'complete', never 'achievement'", async () => {
    getCandidates.mockResolvedValue({ candidates: [cand(1, "withheld", 0.9)], count: 1 });
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText(/alpha 1/);
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() => expect(playSfx).toHaveBeenCalledWith("complete"));
    expect(playSfx).not.toHaveBeenCalledWith("achievement");
    expect(pushToast).toHaveBeenCalledWith("Connected ✦", "🔗", 2500);
  });

  it("hand-linking two memories plays 'complete', never 'achievement'", async () => {
    searchMock.mockImplementation(async (q: string) =>
      q.includes("alp")
        ? [{ id: 101, label: "alpha memory" }]
        : [{ id: 102, label: "beta memory" }],
    );
    getCandidates.mockResolvedValue({ candidates: [], count: 0 });
    render(<ConnectionsPanel onClose={vi.fn()} />);
    await screen.findByText(/Nothing waiting/);
    const input = screen.getByPlaceholderText(/Search a memory to connect/);
    fireEvent.change(input, { target: { value: "alp" } });
    fireEvent.click(await screen.findByText("alpha memory"));
    const input2 = screen.getByPlaceholderText(/Search the second memory/);
    fireEvent.change(input2, { target: { value: "bet" } });
    fireEvent.click(await screen.findByText("beta memory"));
    fireEvent.click(screen.getByText("Link"));
    await waitFor(() => expect(linkMemories).toHaveBeenCalledWith(101, 102));
    expect(playSfx).toHaveBeenCalledWith("complete");
    expect(playSfx).not.toHaveBeenCalledWith("achievement");
    expect(pushToast).toHaveBeenCalledWith("Linked ✦", "🔗", 2500);
  });
});
