import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { computeFlavor, getFlavorOn, playCounts, setFlavorOn } from "../story/flavor.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { resetSocietyCache } from "../society/society.js";

const T0 = Date.parse("2026-10-30T15:00:00.000Z");
let h: DbHandle;
beforeEach(() => {
  h = createDb(":memory:");
  resetSocietyCache();
});
afterEach(() => h.sqlite.close());

describe("story flavour (server)", () => {
  it("is on by default, plain for a brain with nothing to read, and stable within a day", () => {
    expect(getFlavorOn(h, "s")).toBe(true);
    const a = computeFlavor(h, "s", T0);
    expect(a.key.register).toBeTruthy();
    expect(computeFlavor(h, "s", T0 + 3 * 3600_000).key.lean).toEqual(a.key.lean); // the leaning is fixed for the day
    expect(computeFlavor(h, "s", T0).key.tide).toEqual(a.key.tide);
  });

  it("off means the neutral key: plain wording, nothing read, nothing stored", () => {
    setFlavorOn(h, "s", false);
    const f = computeFlavor(h, "s", T0);
    expect(f.on).toBe(false);
    expect(f.key.register).toBe("plain");
    expect((h.sqlite.prepare(`SELECT COUNT(*) AS n FROM story_flavor_day`).get() as { n: number }).n).toBe(0);
  });

  it("counts only — a recall, a find and a world arrival move the counts, nothing reads text", () => {
    h.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source) VALUES ('s','sight.missing-stratum',?, 'regard')`).run(new Date(T0 - 86_400_000).toISOString());
    h.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source) VALUES ('s','relic.harbor-nail',?, 'relic')`).run(new Date(T0 - 86_400_000).toISOString());
    const c = playCounts(h, "s", T0);
    expect(c.noticings).toBe(1); // regard counts, a relic does not
    expect(c.recalls).toBe(0);
    expect(playCounts(h, "other", T0).noticings).toBe(0); // private to the brain
  });

  it("the tables belong to the brain", () => {
    for (const t of ["story_prefs", "story_flavor_day"]) expect(SPACE_SCOPED_TABLES).toContain(t);
  });

  it("never throws: a broken read falls back to the neutral key", () => {
    h.sqlite.exec(`DROP TABLE story_flavor_day`);
    const f = computeFlavor(h, "s", T0);
    expect(f.key.register).toBe("plain");
  });
});
