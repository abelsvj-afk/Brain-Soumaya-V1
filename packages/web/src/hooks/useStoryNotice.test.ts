import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as api from "../api/story.js";
import { NOTICE_MS, useStoryNotice } from "./useStoryNotice.js";

const anywhere = () => () => true; // a viewer standing at every spot (the lore's physical placement has its own tests)
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
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify, reach: anywhere }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 7)); // First Light: the Deep Past shows its missing stratum first
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

  it("the lore is in places: out of the ship, or away from every spot, the world does not answer", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    // 1. not deployed: a plain instruction, and no stillness is even begun
    const a = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn(), reach: () => null }));
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    vi.useFakeTimers();
    act(() => a.result.current.begin("regard"));
    expect(a.result.current.noticing).toBeNull();
    expect(a.result.current.caption).toMatch(/Take your ship out/);
    // 2. deployed but away from every spot: the full stillness passes and nothing stirs
    vi.useRealTimers();
    const b = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn(), reach: () => () => false }));
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 7));
    act(() => b.result.current.begin("regard"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS + 50);
    });
    expect(post).not.toHaveBeenCalled();
    expect(b.result.current.caption).toMatch(/as it was/);
    // 3. at the ribbon's spot only: the ribbon, not the stratum
    vi.useRealTimers();
    const c = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn(), reach: () => (t) => t.entryId === "obj.follower-ribbon" }));
    await waitFor(() => expect(c.result.current.loaded).toBe(true));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 7)); // First Light prefers the stratum — but she is not at its spot
    act(() => c.result.current.begin("regard"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS + 50);
    });
    expect(post).toHaveBeenCalledWith("obj.follower-ribbon", "regard");
  });

  it("a touch, key or scroll breaks the stillness: nothing is reported (the world answers someone who is there, not someone tapping)", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn(), reach: anywhere }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.begin("regard"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS / 2); // listeners are in place by now
    });
    expect(result.current.noticing).toBe("regard");
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(result.current.noticing).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS * 2);
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("pressing again lets the stillness go: nothing is reported", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book());
    const post = vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: true });
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn(), reach: anywhere }));
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
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book(["sight.missing-stratum", "obj.follower-ribbon"]));
    const post = vi.spyOn(api, "postStoryFind");
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "deep-past", notify: vi.fn(), reach: anywhere }));
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
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "quiet-archive", notify: vi.fn(), reach: anywhere }));
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
      await result.current.onMeeting("broker", 3); // not yet: she wants more than a few meetings
    });
    expect(post).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.onMeeting("wayfarer", 3);
      await result.current.onRelic("harbor-nail");
    });
    expect(post).toHaveBeenCalledWith("obj.doorkeepers-nail", "npc:wayfarer");
    expect(post).toHaveBeenCalledWith("relic.harbor-nail", "relic");
  });

  it("a met person remarks, sideways, on what you hold — and says nothing about what you do not", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book(["relic.witness-seed"]));
    vi.spyOn(api, "postStoryFind").mockResolvedValue({ entryId: "x", foundAt: "t", isNew: false });
    const notify = vi.fn();
    const { result } = renderHook(() => useStoryNotice({ active: true, world: "growing-place", notify }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.onMeeting("keeper", 1);
      await result.current.onMeeting("wayfarer", 3); // holds nothing she remarks on
    });
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Keeper: “Do not water what you cannot name\.”/));
    expect(notify).toHaveBeenCalledTimes(1);
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
