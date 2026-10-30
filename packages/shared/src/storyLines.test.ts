import { describe, expect, it } from "vitest";
import { STORY_ENTRY_BY_ID } from "./storyCanon.js";
import { STORY_LINES, checkStoryLines, lineView } from "./storyLines.js";

describe("Lines of keeping", () => {
  it("are well formed: real entries, two people or more, plain words", () => {
    expect(checkStoryLines(STORY_LINES, new Set(STORY_ENTRY_BY_ID.keys()))).toEqual([]);
    expect(STORY_LINES).toHaveLength(7);
  });

  it("light a person by any of their entries, and a thread by two people — never a count", () => {
    const line = STORY_LINES.find((l) => l.id === "line.door")!;
    expect(lineView(line, new Set())).toMatchObject({ lit: [], thread: false });
    expect(lineView(line, new Set(["relic.harbor-nail"]))).toMatchObject({ lit: ["Teru"], thread: false });
    expect(lineView(line, new Set(["relic.harbor-nail", "sight.gatepost-lamp"]))).toMatchObject({ lit: ["Teru", "Mara"], thread: true });
  });

  it("never lists an unlit person", () => {
    const v = lineView(STORY_LINES[0]!, new Set(["obj.orus-bead"]));
    expect(v.lit).toEqual(["Oru"]);
    expect(JSON.stringify(v)).not.toContain("Orsolya");
  });
});
