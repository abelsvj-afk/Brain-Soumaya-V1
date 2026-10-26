import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Mock the API module so the component's fetch-on-mount is deterministic.
const getDueReviews = vi.fn();
const getDueReviewsResult = vi.fn();
const gradeReview = vi.fn();
const gradeReviewDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  getDueReviews: (...a: unknown[]) => getDueReviews(...a),
  // Batch G (REG-195) switched ReviewPanel's fetch to the strict sibling;
  // this file's mock must provide it or the component throws on mount.
  getDueReviewsResult: (...a: unknown[]) => getDueReviewsResult(...a),
  gradeReview: (...a: unknown[]) => gradeReview(...a),
  gradeReviewDetailed: (...a: unknown[]) => gradeReviewDetailed(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { ReviewPanel } from "./ReviewPanel.js";

/**
 * REG-197 (RC-04, client half): the grade POST carries one idempotency key
 * per attempt — a retry of a grade the server committed but the client never
 * heard reuses the same key, so the server replays the outcome instead of
 * grading twice. REG-200 (RC-07): the panel names the fuel earned and any
 * streak advance at the moment the grade pays.
 */
const dueTwo = [
  { id: 1, label: "the studio lease", content: "lease content", strength: 0.1, reviewCount: 0 },
  { id: 2, label: "the old boat", content: "boat content", strength: 0.2, reviewCount: 1 },
];

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getDueReviews.mockResolvedValue(dueTwo);
  getDueReviewsResult.mockResolvedValue({ ok: true, reviews: dueTwo });
  gradeReview.mockResolvedValue(true);
});
afterEach(cleanup);

async function gradeCurrent(remembered: boolean) {
  // After a failed grade the card stays revealed, so Reveal is only there the
  // first time — click it only when present.
  const reveal = screen.queryByText("Reveal & rate my recall");
  if (reveal) fireEvent.click(reveal);
  fireEvent.click(screen.getByText(remembered ? "I remembered" : "Forgot"));
}

describe("REG-197/REG-200 — grade retry key + visible reward", () => {
  it("a failed grade retries with the SAME attempt key, and the next card mints a fresh one", async () => {
    gradeReviewDetailed
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ ok: true, nextIntervalDays: 6, fuelEarned: 3, streakAdvanced: false });
    render(<ReviewPanel onClose={vi.fn()} />);
    expect(await screen.findByText("the studio lease")).toBeTruthy();

    await gradeCurrent(true);
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith("Couldn't save that — try again.", "⚠️", 3500));
    expect(gradeReviewDetailed).toHaveBeenCalledTimes(1);
    const firstKey = gradeReviewDetailed.mock.calls[0]![2] as string;
    expect(typeof firstKey).toBe("string");
    expect(firstKey.length).toBeGreaterThan(0);

    // Same card, same grade, retry — the key must be identical.
    await gradeCurrent(true);
    await waitFor(() => expect(gradeReviewDetailed).toHaveBeenCalledTimes(2));
    expect(gradeReviewDetailed.mock.calls[1]![2]).toBe(firstKey);
    // The retry succeeded: the session advanced to card 2.
    expect(await screen.findByText("the old boat")).toBeTruthy();

    // Card 2's grade mints a fresh key — a genuinely new grade, not a replay.
    await gradeCurrent(true);
    await waitFor(() => expect(gradeReviewDetailed).toHaveBeenCalledTimes(3));
    const secondKey = gradeReviewDetailed.mock.calls[2]![2] as string;
    expect(secondKey).not.toBe(firstKey);
  });

  it("a successful grade names the fuel earned and the streak advance in the feedback", async () => {
    gradeReviewDetailed.mockResolvedValue({
      ok: true,
      nextIntervalDays: 6,
      fuelEarned: 5,
      streakAdvanced: true,
    });
    render(<ReviewPanel onClose={vi.fn()} />);
    expect(await screen.findByText("the studio lease")).toBeTruthy();
    await gradeCurrent(true);
    await waitFor(() =>
      expect(screen.getByText(/Next review in ~6 days\. · \+5 ⛽ · streak kept alive/)).toBeTruthy(),
    );
  });

  it("a grade with no reward fields keeps the schedule-only feedback (back-compatible)", async () => {
    gradeReviewDetailed.mockResolvedValue({ ok: true, nextIntervalDays: 6 });
    render(<ReviewPanel onClose={vi.fn()} />);
    expect(await screen.findByText("the studio lease")).toBeTruthy();
    await gradeCurrent(true);
    await waitFor(() => expect(screen.getByText(/Next review in ~6 days\./)).toBeTruthy());
    expect(screen.queryByText(/⛽/)).toBeNull();
  });
});
