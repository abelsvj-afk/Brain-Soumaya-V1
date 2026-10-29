import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { GraphNode, TimelineChapter, LifeSeason } from "@brain/shared";

/**
 * Batch K — Chronicle rows (audit pass 11, 2026-10-23):
 *  - REG-121 (CHR-01): a failed chapters fetch renders the error state
 *    with retry, never the empty state; the empty state renders only on a
 *    confirmed empty success; post-delete / post-add refresh failures
 *    surface the same way (list kept, refresh error + retry).
 *  - REG-124 (CHR-05): an auto chapter is identifiable as Soumaya's
 *    telling from the chapter itself, in plain language.
 *  - REG-126 (CHR-07): past the cap the surface shows the newest chapters
 *    and states the list is truncated; "Latest" reaches the true latest.
 *  - REG-127 (CHR-08, disclosure half): the mark/delete affordances
 *    disclose the window consequence in plain language.
 *  - REG-130 (CHR-11): a failed seasons fetch is distinguishable from
 *    "no seasons yet", with retry.
 *  - REG-131 (CHR-12): marking over an empty window explains there is
 *    nothing new to narrate yet and writes nothing (server writes
 *    nothing; the client surfaces the refusal, not a generic failure).
 *
 * Falsification: every assertion targets copy/behaviour absent pre-change.
 * The component drives the new strict client contracts (getTimelineResult /
 * addTimelineChapterResult); the legacy mocks stay wired so the same file
 * also fails on the pre-change component, which never calls them.
 */

const getTimeline = vi.fn();
const getTimelineResult = vi.fn();
const addTimelineChapter = vi.fn();
const addTimelineChapterResult = vi.fn();
const deleteTimelineChapter = vi.fn();
const listAttachments = vi.fn();
const attachmentObjectUrl = vi.fn();
const getUpcomingEventsResult = vi.fn();
const getLifeSeasons = vi.fn();
const pushToast = vi.fn();

vi.mock("../api/client.js", () => ({
  getTimeline: (...a: unknown[]) => getTimeline(...a),
  getTimelineResult: (...a: unknown[]) => getTimelineResult(...a),
  addTimelineChapter: (...a: unknown[]) => addTimelineChapter(...a),
  addTimelineChapterResult: (...a: unknown[]) => addTimelineChapterResult(...a),
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
  getTimelineResult.mockResolvedValue({ ok: true, chapters: [], total: 0 });
  addTimelineChapter.mockResolvedValue(null);
  addTimelineChapterResult.mockResolvedValue({ ok: false });
  deleteTimelineChapter.mockResolvedValue(true);
  listAttachments.mockResolvedValue([]);
  attachmentObjectUrl.mockResolvedValue(null);
  getUpcomingEventsResult.mockResolvedValue({ ok: true, events: [] });
  getLifeSeasons.mockResolvedValue({ seasons: [], journeySpans: [], totalSeasons: 0, totalJourneySpans: 0 });
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

function season(over: Partial<LifeSeason> = {}): LifeSeason {
  return {
    id: 1, chapterId: 1, label: "Recovery Era", theme: "recovery", trend: "growth",
    confidence: 0.6, periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-03-31T00:00:00Z",
    startDate: "2026-01-01", endDate: "2026-03-31", ...over,
  };
}

async function renderWithChapters(chapters: TimelineChapter[], nodes: GraphNode[] = []) {
  getTimeline.mockResolvedValue(chapters);
  getTimelineResult.mockResolvedValue({ ok: true, chapters, total: chapters.length });
  const onFocus = vi.fn();
  render(<TimelineView spaceName="You" nodes={nodes} onClose={vi.fn()} onFocus={onFocus} />);
  await screen.findByText(chapters[0]!.title);
  return { onFocus };
}

describe("REG-121 (CHR-01) — a failed load is an error, never an empty Chronicle", () => {
  it("a failed chapters fetch renders the error state with retry, never the empty state", async () => {
    getTimelineResult.mockResolvedValue({ ok: false });
    render(<TimelineView spaceName="You" nodes={[]} onClose={vi.fn()} />);
    expect(await screen.findByText("Couldn't load your timeline.")).toBeTruthy();
    expect(screen.getByText("↻ Try again")).toBeTruthy();
    expect(screen.queryByText("Your chronicle begins as you live.")).toBeNull();
  });

  it("retry after a failure loads the chapters", async () => {
    getTimelineResult.mockResolvedValueOnce({ ok: false });
    render(<TimelineView spaceName="You" nodes={[]} onClose={vi.fn()} />);
    expect(await screen.findByText("Couldn't load your timeline.")).toBeTruthy();
    getTimelineResult.mockResolvedValue({ ok: true, chapters: CHAPTERS, total: CHAPTERS.length });
    fireEvent.click(screen.getByText("↻ Try again"));
    expect(await screen.findByText("The Big Move")).toBeTruthy();
    expect(screen.queryByText("Couldn't load your timeline.")).toBeNull();
  });

  it("a confirmed empty success renders the empty state, not the error", async () => {
    render(<TimelineView spaceName="You" nodes={[]} onClose={vi.fn()} />);
    expect(await screen.findByText("Your chronicle begins as you live.")).toBeTruthy();
    expect(screen.queryByText("Couldn't load your timeline.")).toBeNull();
  });

  it("a failed post-delete refresh keeps the list and surfaces a refresh error with retry", async () => {
    await renderWithChapters(CHAPTERS);
    // The next chapters fetch (the post-delete reload) fails.
    getTimelineResult.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByText("The Quiet Winter"));
    fireEvent.click(await screen.findByText("Delete chapter"));
    const confirmBtn = screen.getAllByText("Delete chapter").find((el) => el.closest(".confirm-card"));
    fireEvent.click(confirmBtn!);
    await waitFor(() => expect(deleteTimelineChapter).toHaveBeenCalledWith(1));
    expect(await screen.findByText("Couldn't refresh your timeline.")).toBeTruthy();
    expect(screen.getByText("↻ Try again")).toBeTruthy();
    // The (stale) list is kept — it never collapses into the empty state.
    expect(screen.getByText("The Big Move")).toBeTruthy();
    expect(screen.queryByText("Your chronicle begins as you live.")).toBeNull();
  });

  it("a failed post-add refresh keeps the list and surfaces a refresh error", async () => {
    await renderWithChapters(CHAPTERS);
    addTimelineChapterResult.mockResolvedValue({ ok: true, chapter: chapter({ id: 3, title: "Marked" }) });
    getTimelineResult.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByText("✍️ Mark this moment"));
    expect(await screen.findByText("Couldn't refresh your timeline.")).toBeTruthy();
    expect(screen.getByText("The Big Move")).toBeTruthy();
    expect(screen.queryByText("Your chronicle begins as you live.")).toBeNull();
  });
});

describe("REG-124 (CHR-05) — authorship is marked on the chapter itself", () => {
  it("an auto chapter says Soumaya wrote it; a user chapter says you marked it", async () => {
    const mixed = [
      chapter({ id: 1, title: "Auto Chapter", origin: "auto" }),
      chapter({ id: 2, title: "My Chapter", origin: "user", periodStart: "2026-03-01 00:00:00", periodEnd: "2026-03-31 00:00:00" }),
    ];
    await renderWithChapters(mixed);
    fireEvent.click(screen.getByText("Auto Chapter"));
    expect(await screen.findByText(/Soumaya wrote this/)).toBeTruthy();
    fireEvent.click(screen.getByText("My Chapter"));
    expect(await screen.findByText(/you marked this/)).toBeTruthy();
  });
});

describe("REG-126 (CHR-07) — past the cap the list says so", () => {
  it("states the truncation when the server total exceeds the shown chapters", async () => {
    getTimelineResult.mockResolvedValue({ ok: true, chapters: CHAPTERS, total: 512 });
    render(<TimelineView spaceName="You" nodes={[]} onClose={vi.fn()} />);
    await screen.findByText("The Big Move");
    expect(screen.getByText(/Showing the newest 2 of 512 chapters/)).toBeTruthy();
  });

  it("no truncation note when the total fits the shown list", async () => {
    await renderWithChapters(CHAPTERS);
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });
});

describe("REG-127 (CHR-08) — the mark/delete affordances disclose the window consequence", () => {
  it("the Mark button names the window consequence", async () => {
    await renderWithChapters(CHAPTERS);
    const btn = screen.getByText("✍️ Mark this moment");
    expect(btn.getAttribute("title") ?? "").toMatch(/starts fresh|next chapter starts from/i);
  });

  it("the empty state explains that marking gathers the window", async () => {
    render(<TimelineView spaceName="You" nodes={[]} onClose={vi.fn()} />);
    await screen.findByText("Your chronicle begins as you live.");
    expect(document.body.textContent ?? "").toMatch(/gathers everything since your last chapter/i);
  });

  it("deleting the NEWEST chapter discloses that its stretch can be told again", async () => {
    await renderWithChapters(CHAPTERS);
    fireEvent.click(screen.getByText("The Big Move"));
    fireEvent.click(await screen.findByText("Delete chapter"));
    const dialog = await screen.findByText("Delete this chapter?");
    expect(dialog.closest(".confirm-card")?.textContent ?? "").toMatch(/told again/i);
  });

  it("deleting an older chapter does NOT claim its stretch re-opens", async () => {
    await renderWithChapters(CHAPTERS);
    fireEvent.click(screen.getByText("The Quiet Winter"));
    fireEvent.click(await screen.findByText("Delete chapter"));
    const dialog = await screen.findByText("Delete this chapter?");
    expect(dialog.closest(".confirm-card")?.textContent ?? "").not.toMatch(/told again/i);
  });

  it("a successful mark confirms the window consequence", async () => {
    await renderWithChapters(CHAPTERS);
    addTimelineChapterResult.mockResolvedValue({ ok: true, chapter: chapter({ id: 3, title: "Marked" }) });
    const marked = [...CHAPTERS, chapter({ id: 3, title: "Marked", periodStart: "2026-04-01 00:00:00", periodEnd: "2026-04-02 00:00:00" })];
    getTimelineResult.mockResolvedValue({ ok: true, chapters: marked, total: marked.length });
    fireEvent.click(screen.getByText("✍️ Mark this moment"));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    expect(pushToast.mock.calls[0]?.[0]).toMatch(/starts from here/i);
  });
});

describe("REG-130 (CHR-11) — a failed seasons fetch is distinguishable from 'no seasons yet'", () => {
  it("a failed seasons fetch shows an honest note + retry, not silent absence", async () => {
    getLifeSeasons.mockResolvedValue(null);
    await renderWithChapters(CHAPTERS);
    expect(await screen.findByText("Couldn't load Life Seasons.")).toBeTruthy();
    expect(screen.getByText("↻ Try again")).toBeTruthy();
    expect(screen.queryByText("Life Seasons")).toBeNull();
  });

  it("retry after a seasons failure loads the band", async () => {
    getLifeSeasons.mockResolvedValueOnce(null);
    await renderWithChapters(CHAPTERS);
    expect(await screen.findByText("Couldn't load Life Seasons.")).toBeTruthy();
    getLifeSeasons.mockResolvedValue({
      seasons: [season()], journeySpans: [], totalSeasons: 1, totalJourneySpans: 0,
    });
    // The retry button inside the seasons note (the chapters' own retry is absent here).
    const retry = screen.getAllByText("↻ Try again").find((el) => el.closest(".tl-seasons-error"));
    fireEvent.click(retry!);
    expect(await screen.findByText("Life Seasons")).toBeTruthy();
    expect(screen.queryByText("Couldn't load Life Seasons.")).toBeNull();
  });

  it("a confirmed empty success stays quiet — no error, no band", async () => {
    await renderWithChapters(CHAPTERS);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("Couldn't load Life Seasons.")).toBeNull();
    expect(screen.queryByText("Life Seasons")).toBeNull();
  });
});

describe("REG-131 (CHR-12) — marking over an empty window explains instead of writing", () => {
  it("an empty-window refusal toasts 'nothing new to narrate yet', not a generic failure", async () => {
    await renderWithChapters(CHAPTERS);
    addTimelineChapterResult.mockResolvedValue({ ok: false, empty: true });
    fireEvent.click(screen.getByText("✍️ Mark this moment"));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    expect(pushToast.mock.calls[0]?.[0]).toMatch(/Nothing new to narrate yet/);
    expect(pushToast.mock.calls[0]?.[0]).not.toMatch(/Couldn't mark this moment/);
  });
});
