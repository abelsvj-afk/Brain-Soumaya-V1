import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const getDueReviews = vi.fn();
const gradeReviewDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  getDueReviews: (...a: unknown[]) => getDueReviews(...a),
  gradeReviewDetailed: (...a: unknown[]) => gradeReviewDetailed(...a),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
import { ReviewPanel } from "./ReviewPanel.js";

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getDueReviews.mockResolvedValue([
    { id: 1, label: "first memory", content: "first content", strength: 0.4, reviewCount: 3 },
    { id: 2, label: "second memory", content: "second content", strength: 0.85, reviewCount: 7 },
  ]);
  gradeReviewDetailed.mockResolvedValue({ ok: true, nextIntervalDays: 6 });
});
afterEach(cleanup);

describe("IM-114 — Recall shows strength/review count + next-review feedback", () => {
  it("renders the fetched strength and reviewCount for the current card", async () => {
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("first memory");
    expect(screen.getByTestId("rv-meta").textContent).toContain("Strength 40%");
    expect(screen.getByTestId("rv-meta").textContent).toContain("reviewed 3×");
  });

  it("after grading, displays when the memory will be reviewed next", async () => {
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("first memory");
    fireEvent.click(screen.getByText("Reveal & rate my recall"));
    await act(async () => { fireEvent.click(screen.getByText("I remembered")); });
    // Advanced to card 2, carrying the reschedule feedback from card 1's grade.
    await screen.findByText("second memory");
    expect(screen.getByText(/Next review in ~6 days/)).toBeTruthy();
    expect(screen.getByTestId("rv-meta").textContent).toContain("Strength 85%");
  });
});
