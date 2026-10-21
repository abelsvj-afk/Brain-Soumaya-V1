import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getThoughtsResult,
  getThoughts,
  getPersonSuggestionsResult,
  getUpcomingEventsResult,
  getInquiriesResult,
  splitIdea,
  mergeIdeas,
} from "./mind.js";

/**
 * IM-45 / IM-136 client contracts:
 *  - The Result variants behind Mind's working-memory / people / events /
 *    inquiries refreshes must distinguish FAILURE ({ ok: false }) from a true
 *    empty success — the legacy wrappers returned [] for both, so a dead server
 *    rendered as a clear mind space / no suggestions / no events.
 *  - splitIdea / mergeIdeas (IM-136) report failure honestly (null / false).
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("IM-45 — Mind Result variants distinguish failure from empty", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("getThoughtsResult: network failure, HTTP error, and malformed body are all { ok: false }", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getThoughtsResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getThoughtsResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(getThoughtsResult()).resolves.toEqual({ ok: false });
  });

  it("getThoughtsResult: a successful empty list is { ok: true, thoughts: [] } — true empty stays distinct", async () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    await expect(getThoughtsResult()).resolves.toEqual({ ok: true, thoughts: [] });
    // …and the legacy wrapper still fail-softs for its other callers.
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getThoughts()).resolves.toEqual([]);
  });

  it("getPersonSuggestionsResult / getUpcomingEventsResult / getInquiriesResult follow the same contract", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getPersonSuggestionsResult()).resolves.toEqual({ ok: false });
    await expect(getUpcomingEventsResult()).resolves.toEqual({ ok: false });
    await expect(getInquiriesResult()).resolves.toEqual({ ok: false });

    fetchMock().mockResolvedValue(jsonResponse([{ name: "Mara", count: 3 }]));
    await expect(getPersonSuggestionsResult()).resolves.toEqual({ ok: true, suggestions: [{ name: "Mara", count: 3 }] });
    fetchMock().mockResolvedValue(jsonResponse([]));
    await expect(getUpcomingEventsResult()).resolves.toEqual({ ok: true, events: [] });
    await expect(getInquiriesResult()).resolves.toEqual({ ok: true, inquiries: [] });
  });
});

describe("IM-136 — split/merge client calls", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("splitIdea resolves { newId, moved } on success and posts the branch name", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ ok: true, id: 42, moved: 2 }));
    await expect(splitIdea(5, "Sailing half")).resolves.toEqual({ newId: 42, moved: 2 });
    const [url, init] = fetchMock().mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/cognitive/5/split");
    expect(JSON.parse(init.body as string)).toEqual({ newLabel: "Sailing half" });
  });

  it("splitIdea returns null on HTTP failure; mergeIdeas returns false", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ error: "Not an idea" }, false, 404));
    await expect(splitIdea(5, "Nope")).resolves.toBeNull();
    await expect(mergeIdeas(5, 6)).resolves.toBe(false);
  });

  it("mergeIdeas posts keep/drop and returns true on success", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ ok: true, keepId: 5 }));
    await expect(mergeIdeas(5, 6)).resolves.toBe(true);
    const [url, init] = fetchMock().mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/cognitive/merge");
    expect(JSON.parse(init.body as string)).toEqual({ keepId: 5, dropId: 6 });
  });
});
