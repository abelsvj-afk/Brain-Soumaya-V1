import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Batch G: Declutter must state its full scope and ask first (REG-203), report
// wrong-link removals separately from cap trims (REG-203), and report a failed
// declutter as a failure with a retry — never "already tidy" (REG-204).
const getCandidates = vi.fn();
const pruneWeakLinks = vi.fn();
const pruneWeakLinksResult = vi.fn();
vi.mock("../api/client.js", () => ({
  getCandidates: (...a: unknown[]) => getCandidates(...a),
  acceptCandidate: vi.fn().mockResolvedValue(true),
  dismissCandidate: vi.fn().mockResolvedValue(true),
  linkMemories: vi.fn().mockResolvedValue(true),
  pruneWeakLinks: (...a: unknown[]) => pruneWeakLinks(...a),
  pruneWeakLinksResult: (...a: unknown[]) => pruneWeakLinksResult(...a),
  restoreCandidate: vi.fn().mockResolvedValue(true),
  search: vi.fn().mockResolvedValue([]),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));

import { ConnectionsPanel } from "./ConnectionsPanel.js";

const ZEROS = { ok: true, pruned: 0, anchorPruned: 0, wrongPruned: 0, capTrimmed: 0, weakPruned: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  getCandidates.mockResolvedValue({ candidates: [], count: 0 });
  pruneWeakLinks.mockResolvedValue({ pruned: 0, anchorPruned: 0, weakPruned: 0 });
  pruneWeakLinksResult.mockResolvedValue(ZEROS);
});
afterEach(cleanup);

async function openDeclutterConfirm() {
  render(<ConnectionsPanel onClose={vi.fn()} />);
  await screen.findByText(/Nothing waiting/);
  fireEvent.click(screen.getByText(/Declutter weak links/));
}

describe("REG-203 — declutter states its full scope and asks first", () => {
  it("tapping Declutter opens a confirm dialog naming the permanent half — nothing runs yet", async () => {
    await openDeclutterConfirm();
    expect(screen.getByText(/permanently removes anchor links/)).toBeTruthy();
    expect(screen.getByText(/won't be suggested again/)).toBeTruthy();
    expect(screen.getByText(/12 links/)).toBeTruthy();
    expect(pruneWeakLinksResult).not.toHaveBeenCalled();
    expect(pruneWeakLinks).not.toHaveBeenCalled();
  });

  it("cancelling the dialog runs nothing", async () => {
    await openDeclutterConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(pruneWeakLinksResult).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("confirming runs the prune and separates wrong links from cap trims in the report", async () => {
    pruneWeakLinksResult.mockResolvedValue({
      ok: true, pruned: 5, anchorPruned: 3, wrongPruned: 1, capTrimmed: 2, weakPruned: 2,
    });
    await openDeclutterConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Declutter" }));
    await waitFor(() => expect(pruneWeakLinksResult).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    const text = String(pushToast.mock.calls[0]![0]);
    expect(text).toContain("1 wrong link");
    expect(text).toContain("2 links trimmed");
    expect(text).toContain("2 weak ones sent here to review");
    expect(text).not.toContain("3 wrong"); // the old toast lumped all three anchor removals as "wrong"
  });
});

describe("REG-204 — a failed declutter is a failure, never 'already tidy'", () => {
  it("a rejected prune toasts the failure and offers a retry, with no tidy copy", async () => {
    pruneWeakLinksResult.mockRejectedValue(new Error("server down"));
    await openDeclutterConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Declutter" }));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    const text = String(pushToast.mock.calls[0]![0]);
    expect(text).toMatch(/Couldn't declutter/);
    expect(text).toMatch(/try again/i);
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("already tidy"), expect.anything(), expect.any(Number));
  });

  it("an { ok: false } result is the same failure state (no throw needed)", async () => {
    pruneWeakLinksResult.mockResolvedValue({ ok: false });
    await openDeclutterConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Declutter" }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't declutter"), "⚠️", expect.any(Number)));
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("already tidy"), expect.anything(), expect.any(Number));
  });

  it("a confirmed zero-prune still renders the 'already tidy' copy", async () => {
    pruneWeakLinksResult.mockResolvedValue(ZEROS);
    await openDeclutterConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Declutter" }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("already tidy"), "✨", expect.any(Number)));
  });
});
