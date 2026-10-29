import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { NpcRepo } from "../npcs/repo.js";
import { stopNpc } from "../npcs/loop.js";
import { worldsSnapshotText } from "./awareness.js";

const T0 = Date.parse("2026-10-29T15:00:00.000Z");
let h: DbHandle;
beforeEach(() => {
  h = createDb(":memory:");
});
afterEach(() => h.sqlite.close());

describe("worldsSnapshotText (Soumaya's awareness, §2a)", () => {
  it("names where the ship is and that Eternity is not her", () => {
    const t = worldsSnapshotText(h, "s1", T0)!;
    expect(t).toMatch(/ship is at: Home/);
    expect(t).toMatch(/He is NOT you/);
    expect(t).toMatch(/has not acted recently/);
  });
  it("reports his logged acts with their causes, newest first, never waits", () => {
    const r = new NpcRepo(h, "s1");
    r.appendLog("eternity", "wait", "Waited.", "quiet", T0 - 3_600_000);
    r.appendLog("eternity", "gesture", "blessing", "This galaxy has been alive lately", T0 - 1_800_000);
    const t = worldsSnapshotText(h, "s1", T0)!;
    expect(t).toMatch(/30 min ago he made the gesture "blessing" — why: This galaxy has been alive lately/);
    expect(t).not.toMatch(/waited/);
  });
  it("says when the owner has stopped him", () => {
    stopNpc(h, "s1", "eternity", T0);
    expect(worldsSnapshotText(h, "s1", T0)).toMatch(/stopped him/);
  });
  it("stays inside its own brain", () => {
    new NpcRepo(h, "s1").appendLog("eternity", "gesture", "joy", "x", T0 - 60_000);
    expect(worldsSnapshotText(h, "s2", T0)).toMatch(/has not acted recently/);
  });
});
