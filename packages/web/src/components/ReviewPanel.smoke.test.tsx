import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

// Mock the API module so the component's fetch-on-mount is deterministic. This is the
// pattern for testing any data-driven component (the majority) under the new harness.
const getDueReviews = vi.fn();
const getDueReviewsResult = vi.fn();
const gradeReview = vi.fn();
const gradeReviewDetailed = vi.fn();
vi.mock("../api/client.js", () => ({
  getDueReviews: (...a: unknown[]) => getDueReviews(...a),
  getDueReviewsResult: (...a: unknown[]) => getDueReviewsResult(...a),
  gradeReview: (...a: unknown[]) => gradeReview(...a),
  gradeReviewDetailed: (...a: unknown[]) => gradeReviewDetailed(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { ReviewPanel, spaceLocalDay } from "./ReviewPanel.js";

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getDueReviews.mockResolvedValue([{ id: 1, label: "the studio lease", content: "Signed a 12-month lease on the King Street studio, $900 a month, keys collected on the 3rd.", strength: 0.1, reviewCount: 0 }]);
  getDueReviewsResult.mockResolvedValue({ ok: true, reviews: [{ id: 1, label: "the studio lease", content: "Signed a 12-month lease on the King Street studio, $900 a month, keys collected on the 3rd.", strength: 0.1, reviewCount: 0 }] });
  gradeReview.mockResolvedValue(true);
  gradeReviewDetailed.mockResolvedValue({ ok: true, nextIntervalDays: 6 });
});

afterEach(cleanup);

describe("ReviewPanel (recall session)", () => {
  it("loads a due memory, reveals on request, and grades the recall", async () => {
    render(<ReviewPanel onClose={vi.fn()} />);
    // The due memory's label appears once loaded.
    expect(await screen.findByText("the studio lease")).toBeTruthy();
    // Retrieval-first: the answer buttons only appear after you choose to reveal.
    expect(screen.queryByText("I remembered")).toBeNull();
    fireEvent.click(screen.getByText("Reveal & rate my recall"));
    fireEvent.click(screen.getByText("I remembered"));
    await waitFor(() => expect(gradeReviewDetailed).toHaveBeenCalledWith(1, true, expect.any(String)));
  });
});

describe("ReviewPanel — Reveal actually reveals the memory's content (IM-111)", () => {
  it("hides the content before Reveal and renders it after", async () => {
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("the studio lease");
    // Retrieval-first: the content must NOT be visible before the user chooses to reveal.
    expect(screen.queryByText(/Signed a 12-month lease/)).toBeNull();
    fireEvent.click(screen.getByText("Reveal & rate my recall"));
    expect(await screen.findByText(/Signed a 12-month lease on the King Street studio/)).toBeTruthy();
    // And the grade controls arrive alongside the revealed content.
    expect(screen.getByText("I remembered")).toBeTruthy();
  });
});

describe("ReviewPanel — grading is guarded against rapid double-taps", () => {
  it("only submits one grade even if the button is clicked twice before it resolves", async () => {
    let resolveGrade!: (v: never) => void;
    gradeReviewDetailed.mockReturnValue(new Promise((r) => { resolveGrade = r as never; }));
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("the studio lease");
    fireEvent.click(screen.getByText("Reveal & rate my recall"));
    const btn = screen.getByText("I remembered");
    fireEvent.click(btn);
    fireEvent.click(btn); // rapid second tap while the first is still in flight
    await act(async () => { resolveGrade({ ok: true } as never); });
    expect(gradeReviewDetailed).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewPanel — a failed grade doesn't vanish silently", () => {
  it("toasts and leaves the card revealed so the user can retry", async () => {
    gradeReviewDetailed.mockRejectedValue(new Error("network down"));
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("the studio lease");
    fireEvent.click(screen.getByText("Reveal & rate my recall"));
    await act(async () => { fireEvent.click(screen.getByText("I remembered")); });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"), "⚠️", expect.any(Number));
    // Still on the same card, still revealed — nothing silently advanced.
    expect(screen.getByText("the studio lease")).toBeTruthy();
    expect(screen.getByText("I remembered")).toBeTruthy();
  });
});

describe("ReviewPanel — a grade the server refused (boolean false) is not counted (IM-112)", () => {
  it("toasts, does not advance the session, and does not bump the daily count", async () => {
    getDueReviews.mockResolvedValue([
      { id: 1, label: "the studio lease", content: "lease content", strength: 0.1, reviewCount: 0 },
      { id: 2, label: "grandma's recipe", content: "recipe content", strength: 0.2, reviewCount: 1 },
    ]);
    getDueReviewsResult.mockResolvedValue({
      ok: true,
      reviews: [
        { id: 1, label: "the studio lease", content: "lease content", strength: 0.1, reviewCount: 0 },
        { id: 2, label: "grandma's recipe", content: "recipe content", strength: 0.2, reviewCount: 1 },
      ],
    });
    gradeReviewDetailed.mockResolvedValue({ ok: false }); // HTTP failure: the grade call reports ok:false
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("the studio lease");
    fireEvent.click(screen.getByText("Reveal & rate my recall"));
    await act(async () => { fireEvent.click(screen.getByText("I remembered")); });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"), "⚠️", expect.any(Number));
    // Session did NOT advance: still card 1 of 2, still revealed, second card not shown.
    expect(screen.getByText("1 of 2 this session")).toBeTruthy();
    expect(screen.getByText("the studio lease")).toBeTruthy();
    expect(screen.queryByText("grandma's recipe")).toBeNull();
    expect(screen.getByText("I remembered")).toBeTruthy();
    // Daily count did NOT bump: no doneToday key was written at all.
    const doneKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("review.doneToday.")) doneKeys.push(k);
    }
    expect(doneKeys).toEqual([]);
  });
});

describe("ReviewPanel — daily cap keys on the local day, not UTC (IM-113)", () => {
  it("spaceLocalDay uses the target timezone's calendar date at a near-midnight boundary", () => {
    // 02:30 UTC on Oct 21 is still Oct 20 (22:30) in America/New_York…
    const instant = new Date("2026-10-21T02:30:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-10-21"); // the old UTC key
    expect(spaceLocalDay(instant, "America/New_York")).toBe("2026-10-20");
    // …and already Oct 21 (16:30) in Pacific/Kiritimati — the zone is applied, not a fixed offset.
    expect(spaceLocalDay(instant, "Pacific/Kiritimati")).toBe("2026-10-21");
    // 11:30 UTC on Oct 20 is Oct 20 (07:30) in New York but Oct 21 (01:30) in Kiritimati.
    const earlier = new Date("2026-10-20T11:30:00Z");
    expect(spaceLocalDay(earlier, "America/New_York")).toBe("2026-10-20");
    expect(spaceLocalDay(earlier, "Pacific/Kiritimati")).toBe("2026-10-21");
  });

  it("a cap reached on the local day caps the panel even when the UTC day differs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // 01:30 UTC: in America/New_York (the test TZ) it is 21:30 the PREVIOUS local day.
      vi.setSystemTime(new Date("2026-10-21T01:30:00Z"));
      const localKey = `review.doneToday.${spaceLocalDay()}`;
      localStorage.setItem(localKey, "15"); // DAILY_CAP reached on the local day
      render(<ReviewPanel onClose={vi.fn()} />);
      expect(await screen.findByText(/You've done your reviews for today/)).toBeTruthy();
      // The cap short-circuits before any due fetch — under the old UTC key the
      // seeded count (filed under the local day) would have been invisible here.
      expect(getDueReviews).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ReviewPanel — stale doneToday keys don't accumulate forever", () => {
  it("removes an old day's key on mount, keeping only today's", async () => {
    localStorage.setItem("review.doneToday.2020-01-01", "3");
    render(<ReviewPanel onClose={vi.fn()} />);
    await screen.findByText("the studio lease");
    expect(localStorage.getItem("review.doneToday.2020-01-01")).toBeNull();
  });
});
