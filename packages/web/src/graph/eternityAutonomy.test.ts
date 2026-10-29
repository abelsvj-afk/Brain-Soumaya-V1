import { describe, expect, it } from "vitest";
import type { NpcLogEntry } from "@brain/shared";
import { ETERNITY_FRESH_MS, newestLogId, pickEternityPlayback } from "./eternityAutonomy.js";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const e = (id: number, kind: NpcLogEntry["kind"], act: string, agoMs = 60_000): NpcLogEntry => ({
  id, npcId: "eternity", kind, act, cause: "because", createdAt: new Date(NOW - agoMs).toISOString(),
});

describe("pickEternityPlayback", () => {
  it("plays a fresh unseen gesture", () => {
    expect(pickEternityPlayback([e(5, "gesture", "blessing")], 0, NOW)).toEqual({ kind: "gesture", gesture: "blessing", id: 5 });
  });
  it("plays the reorder tool", () => {
    expect(pickEternityPlayback([e(6, "reorder-light", "reorder-the-heavens")], 0, NOW)).toEqual({ kind: "tool", tool: "reorder", id: 6 });
  });
  it("never plays a seen, stale, wait, or non-autonomous act", () => {
    expect(pickEternityPlayback([e(5, "gesture", "blessing")], 5, NOW)).toBeNull();
    expect(pickEternityPlayback([e(5, "gesture", "blessing", ETERNITY_FRESH_MS + 1000)], 0, NOW)).toBeNull();
    expect(pickEternityPlayback([e(5, "wait", "Waited.")], 0, NOW)).toBeNull();
    expect(pickEternityPlayback([e(5, "gesture", "warning")], 0, NOW)).toBeNull();
    expect(pickEternityPlayback([e(5, "gesture", "sorrow")], 0, NOW)).toBeNull();
    expect(pickEternityPlayback([e(5, "speak", "hello")], 0, NOW)).toBeNull();
  });
  it("newestLogId counts waits as seen", () => {
    expect(newestLogId([e(9, "wait", "Waited."), e(4, "gesture", "joy")])).toBe(9);
    expect(newestLogId([])).toBe(0);
  });
});
