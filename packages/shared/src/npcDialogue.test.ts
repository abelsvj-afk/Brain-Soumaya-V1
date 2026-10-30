import { describe, expect, it } from "vitest";
import { NPC_TALK, NPC_TALK_BY_ID, canTalkTo, openSteps, pointerFor } from "./npcDialogue.js";
import { castMember, NPC_CAST } from "./npcs.js";
import { STORY_ENTRY_BY_ID } from "./storyCanon.js";
import { STORY_TRIGGERS } from "./storyTriggers.js";

const words = (s: string) => s.trim().split(/\s+/).length;
const BANNED = /\b(unlocked|complete|percent|score|quest|mission|level up)\b|%/i; // a door may be "locked"; the game may not be

describe("talking to the cast", () => {
  it("everyone with a conversation is a real speaking cast member — never Eternity, never the harbor controller", () => {
    for (const t of NPC_TALK) {
      const m = castMember(t.npc);
      expect(m, t.npc).toBeTruthy();
      expect(m!.speaks).toBe(true);
      expect(m!.canon).toBe("canon");
    }
    expect(canTalkTo("eternity")).toBe(false);
    expect(canTalkTo("harbor-controller")).toBe(false);
  });

  it("a thread's steps are exactly the cast member's lore layers, in order, with the same meeting counts", () => {
    for (const t of NPC_TALK) {
      const m = castMember(t.npc)!;
      expect(m.lore.layers.map((l) => l.key), t.npc).toEqual(t.thread.map((s) => s.id));
      expect(m.lore.layers.map((l) => l.minMeetings), t.npc).toEqual(t.thread.map((s) => s.minMeetings));
    }
  });

  it("every step follows the one before it, so a thread can only run in order", () => {
    for (const t of NPC_TALK) {
      t.thread.forEach((s, i) => {
        if (i === 0) expect(s.after).toBeUndefined();
        else expect(s.after, `${t.npc}.${s.id}`).toBe(t.thread[i - 1]!.id);
      });
    }
  });

  it("is short, number-free, and never scores, gates or sells anything", () => {
    for (const t of NPC_TALK) {
      const lines = [t.who, t.placeHome, t.placeAway, t.job, t.allFound, t.farewell, ...t.thread.flatMap((s) => [s.ask, s.say]), ...t.points.map((p) => p.say)];
      for (const l of lines) {
        expect(words(l), `${t.npc}: ${l}`).toBeLessThanOrEqual(45);
        expect(l, `${t.npc}: ${l}`).not.toMatch(/\d/);
        expect(l, `${t.npc}: ${l}`).not.toMatch(BANNED);
      }
    }
  });

  it("never says what the lore forbids saying (the Unnamed's name, whether she was a person, why he does not speak, the fold's words)", () => {
    const all = NPC_TALK.flatMap((t) => [t.who, t.placeHome, t.placeAway, t.job, ...t.thread.map((s) => s.say), ...t.points.map((p) => p.say)]).join(" ");
    expect(all).not.toMatch(/Unnamed|Noor|Folded One|the Uncounted/i);
  });

  it("each pointer names a real Book entry that is found in that person's own world or a world they roam", () => {
    for (const t of NPC_TALK) {
      const m = castMember(t.npc)!;
      const worlds = new Set([m.home, ...m.roams]);
      for (const p of t.points) {
        expect(STORY_ENTRY_BY_ID.has(p.entryId), p.entryId).toBe(true);
        const trig = STORY_TRIGGERS.filter((x) => x.entryId === p.entryId && (x.how === "regard" || x.how === "listen"));
        expect(trig.length, `${t.npc} → ${p.entryId} must be findable by stillness`).toBeGreaterThan(0);
        expect(trig.some((x) => worlds.has(x.world)), `${t.npc} → ${p.entryId} is in a world they never visit`).toBe(true);
      }
    }
  });

  it("opens a thread in order as you meet them more, and points toward the first thing not yet found", () => {
    const t = NPC_TALK_BY_ID.get("wayfarer")!;
    expect(openSteps(t, { meetings: 0, heard: new Set() })).toHaveLength(0);
    expect(openSteps(t, { meetings: 1, heard: new Set() }).map((s) => s.id)).toEqual(["calend.arrived"]);
    expect(openSteps(t, { meetings: 4, heard: new Set() }).map((s) => s.id)).toEqual(["calend.arrived"]); // later steps wait for the one before
    expect(openSteps(t, { meetings: 4, heard: new Set(["calend.arrived", "calend.seam"]) }).map((s) => s.id)).toEqual(["calend.arrived", "calend.seam", "calend.first"]);
    expect(pointerFor(t, new Set())?.entryId).toBe("sight.second-seam");
    expect(pointerFor(t, new Set(["sight.second-seam"]))?.entryId).toBe("sight.locked-room");
    expect(pointerFor(t, new Set(t.points.map((p) => p.entryId)))).toBeNull();
  });

  it("every cast member that speaks and is not Eternity or the controller can be talked to", () => {
    for (const c of NPC_CAST.filter((x) => x.speaks && x.id !== "eternity" && x.id !== "harbor-controller")) expect(canTalkTo(c.id), c.id).toBe(true);
  });
});
