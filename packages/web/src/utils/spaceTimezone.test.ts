import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/**
 * Audit-2 item 2 — the shared space-timezone accessor.
 *
 * Contract: the SPACE's configured timezone (server store, read through
 * getSpacePreferences) is the one source every web day derivation uses.
 * The device zone is ONLY the pre-load fallback. These tests mock the
 * preferences API, so no network is involved.
 */

const getSpacePreferences = vi.fn();
vi.mock("../api/preferences.js", () => ({
  getSpacePreferences: (...a: unknown[]) => getSpacePreferences(...a),
}));

import {
  deviceTimeZone,
  ensureSpaceTimeZoneLoaded,
  getConfiguredSpaceTimeZone,
  getSpaceTimeZone,
  resetSpaceTimeZoneForTests,
  setSpaceTimeZone,
  subscribeSpaceTimeZone,
  useSpaceTimeZone,
} from "./spaceTimezone.js";

const PREFS = {
  timezone: "Pacific/Kiritimati",
  quietStart: "22:00",
  quietEnd: "07:00",
  digestTime: "07:30",
  dailyProactiveCap: 3,
};

beforeEach(() => {
  resetSpaceTimeZoneForTests();
  getSpacePreferences.mockReset();
});

afterEach(() => {
  cleanup(); // unmount hooks before the reset notifies subscribers
  resetSpaceTimeZoneForTests();
});

describe("spaceTimezone — pre-load fallback", () => {
  it("falls back to the device zone only before the configured zone loads", () => {
    expect(getConfiguredSpaceTimeZone()).toBeNull();
    expect(getSpaceTimeZone()).toBe(deviceTimeZone());
    expect(getSpaceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("spaceTimezone — loader", () => {
  it("loads the configured zone once, sharing the in-flight promise across callers", async () => {
    getSpacePreferences.mockResolvedValue(PREFS);
    const [a, b] = await Promise.all([ensureSpaceTimeZoneLoaded(), ensureSpaceTimeZoneLoaded()]);
    expect(a).toBe("Pacific/Kiritimati");
    expect(b).toBe("Pacific/Kiritimati");
    expect(getSpacePreferences).toHaveBeenCalledTimes(1);
    expect(getConfiguredSpaceTimeZone()).toBe("Pacific/Kiritimati");
    expect(getSpaceTimeZone()).toBe("Pacific/Kiritimati");
    // Cached now: a later call does not refetch.
    await ensureSpaceTimeZoneLoaded();
    expect(getSpacePreferences).toHaveBeenCalledTimes(1);
  });

  it("a failed load does not latch — a later call retries and can succeed", async () => {
    getSpacePreferences.mockResolvedValueOnce(null);
    expect(await ensureSpaceTimeZoneLoaded()).toBe(deviceTimeZone());
    expect(getConfiguredSpaceTimeZone()).toBeNull();
    getSpacePreferences.mockResolvedValueOnce(PREFS);
    expect(await ensureSpaceTimeZoneLoaded()).toBe("Pacific/Kiritimati");
    expect(getSpacePreferences).toHaveBeenCalledTimes(2);
  });
});

describe("spaceTimezone — setter (Settings write-through)", () => {
  it("records a valid zone and notifies subscribers; ignores invalid values", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeSpaceTimeZone(() => seen.push(getSpaceTimeZone()));
    setSpaceTimeZone("Not/AZone");
    expect(getConfiguredSpaceTimeZone()).toBeNull();
    expect(seen).toEqual([]);
    setSpaceTimeZone("America/New_York");
    expect(getSpaceTimeZone()).toBe("America/New_York");
    expect(seen).toEqual(["America/New_York"]);
    // Same value again: no change, no extra notification.
    setSpaceTimeZone("America/New_York");
    expect(seen).toEqual(["America/New_York"]);
    unsubscribe();
    setSpaceTimeZone("Pacific/Kiritimati");
    expect(seen).toEqual(["America/New_York"]);
  });
});

describe("useSpaceTimeZone — React hook", () => {
  it("re-renders with the configured zone once the load lands", async () => {
    let resolvePrefs!: (p: typeof PREFS) => void;
    getSpacePreferences.mockReturnValue(new Promise<typeof PREFS>((r) => { resolvePrefs = r; }));
    const { result } = renderHook(() => useSpaceTimeZone());
    // Pre-load render: the device fallback, honestly labelled as such by
    // getConfiguredSpaceTimeZone() being null at this point in other tests.
    expect(result.current).toBe(deviceTimeZone());
    await act(async () => {
      resolvePrefs(PREFS);
    });
    expect(result.current).toBe("Pacific/Kiritimati");
  });

  it("re-renders when Settings writes a new zone through the setter", async () => {
    getSpacePreferences.mockResolvedValue(null);
    const { result } = renderHook(() => useSpaceTimeZone());
    expect(result.current).toBe(deviceTimeZone());
    act(() => setSpaceTimeZone("America/New_York"));
    expect(result.current).toBe("America/New_York");
  });
});
