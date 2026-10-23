import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Batch B / CAP-06 (client half) — the offline queue must never claim
 * "saved" for something it did not store, and must never silently drop
 * the oldest capture at capacity.
 *  - queued for real        -> OfflineQueuedError (contract unchanged)
 *  - no brain signed in     -> honest error, NO "saved" claim, nothing queued
 *  - queue at 200 capacity  -> honest error naming the limit, oldest kept
 */

import { ingestText, OfflineQueuedError } from "./client.js";

const QUEUE_KEY = "brain.ingestQueue.space1";

function setOnline(onLine: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: onLine, configurable: true });
}
function queue(): { text: string }[] {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") as { text: string }[];
}

beforeEach(() => {
  localStorage.clear();
  setOnline(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setOnline(true);
});

describe("CAP-06 — ingestText offline honesty", () => {
  it("queues for real when offline with a signed-in brain (contract unchanged)", async () => {
    localStorage.setItem("brain.spaceId", "space1");
    await expect(ingestText("a real thought")).rejects.toBeInstanceOf(OfflineQueuedError);
    expect(queue().map((q) => q.text)).toEqual(["a real thought"]);
  });

  it("never claims 'saved' when no brain is signed in — nothing is queued and the error says so", async () => {
    // No brain.spaceId in storage.
    const err = await ingestText("orphan thought").then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OfflineQueuedError);
    // The OfflineQueuedError's claim ("You're offline — saved.") must not
    // appear; the honest negation ("couldn't be saved") must.
    expect(err!.message).not.toContain("You're offline — saved");
    expect(err!.message).toMatch(/couldn't be saved/i);
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("at capacity it refuses honestly instead of silently dropping the oldest", async () => {
    localStorage.setItem("brain.spaceId", "space1");
    const full = Array.from({ length: 200 }, (_, i) => ({ text: `thought ${i}` }));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(full));
    const err = await ingestText("one too many").then(() => null, (e: unknown) => e as Error);
    expect(err).not.toBeInstanceOf(OfflineQueuedError);
    expect(err!.message).toMatch(/full/i);
    expect(err!.message).toMatch(/200/);
    const after = queue();
    expect(after).toHaveLength(200);
    expect(after[0]!.text).toBe("thought 0"); // the oldest was NOT silently dropped
    expect(after.some((q) => q.text === "one too many")).toBe(false);
  });

  it("a network failure mid-request still queues (and says so via OfflineQueuedError)", async () => {
    localStorage.setItem("brain.spaceId", "space1");
    setOnline(true);
    vi.stubGlobal("fetch", async () => { throw new Error("socket gone"); });
    await expect(ingestText("mid-flight thought")).rejects.toBeInstanceOf(OfflineQueuedError);
    expect(queue().map((q) => q.text)).toEqual(["mid-flight thought"]);
  });
});
