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

describe("the Road to the Seam gate", () => {
  it("opens once Teru's Harbor Nail is in this brain's Book, and refuses with a plain reason until then", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).roadGateOpen).toBe(false);
    try {
      t.depart({ clientKey: "r1", kind: "drift", destination: "road-to-the-seam" }, T0);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as TravelError).code).toBe("ROAD_GATE_CLOSED");
    }
    find("a", "relic.harbor-nail");
    expect(t.getState(T0).roadGateOpen).toBe(true);
    expect(t.depart({ clientKey: "r2", kind: "drift", destination: "road-to-the-seam" }, T0).destination).toBe("road-to-the-seam");
    expect(new TravelRepo(handle, "b").getState(T0).roadGateOpen).toBe(false);
  });
});

describe("the Village gate", () => {
  it("opens once the Thread of Many is in this brain's Book, and refuses with a plain reason until then", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).villageGateOpen).toBe(false);
    try {
      t.depart({ clientKey: "v1", kind: "drift", destination: "the-village" }, T0);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as TravelError).code).toBe("VILLAGE_GATE_CLOSED");
    }
    find("a", "relic.thread-of-many");
    expect(t.getState(T0).villageGateOpen).toBe(true);
    expect(t.depart({ clientKey: "v2", kind: "drift", destination: "the-village" }, T0).destination).toBe("the-village");
    expect(new TravelRepo(handle, "b").getState(T0).villageGateOpen).toBe(false);
  });
});

describe("the Unmade Hour gate", () => {
  it("opens once the Lullaby's Hollow is in this brain's Book, and refuses with a plain reason until then", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).unmadeGateOpen).toBe(false);
    try {
      t.depart({ clientKey: "u1", kind: "drift", destination: "the-unmade-hour" }, T0);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as TravelError).code).toBe("UNMADE_GATE_CLOSED");
    }
    find("a", "sight.lullaby-hollow");
    expect(t.getState(T0).unmadeGateOpen).toBe(true);
    expect(t.depart({ clientKey: "u2", kind: "drift", destination: "the-unmade-hour" }, T0).destination).toBe("the-unmade-hour");
    expect(new TravelRepo(handle, "b").getState(T0).unmadeGateOpen).toBe(false);
  });
});

describe("the Siege of the First Light gate", () => {
  it("opens once Oru's Bead is in this brain's Book, and refuses with a plain reason until then", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).siegeGateOpen).toBe(false);
    try {
      t.depart({ clientKey: "s1", kind: "drift", destination: "the-siege" }, T0);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as TravelError).code).toBe("SIEGE_GATE_CLOSED");
    }
    find("a", "obj.orus-bead");
    expect(t.getState(T0).siegeGateOpen).toBe(true);
    expect(t.depart({ clientKey: "s2", kind: "drift", destination: "the-siege" }, T0).destination).toBe("the-siege");
    expect(new TravelRepo(handle, "b").getState(T0).siegeGateOpen).toBe(false);
  });
});

describe("the Unlit Hulls gate", () => {
  it("opens once the Blank Nameplate is in this brain's Book, and refuses with a plain reason until then", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).yardGateOpen).toBe(false);
    try {
      t.depart({ clientKey: "y1", kind: "drift", destination: "the-yard" }, T0);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as TravelError).code).toBe("YARD_GATE_CLOSED");
    }
    find("a", "sight.blank-nameplate");
    expect(t.getState(T0).yardGateOpen).toBe(true);
    expect(t.depart({ clientKey: "y2", kind: "drift", destination: "the-yard" }, T0).destination).toBe("the-yard");
    expect(new TravelRepo(handle, "b").getState(T0).yardGateOpen).toBe(false);
  });
});

describe("the Long Morning gate", () => {
  it("opens once the Unnumbered Fragment is in this brain's Book, and refuses with a plain reason until then", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).longMorningGateOpen).toBe(false);
    try {
      t.depart({ clientKey: "l1", kind: "drift", destination: "the-long-morning" }, T0);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as TravelError).code).toBe("LONG_MORNING_GATE_CLOSED");
    }
    find("a", "relic.unnumbered-fragment");
    expect(t.getState(T0).longMorningGateOpen).toBe(true);
    expect(t.depart({ clientKey: "l2", kind: "drift", destination: "the-long-morning" }, T0).destination).toBe("the-long-morning");
    expect(new TravelRepo(handle, "b").getState(T0).longMorningGateOpen).toBe(false);
  });
});

describe("the Folded Letter gate", () => {
  it("opens once the Unopened Fold is in this brain's Book, and refuses with a plain reason until then", () => {
    const t = new TravelRepo(handle, "a");
    expect(t.getState(T0).foldedLetterGateOpen).toBe(false);
    try {
      t.depart({ clientKey: "f1", kind: "drift", destination: "the-folded-letter" }, T0);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as TravelError).code).toBe("FOLDED_LETTER_GATE_CLOSED");
    }
    find("a", "relic.unopened-fold");
    expect(t.getState(T0).foldedLetterGateOpen).toBe(true);
    expect(t.depart({ clientKey: "f2", kind: "drift", destination: "the-folded-letter" }, T0).destination).toBe("the-folded-letter");
    expect(new TravelRepo(handle, "b").getState(T0).foldedLetterGateOpen).toBe(false);
  });
});

describe("story gates with more than one way in", () => {
  it("opens the Long Morning for Orsolya's Shard too, and the Folded Letter for the open alcove together with Vesh's paper boat (never for only one of them)", () => {
    const t = new TravelRepo(handle, "m");
    expect(t.getState(T0).longMorningGateOpen).toBe(false);
    find("m", "relic.first-light-shard");
    expect(t.getState(T0).longMorningGateOpen).toBe(true);
    expect(t.getState(T0).foldedLetterGateOpen).toBe(false);
    find("m", "sight.open-alcove");
    expect(t.getState(T0).foldedLetterGateOpen).toBe(false); // one of the pair is not enough
    find("m", "obj.vesh-paper-boat");
    expect(t.getState(T0).foldedLetterGateOpen).toBe(true);
  });
});
