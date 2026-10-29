import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

// Batch G: ReviewPanel must use the strict due-list fetch (REG-195) and
// resume a session from the day's graded set (REG-199).
const getDueReviews = vi.fn();
const getDueReviewsResult = vi.fn();
const gradeReviewDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  getDueReviews: (...a: unknown[]) => getDueReviews(...a),
  getDueReviewsResult: (...a: unknown[]) => getDueReviewsResult(...a),
  gradeReviewDetailed: (...a: unknown[]) => gradeReviewDetailed(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { ReviewPanel, spaceLocalDay } from "./ReviewPanel.js";

const DUE4 = [
  { id: 1, label: "first memory", content: "first content", strength: 0.4, reviewCount: 3 },
  { id: 2, label: "second memory", content: "second content", strength: 0.85, reviewCount: 7 },
  { id: 3, label: "third memory", content: "third content", strength: 0.2, reviewCount: 1 },
  { id: 4, label: "fourth memory", content: "fourth content", strength: 0.6, reviewCount: 2 },
];

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getDueReviews.mockResolvedValue(DUE4);
  getDueReviewsResult.mockResolvedValue({ ok: true, reviews: DUE4 });
  gradeReviewDetailed.mockResolvedValue({ ok: true, nextIntervalDays: 6 });
});
afterEach(cleanup);

describe("REG-195 — a failed due-list fetch is an error, never 'nothing due'", () => {
  it("renders an error/retry state, not the fresh-memories empty state", async () => {
    getDueReviewsResult.mockRejectedValue(new Error("network down"));
    render(<ReviewPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Couldn't check what's due/)).toBeTruthy();
    expect(screen.queryByText(/Nothing due right now/)).toBeNull();
    expect(screen.queryByText(/your memories are fresh/)).toBeNull();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("a non-OK result is the same error state (no throw needed)", async () => {
    getDueReviewsResult.mockResolvedValue({ ok: false });
    render(<ReviewPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Couldn't check what's due/)).toBeTruthy();
    expect(screen.queryByText(/Nothing due right now/)).toBeNull();
  });

  it("retry re-fetches and the session loads on success", async () => {
    getDueReviewsResult.mockRejectedValueOnce(new Error("network down"));
    render(<ReviewPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Couldn't check what's due/)).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("first memory")).toBeTruthy();
    expect(screen.queryByText(/Couldn't check what's due/)).toBeNull();
  });

  it("a confirmed empty list still renders the fresh-memories empty state", async () => {
    getDueReviewsResult.mockResolvedValue({ ok: true, reviews: [] });
    render(<ReviewPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Nothing due right now/)).toBeTruthy();
  });
});

describe("REG-199 — reopening Recall resumes the session", () => {
  it("restores the session position from the day's graded set", async () => {
    // Three grades already done today (e.g. in the session the label jump closed).
    localStorage.setItem(`review.doneToday.${spaceLocalDay()}`, "3");
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("first memory");
    // The four ungraded cards plus the three already graded today = a 7-card session,
    // and we are on card 4 — not restarted at card 1.
    expect(screen.getByText("4 of 7 this session")).toBeTruthy();
  });

  it("grading after a restore advances from the restored position", async () => {
    localStorage.setItem(`review.doneToday.${spaceLocalDay()}`, "3");
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("first memory");
    fireEvent.click(screen.getByText("Reveal & rate my recall"));
    await act(async () => { fireEvent.click(screen.getByText("I remembered")); });
    await screen.findByText("second memory");
    expect(screen.getByText("5 of 7 this session")).toBeTruthy();
  });

  it("the session-complete screen counts only this sitting's grades", async () => {
    localStorage.setItem(`review.doneToday.${spaceLocalDay()}`, "3");
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("first memory");
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByText("Reveal & rate my recall"));
      await act(async () => { fireEvent.click(screen.getByText("I remembered")); });
      if (i < 3) await screen.findByText(DUE4[i + 1]!.label);
    }
    await waitFor(() => expect(screen.getByText(/Session complete/)).toBeTruthy());
    // Four graded in this sitting (the three from earlier today are not this sitting's).
    expect(screen.getByText(/you revisited 4 memor/)).toBeTruthy();
  });
});
