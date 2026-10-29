import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { setPreference } from "../agent/notify/policy.js";
import { NotificationsRepo } from "../repositories/notifications.repo.js";
import { NpcRepo } from "./repo.js";
import { stopNpc } from "./loop.js";
import { runEternityContact, ETERNITY_SIGNATURE, resetEternityVoiceRetries } from "./eternityContact.js";
import { cleanLine, eternityMemories, templateLine } from "./eternityVoice.js";

/** Eternity's contact (§2c) and voice (§2b). New York time: 10:50Z = 06:50 EDT on 2026-10-29. */
const AT = (hhmmZ: string) => Date.parse(`2026-10-29T${hhmmZ}:00.000Z`);
const S = "s1";
let h: DbHandle;
beforeEach(() => {
  resetEternityVoiceRetries();
  h = createDb(":memory:");
  setPreference(h.sqlite, S, "timezone", "America/New_York");
});
afterEach(() => h.sqlite.close());

const inbox = () => new NotificationsRepo(h, S).list();
const speaks = () => new NpcRepo(h, S).recentLog("eternity").filter((e) => e.kind === "speak");

function seedMemory(label: string, content: string, extra: Record<string, unknown> = {}): void {
  const cols = ["space_id", "label", "type", "content", "emotional_weight", "created_at", ...Object.keys(extra)];
  const vals = [S, label, "memory", content, 0.8, new Date(AT("09:00")).toISOString(), ...Object.values(extra)];
  h.sqlite.prepare(`INSERT INTO nodes (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
}

describe("wake-up", () => {
  it("sends once at 06:45+ local: inbox + Telegram + his log, signed as him", async () => {
    const notify = vi.fn(async () => {});
    const r = await runEternityContact(h, S, { notify }, AT("10:50"));
    expect(r.sent).toBe("wake");
    expect(inbox()[0]!.text.startsWith(ETERNITY_SIGNATURE)).toBe(true);
    expect(inbox()[0]!.source).toBe("eternity");
    expect(notify).toHaveBeenCalledWith(S, expect.stringContaining(ETERNITY_SIGNATURE), { tool: "eternity_contact", occurrenceId: "eternity-wake:2026-10-29" });
    expect(speaks()).toHaveLength(1);
    expect(speaks()[0]!.cause).toMatch(/wake you/);
    expect((await runEternityContact(h, S, { notify }, AT("11:30"))).sent).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("not before 06:45, not after 11:00 local", async () => {
    expect((await runEternityContact(h, S, {}, AT("10:40"))).sent).toBeNull(); // 06:40
    expect((await runEternityContact(h, S, {}, AT("15:30"))).sent).toBeNull(); // 11:30
  });
  it("clearing the inbox never makes him wake you twice (his log is the record)", async () => {
    await runEternityContact(h, S, {}, AT("10:50"));
    h.sqlite.prepare(`DELETE FROM inbox_notifications`).run();
    expect((await runEternityContact(h, S, {}, AT("11:00"))).sent).toBeNull();
  });
  it("stopped or muted → silent", async () => {
    stopNpc(h, S, "eternity", AT("10:00"));
    expect((await runEternityContact(h, S, {}, AT("10:50"))).reason).toBe("stopped");
    const h2 = createDb(":memory:");
    new NpcRepo(h2, S).setContactMuted("eternity", true);
    expect((await runEternityContact(h2, S, {}, AT("10:50"))).reason).toBe("muted");
    h2.sqlite.close();
  });
  it("a Telegram failure still leaves the inbox message", async () => {
    const r = await runEternityContact(h, S, { notify: async () => { throw new Error("no chat"); } }, AT("10:50"));
    expect(r.sent).toBe("wake");
    expect(inbox()).toHaveLength(1);
  });
});

describe("visitation", () => {
  it("one more message on a day he acted, and only one", async () => {
    await runEternityContact(h, S, {}, AT("10:50")); // wake
    expect((await runEternityContact(h, S, {}, AT("16:00"))).sent).toBeNull(); // he has not acted
    new NpcRepo(h, S).appendLog("eternity", "gesture", "blessing", "alive", AT("15:00"));
    expect((await runEternityContact(h, S, {}, AT("16:00"))).sent).toBe("visitation");
    expect((await runEternityContact(h, S, {}, AT("17:00"))).sent).toBeNull();
    expect(speaks()).toHaveLength(2);
  });
});

describe("his voice", () => {
  it("uses his voice with a brief from the memories", async () => {
    seedMemory("Coffee with Maya", "She told me she is moving to Lisbon and I felt proud and sad at once");
    const voice = {
      eternalVoice: vi.fn(async (_o: string, brief: string) => {
        expect(brief).toMatch(/Coffee with Maya: She told me/);
        return "Rise. Maya's leaving is a door, not a loss.";
      }),
    };
    await runEternityContact(h, S, { voice }, AT("10:50"));
    expect(inbox()[0]!.text).toBe(`${ETERNITY_SIGNATURE} Rise. Maya's leaving is a door, not a loss.`);
    expect(speaks()[0]!.cause).toMatch(/his own words, from your recent memories/);
  });
  it("rate-limited or silent: he tries again in 3, 6, 12 minutes, then speaks his own lines", async () => {
    const voice = { eternalVoice: vi.fn(async () => { throw new Error("429 rate limited"); }) };
    const t = AT("10:50");
    expect((await runEternityContact(h, S, { voice }, t)).reason).toMatch(/retry in 3 min/);
    expect((await runEternityContact(h, S, { voice }, t + 60_000)).reason).toMatch(/voice retry in/); // waiting, no call
    expect(voice.eternalVoice).toHaveBeenCalledTimes(1);
    expect((await runEternityContact(h, S, { voice }, t + 3 * 60_000)).reason).toMatch(/retry in 6 min/);
    expect((await runEternityContact(h, S, { voice }, t + 9 * 60_000)).reason).toMatch(/retry in 12 min/);
    expect(inbox()).toHaveLength(0);
    const last = await runEternityContact(h, S, { voice }, t + 21 * 60_000);
    expect(last.sent).toBe("wake");
    expect(speaks()[0]!.cause).toMatch(/his own lines/);
    expect(voice.eternalVoice).toHaveBeenCalledTimes(4);
  });
  it("a retry that succeeds uses his voice, even past the wake window", async () => {
    let calls = 0;
    const voice = { eternalVoice: async () => { if (calls++ === 0) throw new Error("timeout"); return "Rise. The sky waited for you."; } };
    await runEternityContact(h, S, { voice }, AT("14:58")); // 10:58 local
    const r = await runEternityContact(h, S, { voice }, AT("15:01")); // 11:01 local — past 11:00, still finishing the wake
    expect(r.sent).toBe("wake");
    expect(inbox()[0]!.text).toMatch(/The sky waited for you/);
  });
  it("no AI key at all: his own lines at once; a 'Soumaya:' reply is never used", async () => {
    await runEternityContact(h, S, {}, AT("10:50"));
    expect(speaks()[0]!.cause).toMatch(/his own lines/);
    expect(cleanLine("Soumaya: hello")).toBeNull();
    expect(cleanLine(`"${"x".repeat(400)}"`)!.length).toBeLessThanOrEqual(280);
  });
  it("the brief is the user's own memories — not Soumaya's hubs, not to-dos", () => {
    seedMemory("Mine", "a real memory");
    seedMemory("Hub", "agent made", { origin: "agent" });
    seedMemory("Todo", "buy milk", { kind: "action" });
    expect(eternityMemories(h, S, AT("12:00")).map((m) => m.label)).toEqual(["Mine"]);
  });
  it("offline lines are deterministic, name at most one short label, and never an unweighty one", () => {
    const light = [{ id: 1, label: "Buy socks", excerpt: "", weighty: false }];
    for (const seed of ["a", "b", "c", "d", "e", "f"]) expect(templateLine("wake", light, seed)).not.toMatch(/Buy socks/);
    const m = [{ id: 1, label: "Coffee with Maya", excerpt: "", weighty: true }];
    expect(templateLine("wake", m, "seed")).toBe(templateLine("wake", m, "seed"));
    expect(templateLine("visitation", [], "seed").length).toBeGreaterThan(10);
  });
});
