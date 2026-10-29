import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import type { AppContext } from "../context.js";
import { ETERNITY_AUTONOMOUS_GESTURES } from "@brain/shared";
import { NpcRepo } from "./repo.js";
import { stopNpc } from "./loop.js";
import { broadcastFor, eternityPresence } from "./eternityPresence.js";

const NOW = Date.parse("2026-10-29T15:00:00.000Z");
let h: DbHandle;
const ctx = () => ({ handle: h }) as unknown as AppContext;
beforeEach(() => {
  h = createDb(":memory:");
});
afterEach(() => h.sqlite.close());

describe("eternityPresence (§2d/§2e)", () => {
  it("projection: every brain sees the same broadcast on the same day, an allowed gesture", () => {
    const a = eternityPresence(ctx(), "a", NOW);
    const b = eternityPresence(ctx(), "b", NOW);
    expect(a.broadcast).toEqual(b.broadcast);
    expect(ETERNITY_AUTONOMOUS_GESTURES).toContain(a.broadcast!.gesture);
    const days = new Set(Array.from({ length: 30 }, (_, i) => broadcastFor(`2026-11-${String(i + 1).padStart(2, "0")}`).gesture));
    expect(days.size).toBeGreaterThan(1); // it changes across days
  });
  it("burns brighter on a day he acted in this brain", () => {
    expect(eternityPresence(ctx(), "a", NOW).actedToday).toBe(false);
    new NpcRepo(h, "a").appendLog("eternity", "gesture", "joy", "x", NOW - 60_000);
    expect(eternityPresence(ctx(), "a", NOW).actedToday).toBe(true);
    expect(eternityPresence(ctx(), "b", NOW).actedToday).toBe(false);
  });
  it("parts the veil on a memory due for recall, and crowns a Journey finished this week", () => {
    h.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES ('a', 'Old promise', 'memory', 'x', 0.9, ?)`)
      .run(new Date(NOW - 40 * 86_400_000).toISOString());
    h.sqlite.prepare(`INSERT INTO journeys (space_id, title, status, ended_at) VALUES ('a', 'Marathon', 'done', ?)`).run(new Date(NOW - 2 * 86_400_000).toISOString());
    h.sqlite.prepare(`INSERT INTO journeys (space_id, title, status, ended_at) VALUES ('a', 'Ancient', 'done', ?)`).run(new Date(NOW - 40 * 86_400_000).toISOString());
    const p = eternityPresence(ctx(), "a", NOW);
    expect(p.veil?.label).toBe("Old promise");
    expect(p.crown?.title).toBe("Marathon");
    expect(eternityPresence(ctx(), "b", NOW).veil).toBeNull(); // brains stay separate
  });
  it("the kill switch silences his presence", () => {
    stopNpc(h, "a", "eternity", NOW);
    const p = eternityPresence(ctx(), "a", NOW);
    expect(p.stopped).toBe(true);
    expect(p.broadcast).toBeNull();
  });
});
