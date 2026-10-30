import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as api from "../api/story.js";
import { NOTICE_MS, useStoryNotice } from "./useStoryNotice.js";

const book = (ids: string[] = []) => ({ finds: ids.map((entryId) => ({ entryId, foundAt: "2026-10-30T00:00:00Z", source: "regard", lastRecalledAt: null, recallCount: 0 })), links: [], notes: [] });

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("noticing", () => {
  it("staying still for the full time reports the thing this world has to show, once", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    const notify = vi.fn();
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.begin("regard"));
    expect(result.current.noticing).toBe("regard");
    expect(post).not.toHaveBeenCalled(); // not before the time is up
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS + 50);
    });
    expect(post).toHaveBeenCalledWith("sight.missing-stratum", "regard");
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/kept in the Book/));
    expect(result.current.noticing).toBeNull();
  });

  it("pressing again lets the stillness go: nothing is reported", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn() }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.begin("regard"));
    act(() => result.current.begin("regard"));
    expect(result.current.noticing).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS * 2);
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("when everything here is already found, the world is simply as it was (no report, no failure)", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book(["sight.missing-stratum"]));
    const post = vi.spyOn(api, "postStoryFind");
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn() }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.begin("regard"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS + 50);
    });
    expect(post).not.toHaveBeenCalled();
    expect(result.current.caption).toMatch(/as it was/);
  });

  it("listen turns up echoes, not sights", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "quiet-archive", notify: vi.fn() }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.begin("listen"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS + 50);
    });
    expect(post).toHaveBeenCalledWith("echo.hymnal-gap", "listen");
  });

  it("a met person gives what the canon says after enough meetings, and a relic is mirrored with its own id", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "great-station", notify: vi.fn() }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.onMeeting("broker", 1); // not yet: she wants two meetings
    });
    expect(post).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.onMeeting("wayfarer", 1);
      await result.current.onRelic("harbor-nail");
    });
    expect(post).toHaveBeenCalledWith("obj.doorkeepers-nail", "npc:wayfarer");
    expect(post).toHaveBeenCalledWith("relic.harbor-nail", "relic");
  });

  it("the stranger at the dock waits for a later day than the first, and comes once", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    const { result, rerender } = renderHook(() => useStoryNotice({ active: true, world: "great-station", notify: vi.fn() }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(post).not.toHaveBeenCalledWith("companion.dock-1", "companion"); // first day: only remembered
    localStorage.setItem("soumaya.story.first-day", "2020-01-01");
    rerender();
    const second = renderHook(() => useStoryNotice({ active: true, world: "great-station", notify: vi.fn() }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("companion.dock-1", "companion"));
    second.unmount();
  });
});
