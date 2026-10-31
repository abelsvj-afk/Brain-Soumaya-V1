import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { ChoicesRepo } from "../story/choices.js";
import { RoadsRepo } from "../story/roads.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { StoryError } from "../story/story.js";

/** docs/specs/seam-the-folded-letter-2026-10-31.md §Choice — which, never what; made only inside the room; keeping is not final, opening is. */
let handle: DbHandle;
const T0 = Date.parse("2026-10-31T07:00:00.000Z");
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());
const find = (space: string, id: string) => handle.sqlite.prepare(`INSERT OR IGNORE INTO story_finds (space_id, entry_id, source) VALUES (?, ?, 'regard')`).run(space, id);
/** Put the brain in the Folded Letter (the owner-exempt path is not used: the gate is earned through the alcove + paper boat). */
function enterRoom(space: string) {
  find(space, "sight.open-alcove");
  find(space, "obj.vesh-paper-boat");
  const t = new TravelRepo(handle, space);
  const j = t.depart({ clientKey: `c-${space}`, kind: "drift", destination: "the-folded-letter" }, T0);
  t.getState(T0 + 11_000);
  t.arrive(j.id, T0 + 12_000);
  expect(t.currentWorld(T0 + 12_000)).toBe("the-folded-letter");
}

describe("the Folded Letter's choice (server)", () => {
  it("starts as no choice, and refuses to be made from anywhere but the room", () => {
    const c = new ChoicesRepo(handle, "a");
    expect(c.foldLetter()).toBeNull();
    expect(() => c.setFoldLetter("kept", T0)).toThrow(StoryError);
    expect(c.foldLetter()).toBeNull();
  });

  it("lets a brain in the room keep it folded, change its mind and open it, and never take the opening back", () => {
    enterRoom("a");
    const c = new ChoicesRepo(handle, "a");
    expect(c.setFoldLetter("kept", T0 + 13_000)).toBe("kept");
    expect(c.setFoldLetter("kept", T0 + 13_000)).toBe("kept"); // idempotent
    expect(c.setFoldLetter("opened", T0 + 14_000)).toBe("opened");
    expect(c.setFoldLetter("kept", T0 + 15_000)).toBe("opened"); // a read sentence cannot be unread
    expect(c.foldLetter()).toBe("opened");
  });

  it("is private per brain, never appears as a road, and stores no text at all", () => {
    enterRoom("a");
    new ChoicesRepo(handle, "a").setFoldLetter("kept", T0 + 13_000);
    expect(new ChoicesRepo(handle, "b").foldLetter()).toBeNull();
    expect(new RoadsRepo(handle, "a").list()).toEqual([]);
    const rows = handle.sqlite.prepare(`SELECT road_id, state FROM story_roads WHERE space_id = 'a'`).all() as { road_id: string; state: string }[];
    expect(rows).toEqual([{ road_id: "choice.fold-letter", state: "kept" }]);
  });
});
