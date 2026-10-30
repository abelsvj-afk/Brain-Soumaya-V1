import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { STORY } from "@brain/shared";
import { STORY_ART } from "./storyArt.js";

describe("the Book's pictures", () => {
  const ids = new Set(STORY.entries.map((e) => e.id));
  it("only ever illustrate real entries, each with a describing alt text and a small web-sized file that exists", () => {
    for (const [id, art] of Object.entries(STORY_ART)) {
      expect(ids.has(id), id).toBe(true);
      expect(art.alt.length, id).toBeGreaterThan(30);
      const file = resolve(__dirname, "../../public", art.src.replace(/^\//, ""));
      expect(existsSync(file), `${id}: ${file}`).toBe(true);
      expect(statSync(file).size, id).toBeLessThan(150 * 1024); // web-sized, never the 2 MB originals
    }
  });
  it("never explains what a picture means in its alt text", () => {
    for (const [id, art] of Object.entries(STORY_ART)) expect(art.alt, id).not.toMatch(/\b(means|represents|symboli[sz]es|because)\b/i);
  });
});
