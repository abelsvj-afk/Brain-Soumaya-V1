import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { GraphNode, TimelineChapter } from "@brain/shared";

/**
 * CL-15 Timeline items:
 *  - IM-121: chapter `theme` + `score` (change magnitude) render on rows + card.
 *  - IM-122: jump-to-latest, chapter search, honest add/delete failure
 *    toasts, delete via the shared ConfirmDialog, and a settled-but-empty
 *    photo slot reads "no photo", never a forever-loading 📷.
 *  - IM-123: chapter dates keep UTC grouping but SAY SO (header + card).
 *  - IM-137 (future-events portion): the "Ahead" section lists the existing
 *    future_event kind with dates; a failed fetch is an honest note + retry.
 *
 * Falsification: every assertion targets copy/behaviour absent pre-change.
 */

const getTimeline = vi.fn();
const addTimelineChapter = vi.fn();
const deleteTimelineChapter = vi.fn();
const listAttachments = vi.fn();
const attachmentObjectUrl = vi.fn();
const getUpcomingEventsResult = vi.fn();
// IM-132 composition (Round 2 coordinator): the merged TimelineView also
// fetches Life Seasons on mount — this suite predates CL-17a, so the mock
// must carry the export; null = the band's honest no-data path.
const getLifeSeasons = vi.fn();
const pushToast = vi.fn();

vi.mock("../api/client.js", () => ({
  getTimeline: (...a: unknown[]) => getTimeline(...a),
  addTimelineChapter: (...a: unknown[]) => addTimelineChapter(...a),
  deleteTimelineChapter: (...a: unknown[]) => deleteTimelineChapter(...a),
  listAttachments: (...a: unknown[]) => listAttachments(...a),
  attachmentObjectUrl: (...a: unknown[]) => attachmentObjectUrl(...a),
  getUpcomingEventsResult: (...a: unknown[]) => getUpcomingEventsResult(...a),
  getLifeSeasons: (...a: unknown[]) => getLifeSeasons(...a),
}));
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { TimelineView } from "./TimelineView.js";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  getTimeline.mockResolvedValue([]);
  addTimelineChapter.mockResolvedValue(null);
  deleteTimelineChapter.mockResolvedValue(true);
  listAttachments.mockResolvedValue([]);
  attachmentObjectUrl.mockResolvedValue(null);
  getUpcomingEventsResult.mockResolvedValue({ ok: true, events: [] });
  getLifeSeasons.mockResolvedValue(null);
});

function chapter(over: Partial<TimelineChapter>): TimelineChapter {
  return {
    id: 1,
    title: "Untitled",
    summary: "",
    theme: "",
    trend: "neutral",
    score: 0,
    periodStart: "2026-01-01 00:00:00",
    periodEnd: "2026-01-31 00:00:00",
    memoryIds: [],
    photoIds: [],
    threads: [],
    origin: "auto",
    createdAt: "2026-01-31 00:00:00",
    ...over,
  };
}

const CHAPTERS: TimelineChapter[] = [
  chapter({ id: 1, title: "The Quiet Winter", summary: "Rest and repair.", theme: "Recovery", score: 0.35, periodStart: "2026-01-01 00:00:00", periodEnd: "2026-01-31 00:00:00" }),
  chapter({ id: 2, title: "The Big Move", summary: "A new city, a new job.", theme: "Reinvention", score: 0.8, trend: "growth", periodStart: "2026-03-01 00:00:00", periodEnd: "2026-03-31 00:00:00" }),
];

async function renderWithChapters(chapters: TimelineChapter[], nodes: GraphNode[] = []) {
  getTimeline.mockResolvedValue(chapters);
  const onFocus = vi.fn();
  render(<TimelineView spaceName="You" nodes={nodes} onClose={vi.fn()} onFocus={onFocus} />);
  await screen.findByText(chapters[0]!.title);
  return { onFocus };
}

describe("IM-121 — theme + change magnitude render", () => {
  it("row shows the theme and the change percentage", async () => {
    await renderWithChapters(CHAPTERS);
    expect(screen.getByText(/✦ Reinvention/)).toBeTruthy();
    expect(screen.getByText("change 80%")).toBeTruthy();
    expect(screen.getByText(/✦ Recovery/)).toBeTruthy();
    expect(screen.getByText("change 35%")).toBeTruthy();
  });

  it("detail card shows theme + change magnitude", async () => {
    await renderWithChapters(CHAPTERS);
    fireEvent.click(screen.getByText("The Big Move"));
    expect(await screen.findByText("change magnitude 80%")).toBeTruthy();
  });
});

describe("IM-123 — UTC basis is labelled, not silent", () => {
  it("header names the UTC basis; the card repeats it next to the dates", async () => {
    await renderWithChapters(CHAPTERS);
    expect(screen.getByText(/chapter dates in UTC/)).toBeTruthy();
    fireEvent.click(screen.getByText("The Quiet Winter"));
    const when = await screen.findByText(/· UTC/);
    expect(when).toBeTruthy();
  });
});

describe("IM-122 — jump, search, honest failures, confirm, photos", () => {
  it("↓ Latest opens the newest chapter's card", async () => {
    await renderWithChapters(CHAPTERS);
    fireEvent.click(screen.getByText("↓ Latest"));
    expect(await screen.findByText("change magnitude 80%")).toBeTruthy();
  });

  it("search filters chapters by title/summary/theme and reports no-match", async () => {
    await renderWithChapters(CHAPTERS);
    const box = screen.getByLabelText("Search chapters");
    fireEvent.change(box, { target: { value: "reinvention" } });
    expect(screen.queryByText("The Quiet Winter")).toBeNull();
    expect(screen.getByText("The Big Move")).toBeTruthy();
    fireEvent.change(box, { target: { value: "zzz-no-match" } });
    expect(await screen.findByText(/No chapters match/)).toBeTruthy();
  });

  it("add failure toasts instead of silently doing nothing", async () => {
    addTimelineChapter.mockResolvedValue(null);
    await renderWithChapters(CHAPTERS);
    fireEvent.click(screen.getByText("✍️ Mark this moment"));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    expect(pushToast.mock.calls[0]?.[0]).toMatch(/Couldn't mark this moment/);
  });

  it("delete requires the ConfirmDialog; cancel deletes nothing", async () => {
    await renderWithChapters(CHAPTERS);
    fireEvent.click(screen.getByText("The Quiet Winter"));
    fireEvent.click(await screen.findByText("Delete chapter"));
    expect(await screen.findByText("Delete this chapter?")).toBeTruthy();
    expect(deleteTimelineChapter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(deleteTimelineChapter).not.toHaveBeenCalled();
  });

  it("confirmed delete calls the API; a failed delete toasts and keeps the chapter", async () => {
    deleteTimelineChapter.mockResolvedValue(false);
    await renderWithChapters(CHAPTERS);
    fireEvent.click(screen.getByText("The Quiet Winter"));
    fireEvent.click(await screen.findByText("Delete chapter"));
    const dialog = await screen.findByText("Delete this chapter?");
    expect(dialog).toBeTruthy();
    // The dialog's own confirm button (the card's Delete button opened it).
    const confirmBtn = screen.getAllByText("Delete chapter").find((el) => el.closest(".confirm-card"));
    fireEvent.click(confirmBtn!);
    await waitFor(() => expect(deleteTimelineChapter).toHaveBeenCalledWith(1));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    expect(pushToast.mock.calls[0]?.[0]).toMatch(/Couldn't delete that chapter/);
    // Chapter is still on the timeline (row + its still-open detail card).
    expect(screen.getAllByText("The Quiet Winter").length).toBeGreaterThan(0);
  });

  it("a photo slot with no image settles to an honest 'no photo' chip", async () => {
    const ch = chapter({ id: 7, title: "Beach Chapter", photoIds: [99], memoryIds: [99] });
    const nodes: GraphNode[] = [
      { id: 99, label: "Beach day", type: "daily", content: "", createdAt: "2026-01-15T00:00:00Z" },
    ];
    await renderWithChapters([ch], nodes);
    fireEvent.click(screen.getByText("Beach Chapter"));
    const chip = await screen.findByText(/no photo · Beach day/);
    expect(chip).toBeTruthy();
    // No bare forever-loading placeholder remains.
    expect(screen.queryByText("📷")).toBeNull();
  });
});

describe("IM-137 — future-events overlay section", () => {
  it("lists future events soonest-first with dates + day offsets; click focuses", async () => {
    getUpcomingEventsResult.mockResolvedValue({
      ok: true,
      events: [
        { id: 9, label: "Dentist appointment", date: "2026-10-24 15:00:00", inDays: 3 },
        { id: 10, label: "Visa renewal", date: "2026-11-02 09:00:00", inDays: 12 },
      ],
    });
    const { onFocus } = await renderWithChapters(CHAPTERS);
    expect(await screen.findByText("🔭 Ahead — future events")).toBeTruthy();
    const row = screen.getByText("Dentist appointment");
    expect(row.closest("button")!.textContent).toContain("in 3d");
    expect(screen.getByText("Visa renewal")).toBeTruthy();
    fireEvent.click(row.closest("button")!);
    expect(onFocus).toHaveBeenCalledWith(9);
  });

  it("a failed events fetch shows an honest note + retry, not a fake empty", async () => {
    getUpcomingEventsResult.mockResolvedValue({ ok: false });
    await renderWithChapters(CHAPTERS);
    expect(await screen.findByText("Couldn't load your future events.")).toBeTruthy();
    expect(screen.getByText("↻ Try again")).toBeTruthy();
  });

  it("no future events → no Ahead section (genuinely empty stays quiet)", async () => {
    await renderWithChapters(CHAPTERS);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("🔭 Ahead — future events")).toBeNull();
  });
});
