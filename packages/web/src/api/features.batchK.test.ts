import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTimeline,
  getTimelineResult,
  getLifeSeasons,
  addTimelineChapter,
  addTimelineChapterResult,
} from "./features.js";
import type { LifeSeason, JourneySpan } from "@brain/shared";

/**
 * Batch K — Chronicle client contracts (CHR-01 / CHR-11 / CHR-12):
 *  - getTimelineResult is strict: { ok: false } on network failure, HTTP
 *    error, or a malformed body — never a fake empty list. A confirmed
 *    empty success is { ok: true, chapters: [], total: 0 }.
 *  - The legacy getTimeline keeps its fail-soft contract ([] on failure)
 *    for its other callers, but unwraps the new { chapters, total } route
 *    shape instead of mistaking it for a malformed body.
 *  - getLifeSeasons fetches past the window: it pages (limit/offset)
 *    until the server's totals have arrived, instead of silently
 *    showing the first 100.
 *  - addTimelineChapterResult names the empty-window refusal
 *    ({ ok: false, empty: true }) so the surface can explain it
 *    instead of toasting a generic failure; the legacy wrapper still
 *    returns null there.
 *
 * Falsification: against the pre-change client the Result variants don't
 * exist (import failure) and getLifeSeasons returns only the first page.
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function season(id: number): LifeSeason {
  return {
    id, chapterId: id, label: `Era ${id}`, theme: "recovery", trend: "growth",
    confidence: 0.6, periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-03-31T00:00:00Z",
    startDate: "2026-01-01", endDate: "2026-03-31",
  };
}
function span(id: number): JourneySpan {
  return {
    journey: { id, title: `Journey ${id}`, description: "", status: "active", progress: 0.2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    start: "2026-01-01T00:00:00Z", end: "2026-07-01T00:00:00Z", ongoing: false,
    startDate: "2026-01-01", endDate: "2026-07-01", startSource: "explicit", endSource: "explicit",
  };
}

describe("Batch K — getTimelineResult (CHR-01)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("network failure, HTTP error, and malformed body are all { ok: false }", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getTimelineResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getTimelineResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(getTimelineResult()).resolves.toEqual({ ok: false });
  });

  it("a successful empty list is { ok: true, chapters: [], total: 0 } — true empty stays distinct", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ chapters: [], total: 0 }));
    await expect(getTimelineResult()).resolves.toEqual({ ok: true, chapters: [], total: 0 });
    // …and the legacy wrapper still fail-softs for its other callers.
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getTimeline()).resolves.toEqual([]);
  });

  it("carries the server total past the cap, and unwraps the object shape in the legacy wrapper", async () => {
    const chapters = [{ id: 501, title: "Latest" }];
    fetchMock().mockResolvedValue(jsonResponse({ chapters, total: 512 }));
    await expect(getTimelineResult()).resolves.toEqual({ ok: true, chapters, total: 512 });
    fetchMock().mockResolvedValue(jsonResponse({ chapters, total: 512 }));
    await expect(getTimeline()).resolves.toEqual(chapters);
  });

  it("still accepts the legacy bare-array shape (older server)", async () => {
    const chapters = [{ id: 1, title: "Old" }];
    fetchMock().mockResolvedValue(jsonResponse(chapters));
    await expect(getTimelineResult()).resolves.toEqual({ ok: true, chapters, total: 1 });
    fetchMock().mockResolvedValue(jsonResponse(chapters));
    await expect(getTimeline()).resolves.toEqual(chapters);
  });
});

describe("Batch K — getLifeSeasons pages past the window (CHR-11)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  /** A stub server that honours limit/offset over the fixture lists. */
  function pagingServer(allSeasons: LifeSeason[], allSpans: JourneySpan[]) {
    fetchMock().mockImplementation(async (url: string) => {
      const u = new URL(url, "http://localhost");
      const limit = Number(u.searchParams.get("limit") ?? "100");
      const offset = Number(u.searchParams.get("offset") ?? "0");
      return jsonResponse({
        seasons: allSeasons.slice(offset, offset + limit),
        journeySpans: allSpans.slice(offset, offset + limit),
        totalSeasons: allSeasons.length,
        totalJourneySpans: allSpans.length,
      });
    });
  }

  it("returns every season when the totals exceed one page", async () => {
    const allSeasons = Array.from({ length: 600 }, (_, i) => season(i + 1));
    const allSpans = [span(1)];
    pagingServer(allSeasons, allSpans);
    const d = await getLifeSeasons();
    expect(d).not.toBeNull();
    expect(d!.seasons).toHaveLength(600);
    expect(d!.journeySpans).toHaveLength(1);
    expect(d!.totalSeasons).toBe(600);
    expect(d!.totalJourneySpans).toBe(1);
    expect(fetchMock().mock.calls.length).toBeGreaterThan(1);
  });

  it("a single page is a single fetch; failure is still null", async () => {
    pagingServer([season(1)], [span(1)]);
    const d = await getLifeSeasons();
    expect(d).not.toBeNull();
    expect(d!.seasons).toHaveLength(1);
    expect(fetchMock().mock.calls.length).toBe(1);

    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getLifeSeasons()).resolves.toBeNull();
  });
});

describe("Batch K — addTimelineChapterResult names the empty window (CHR-12)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("a 409 empty-window refusal is { ok: false, empty: true }", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ error: "empty-window" }, false, 409));
    await expect(addTimelineChapterResult()).resolves.toEqual({ ok: false, empty: true });
    // The legacy wrapper still just reports null there.
    fetchMock().mockResolvedValue(jsonResponse({ error: "empty-window" }, false, 409));
    await expect(addTimelineChapter()).resolves.toBeNull();
  });

  it("success returns the chapter; other failures are { ok: false } without the empty flag", async () => {
    const ch = { id: 9, title: "Marked" };
    fetchMock().mockResolvedValue(jsonResponse(ch));
    await expect(addTimelineChapterResult()).resolves.toEqual({ ok: true, chapter: ch });
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(addTimelineChapterResult()).resolves.toEqual({ ok: false });
  });
});
