import { describe, expect, it } from "vitest";
import { STORY_ENTRIES, STORY } from "@brain/shared";
import { BOOK_H, BOOK_W, brightness, entryWords, skyLayout } from "./storyBook.js";

describe("the Book's sky", () => {
  it("places every entry, inside the field, stably (the same for everyone)", () => {
    const a = skyLayout();
    const b = skyLayout();
    expect(a).toEqual(b);
    expect(a).toHaveLength(STORY_ENTRIES.length);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(BOOK_W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(BOOK_H);
    }
  });

  it("keeps lights far enough apart to tap one at a time (measured nearest neighbour)", () => {
    const pts = skyLayout();
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) min = Math.min(min, Math.hypot(pts[i]!.x - pts[k]!.x, pts[i]!.y - pts[k]!.y));
    expect(min).toBeGreaterThanOrEqual(24);
  });
});

describe("brightness", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  it("is full when new, fades with neglect to a floor, and recall relights it", () => {
    const fresh = brightness({ foundAt: new Date(now).toISOString(), lastRecalledAt: null }, now);
    const old = brightness({ foundAt: new Date(now - 200 * 86_400_000).toISOString(), lastRecalledAt: null }, now);
    const recalled = brightness({ foundAt: new Date(now - 200 * 86_400_000).toISOString(), lastRecalledAt: new Date(now).toISOString() }, now);
    expect(fresh).toBe(1);
    expect(old).toBe(0.4);
    expect(recalled).toBe(1);
  });
});

describe("entry words", () => {
  const nail = STORY.entries.find((e) => e.id === "obj.doorkeepers-nail")!;
  it("gives the second reading only when a partner is held", () => {
    expect(entryWords(nail, new Set()).second).toBeNull();
    expect(entryWords(nail, new Set(["relic.harbor-nail"])).second).toMatch(/warm too/);
    expect(entryWords(nail, new Set()).text).toMatch(/always warm/);
  });
});

import { neutralFlavor } from "@brain/shared";
describe("flavoured words", () => {
  const kith = STORY.entries.find((e) => e.id === "obj.kiths-drawing")!;
  it("changes the wording by register but never the claim", () => {
    const plain = entryWords(kith, new Set(), neutralFlavor()).text!;
    const grave = entryWords(kith, new Set(), { ...neutralFlavor(), register: "grave" }).text!;
    expect(grave).not.toBe(plain);
    for (const tok of ["no face", "one more", "mouth"]) {
      expect(plain.toLowerCase()).toContain(tok);
      expect(grave.toLowerCase()).toContain(tok);
    }
  });
  it("the dock stranger takes a form that suits the tide, and stays unnamed", () => {
    const dock = STORY.entries.find((e) => e.id === "companion.dock-1")!;
    const k = { ...neutralFlavor(), register: "warm" as const, tide: { first: "weight" as const, second: "peace" as const } };
    expect(entryWords(dock, new Set(), k).text).toMatch(/^A child with a flask sat with you on the dock/);
    expect(entryWords(dock, new Set(), neutralFlavor()).text).toMatch(/^A stranger sat with you/);
  });
});
