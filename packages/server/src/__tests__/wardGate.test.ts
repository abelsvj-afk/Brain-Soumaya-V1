import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo, TravelError } from "../repositories/travel.repo.js";

/** The Faded Ward is a door in the story: it opens for a brain that has found Tamsin's Ward, and only that brain's own Book counts. */
const T0 = Date.parse("2026-10-31T07:00:00.000Z");
let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
  for (const sp of ["a", "b"]) handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(sp);
});
afterEach(() => handle.sqlite.close());
const find = (space: string, id: string) => handle.sqlite.prepare(`INSERT OR IGNORE INTO story_finds (space_id, entry_id, source) VALUES (?, ?, 'regard')`).run(space, id);

describe("the Faded Ward gate", () => {
  it("is closed until the ward has been found, and refuses a departure with a plain reason", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).wardGateOpen).toBe(false);
    expect(() => t.depart({ clientKey: "k1", kind: "drift", destination: "faded-ward" }, T0)).toThrowError(TravelError);
    try {
      t.depart({ clientKey: "k2", kind: "drift", destination: "faded-ward" }, T0);
    } catch (e) {
      expect((e as TravelError).code).toBe("WARD_GATE_CLOSED");
      expect((e as TravelError).message).toMatch(/ward in the People world/);
    }
  });

  it("opens once Tamsin's Ward is in this brain's Book — and not for another brain", () => {
    find("a", "sight.tamsins-ward");
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).wardGateOpen).toBe(true);
    expect(t.depart({ clientKey: "k3", kind: "drift", destination: "faded-ward" }, T0).destination).toBe("faded-ward");
    expect(new TravelRepo(handle, "b").getState(T0).wardGateOpen).toBe(false);
  });
});
