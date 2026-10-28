import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getLifeSeasons } from "./features.js";
import type { LifeSeason, JourneySpan } from "@brain/shared";

/**
 * REG-230 — the seasons paging loop accumulated duplicates: a server
 * returning the same 2-season page forever yielded 600 rows that were 300
 * copies of 2 seasons (no dedup; the old no-progress check measured raw
 * length, which grew on every repeat). Paged results are now deduplicated
 * by id, and a page that contributes zero NEW rows ends the loop.
 *
 * Fail-before: on the pre-fix client the stuck-server case returns 600
 * rows (2 unique seasons × 300) instead of 2.
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

describe("REG-230 — paged seasons are deduplicated, stuck pages stop the loop", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("the register's regression case: a stuck server returning the same 2-season page with total 600 → 2 unique rows", async () => {
    fetchMock().mockImplementation(async () =>
      jsonResponse({ seasons: [season(1), season(2)], journeySpans: [span(1)], totalSeasons: 600, totalJourneySpans: 600 }),
    );
    const d = await getLifeSeasons();
    expect(d).not.toBeNull();
    expect(d!.seasons).toHaveLength(2);
    expect(d!.seasons.map((s) => s.id)).toEqual([1, 2]);
    expect(d!.journeySpans).toHaveLength(1);
    // The loop ends after the second page adds nothing new — it never spins
    // to 300 pages chasing the server's total.
    expect(fetchMock().mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("a page that repeats rows from an earlier page still yields each row once", async () => {
    fetchMock().mockImplementation(async (url: string) => {
      const u = new URL(url, "http://localhost");
      const offset = Number(u.searchParams.get("offset") ?? "0");
      // Page 1: seasons 1–2. Page 2: season 2 again + season 3 (total 3).
      const seasons = offset === 0 ? [season(1), season(2)] : [season(2), season(3)];
      return jsonResponse({ seasons, journeySpans: [span(1)], totalSeasons: 3, totalJourneySpans: 1 });
    });
    const d = await getLifeSeasons();
    expect(d).not.toBeNull();
    expect(d!.seasons.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(d!.journeySpans).toHaveLength(1);
  });
});
