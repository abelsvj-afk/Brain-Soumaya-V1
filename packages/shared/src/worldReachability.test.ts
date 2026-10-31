import { describe, expect, it } from "vitest";
import { STORY_ENTRIES } from "./storyCanon.js";
import { STORY_TRIGGERS } from "./storyTriggers.js";
import { RELICS } from "./relics.js";
import { STORY_WORLD_GATES } from "./worlds.js";
import { STORY_ROADS } from "./storyRoads.js";
import { NPC_CAST } from "./npcs.js";

/**
 * Playability proof (docs/AUDIT_PLAYABILITY_2026-10-31.md, gap G1): a normal (non-owner) brain must be able to reach every world and find every entry, using only what the app really offers. The two Scale/Quiet worlds' gate
 * relics were once `discoverable: false` — their doors could never open for anyone but the owner, and nothing noticed. This runs the same fixpoint a player runs: start with the base worlds, find what their triggers offer
 * (a relic only counts if it is discoverable in the app), open every story door whose set is held, repeat.
 */
const BASE = ["great-station", "growing-place", "deep-past", "quiet-archive", "scale", "people", "eternity"]; // People and Eternity are earned by counts / relics the app already offers
const relicOk = new Map(RELICS.map((r) => [`relic.${r.id}`, { ok: r.discoverable, world: r.world as string }]));

function fixpoint() {
  const open = new Set<string>(BASE);
  const found = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of STORY_ENTRIES) {
      if (found.has(e.id)) continue;
      const rel = relicOk.get(e.id);
      let got = !!rel && rel.ok && open.has(rel.world);
      for (const t of STORY_TRIGGERS) {
        if (t.entryId !== e.id || t.how === "relic") continue;
        if (t.world === "anywhere" || open.has(t.world)) got = true;
      }
      if (got) {
        found.add(e.id);
        changed = true;
      }
    }
    for (const [w, sets] of Object.entries(STORY_WORLD_GATES)) {
      if (!open.has(w) && sets.some((set) => set.every((id) => found.has(id)))) {
        open.add(w);
        changed = true;
      }
    }
  }
  return { open, found };
}

describe("a normal brain can play everything", () => {
  const { open, found } = fixpoint();
  it("reaches every story world", () => {
    const stuck = Object.keys(STORY_WORLD_GATES).filter((w) => !open.has(w));
    expect(stuck, `worlds no normal brain can ever open: ${stuck.join(", ")}`).toEqual([]);
  });
  it("can find every entry that has a way to be found (the relics the app cannot yet offer are listed, not hidden)", () => {
    const missing = STORY_ENTRIES.filter((e) => !found.has(e.id)).map((e) => e.id);
    const knownRelicGap = RELICS.filter((r) => !r.discoverable).map((r) => `relic.${r.id}`);
    expect(missing.filter((id) => !knownRelicGap.includes(id)), "entries with no obtainable trigger").toEqual([]);
  });
  it("lets every road be walked: its giver can be met in the road's world, and every step find can be found", () => {
    for (const r of STORY_ROADS) {
      const giver = NPC_CAST.find((n) => n.id === r.giver)!;
      expect(giver.home === r.world || giver.roams.includes(r.world), `${r.id}: ${r.giver} never visits ${r.world}`).toBe(true);
      for (const st of r.steps) if ("find" in st.signal) expect(found.has(st.signal.find) || relicOk.get(st.signal.find)?.ok === false, `${r.id}: step find ${st.signal.find} is unobtainable`).toBe(true);
    }
  });

  it("has company in every story world: at least three people live in or roam into it (the seams were thin at two)", () => {
    for (const w of Object.keys(STORY_WORLD_GATES)) {
      const here = NPC_CAST.filter((n) => n.home === w || n.roams.includes(w));
      expect(here.length, `${w} has only ${here.map((n) => n.id).join(", ")}`).toBeGreaterThanOrEqual(3);
    }
  });
});
