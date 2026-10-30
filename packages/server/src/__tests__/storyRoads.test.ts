import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RoadsRepo } from "../story/roads.js";
import { StoryError } from "../story/story.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";

/** docs/specs/story-roads-2026-10-31.md — only the brain's choices are stored; "done" needs the road's finds; private per brain. */
let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());
const grant = (id: string, space = "a") => handle.sqlite.prepare(`INSERT OR IGNORE INTO story_finds (space_id, entry_id, source) VALUES (?, ?, 'regard')`).run(space, id);

describe("story roads (server)", () => {
  it("takes and rests a road, idempotently", () => {
    const r = new RoadsRepo(handle, "a");
    expect(r.list()).toEqual([]);
    r.set("road.open-alcove", "taken");
    r.set("road.open-alcove", "taken");
    expect(r.list()).toHaveLength(1);
    expect(r.set("road.open-alcove", "rested").state).toBe("rested");
  });

  it("refuses an unknown road and a finish the finds do not support", () => {
    const r = new RoadsRepo(handle, "a");
    expect(() => r.set("road.nope", "taken")).toThrow(StoryError);
    expect(() => r.set("road.open-alcove", "done")).toThrow(/not finished/);
    grant("sight.open-alcove");
    expect(() => r.set("road.open-alcove", "done")).toThrow(/not finished/);
    grant("sight.aldous-at-rest");
    expect(r.set("road.open-alcove", "done").state).toBe("done");
  });

  it("a finished road stays finished", () => {
    grant("sight.open-alcove");
    grant("sight.aldous-at-rest");
    const r = new RoadsRepo(handle, "a");
    r.set("road.open-alcove", "done");
    expect(r.set("road.open-alcove", "rested").state).toBe("done");
  });

  it("is private to a brain and covered by account deletion", () => {
    new RoadsRepo(handle, "a").set("road.open-alcove", "taken");
    expect(new RoadsRepo(handle, "b").list()).toEqual([]);
    expect(SPACE_SCOPED_TABLES).toContain("story_roads");
  });
});
