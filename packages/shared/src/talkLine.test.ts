import { describe, expect, it } from "vitest";
import { NPC_TALK } from "./npcDialogue.js";
import { talkLine } from "./talkLine.js";

describe("talkLine", () => {
  it("resolves every named line of every person, in their role voice", () => {
    for (const t of NPC_TALK) {
      for (const k of ["who", "place-home", "place-away", "job", "farewell", "allfound"]) expect(talkLine(t.npc, k)?.text, `${t.npc}/${k}`).toBeTruthy();
      for (const s of t.thread) expect(talkLine(t.npc, `step:${s.id}`)?.text).toBe(s.say);
      for (const p of t.points) expect(talkLine(t.npc, `point:${p.entryId}`)?.text).toBe(p.say);
    }
    expect(talkLine("cantor", "who")?.role).toBe("ysmerel");
  });
  it("never resolves what is not canon: unknown people, keys, or another person's road", () => {
    expect(talkLine("nobody", "who")).toBeNull();
    expect(talkLine("cantor", "step:nope")).toBeNull();
    expect(talkLine("cantor", "anything I like")).toBeNull();
    expect(talkLine("hesk", "road:road.open-alcove:offer")).toBeNull();
    expect(talkLine("archivist", "road:road.open-alcove:offer")?.text).toMatch(/alcove/);
    expect(talkLine("cantor", "rumour")?.text).toMatch(/six hours/);
  });
});
