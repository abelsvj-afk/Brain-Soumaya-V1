import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { StoryError, StoryRepo, NOTE_MAX_CHARS } from "../story/story.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { setPreference } from "../agent/notify/policy.js";
import { STORY_ENTRIES, worldAnswers } from "@brain/shared";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/** docs/specs/lore-storage-2026-10-30.md — progress is private, id-only, idempotent, server-authoritative and never a number. */
const T0 = Date.parse("2026-10-30T07:00:00.000Z"); // 07:00 UTC = First Light for a brain whose clock is UTC (set below)
const DEEP = "sight.missing-stratum"; // regard · deep-past
const SEAM = "sight.second-seam"; // regard · great-station
const NAIL = "obj.doorkeepers-nail"; // npc wayfarer · great-station
const HARBOR_NAIL = "relic.harbor-nail"; // relic · great-station
const ANYWHERE = "obj.follower-ribbon"; // used where only the Book matters (granted directly)
const ANOTHER = "sight.blank-nameplate";

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
  for (const sp of ["spaceA", "spaceB"]) {
    handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(sp);
    setPreference(handle.sqlite, sp, "timezone", "UTC");
  }
});
afterEach(() => handle.sqlite.close());
const repo = (space = "spaceA") => new StoryRepo(handle, space);
/** Put the ship in a world for real, through the ledger (never a client claim). Returns a time safely after arrival. */
function goTo(world: string, key = world, space = "spaceA"): number {
  const t = new TravelRepo(handle, space);
  const j = t.depart({ clientKey: key, kind: "drift", destination: world }, T0);
  t.arrive(j.id, Date.parse(j.cancelDeadline) + 1000);
  return Date.parse(j.cancelDeadline) + 5000;
}
/** Give a brain a find directly (tests of links/notes/recall care about those, not about how it was found). */
function grant(id: string, space = "spaceA"): void {
  handle.sqlite.prepare(`INSERT OR IGNORE INTO story_finds (space_id, entry_id, source) VALUES (?, ?, 'regard')`).run(space, id);
}

describe("finds", () => {
  it("records a find once; replays are harmless and keep the first time", () => {
    const at = goTo("deep-past");
    const first = repo().find(DEEP, "regard", at);
    expect(first.isNew).toBe(true);
    const again = repo().find(DEEP, "regard", at + 60_000);
    expect(again.isNew).toBe(false);
    expect(again.foundAt).toBe(first.foundAt);
    expect(repo().book().finds).toHaveLength(1);
  });

  it("rejects an id that is not canon — a client can never invent a find", () => {
    const at = goTo("deep-past");
    expect(() => repo().find("obj.made-up", "regard", at)).toThrow(StoryError);
    expect(repo().book().finds).toEqual([]);
  });

  it("rejects an unknown source, and a way the canon does not allow for that entry", () => {
    const at = goTo("deep-past");
    expect(() => repo().find(DEEP, "telepathy", at)).toThrow(/source/);
    expect(() => repo().find(DEEP, "listen", at)).toThrow(/cannot be found that way/); // it is regarded, not heard
    expect(() => repo().find(DEEP, "npc:wayfarer", at)).toThrow(/cannot be found that way/);
    expect(() => repo().find("obj.follower-ribbon", "listen", at)).toThrow(/cannot be found that way/); // a ribbon is regarded, not heard
  });

  it("checks a find against where the travel ledger says the ship is", () => {
    // At home, nothing in a world can be found.
    expect(() => repo().find(DEEP, "regard", T0)).toThrow(/not there/);
    const deep = goTo("deep-past");
    expect(() => repo().find(SEAM, "regard", deep)).toThrow(/not there/); // right way, wrong world
    expect(repo().find(DEEP, "regard", deep).isNew).toBe(true);
  });

  it("releases a witness relic only in the world it rests in", () => {
    const deep = goTo("deep-past");
    expect(() => repo().find(HARBOR_NAIL, "relic", deep)).toThrow(/not there/);
    const station = goTo("great-station", "to-station");
    expect(repo().find(HARBOR_NAIL, "relic", station).isNew).toBe(true);
  });

  it("takes a met person's gift on their word (the meeting is only known to the client), but only the pairing the canon names", () => {
    expect(repo().find(NAIL, "npc:wayfarer", T0).isNew).toBe(true);
    expect(() => repo().find(NAIL, "npc:broker", T0)).toThrow(/cannot be found that way/);
  });

  it("the world answers once a day: the second stillness the same day is turned away, the next day it speaks again", () => {
    const at = goTo("deep-past");
    expect(repo().find("sight.missing-stratum", "regard", at).isNew).toBe(true);
    expect(() => repo().find("obj.follower-ribbon", "regard", at + 60_000)).toThrow(/Nothing stirs/);
    expect(repo().book().finds.map((f) => f.entryId)).toEqual(["sight.missing-stratum"]);
    // the same thing again is a harmless replay, never refused
    expect(repo().find("sight.missing-stratum", "regard", at + 120_000).isNew).toBe(false);
    // next day (any hour: its own seeded good day may or may not be today, so try the Hour it prefers)
    const tomorrowThreshold = Date.parse("2026-10-31T13:00:00.000Z"); // 13:00 = Threshold, the ribbon's own Hour
    expect(repo().find("obj.follower-ribbon", "regard", tomorrowThreshold).isNew).toBe(true);
  });

  it("outside its own Hour a sighting answers only on its good days — decided by a seed, so retrying cannot re-roll it", () => {
    const at = goTo("deep-past");
    // find a day when the stratum (First Light) does NOT answer at 15:00, and one when it does; then the answer is stable all day
    let quiet: number | null = null;
    let good: number | null = null;
    for (let d = 1; d <= 28 && (quiet === null || good === null); d++) {
      const t = Date.parse(`2026-11-${String(d).padStart(2, "0")}T15:00:00.000Z`);
      const key = new Date(t).toISOString().slice(0, 10);
      const answers = worldAnswers({ entryId: "sight.missing-stratum", hour: "first-light" }, 15, "spaceA", key);
      if (!answers && quiet === null) quiet = t;
      if (answers && good === null) good = t;
    }
    expect(quiet).not.toBeNull();
    expect(good).not.toBeNull();
    expect(() => repo().find("sight.missing-stratum", "regard", quiet!)).toThrow(/Nothing stirs/);
    expect(() => repo().find("sight.missing-stratum", "regard", quiet! + 600_000)).toThrow(/Nothing stirs/); // same day, same answer
    expect(at).toBeGreaterThan(0);
    expect(repo().find("sight.missing-stratum", "regard", good!).isNew).toBe(true);
  });

  it("is private to a brain", () => {
    const at = goTo("deep-past");
    repo("spaceA").find(DEEP, "regard", at);
    expect(repo("spaceB").book().finds).toEqual([]);
  });
});

describe("Concordance links", () => {
  it("need both ends found; store one sorted row for either direction; light only when canon joins them", () => {
    grant(ANYWHERE);
    expect(() => repo().link(ANYWHERE, ANOTHER)).toThrow(/not found/);
    grant(ANOTHER);
    const lit = repo().link(ANOTHER, ANYWHERE); // reversed on purpose
    expect(repo().link(ANYWHERE, ANOTHER).linkedAt).toBe(lit.linkedAt);
    expect(repo().book().links).toHaveLength(1);
    expect(repo().book().links[0]!.a < repo().book().links[0]!.b).toBe(true);
    expect(lit.lit).toBe(false); // a private guess the canon does not join: kept, harmless
    repo().unlink(ANYWHERE, ANOTHER);
    expect(repo().book().links).toEqual([]);
  });

  it("lights a pair the story itself joins (derived at read, not stored)", () => {
    grant("obj.vesh-paper-boat");
    grant("sight.lullaby-hollow");
    expect(repo().link("obj.vesh-paper-boat", "sight.lullaby-hollow").lit).toBe(true);
    expect(() => repo().link(ANYWHERE, ANYWHERE)).toThrow(/itself/);
  });
});

describe("notes and recall", () => {
  it("keeps a note per found entry, caps its length, and an empty note removes it", () => {
    expect(() => repo().setNote(ANYWHERE, "hi")).toThrow(/not found/);
    grant(ANYWHERE);
    repo().setNote(ANYWHERE, "  mine  ", T0);
    expect(repo().book().notes).toEqual([{ entryId: ANYWHERE, note: "mine", updatedAt: new Date(T0).toISOString() }]);
    repo().setNote(ANYWHERE, "revised", T0 + 1);
    expect(repo().book().notes).toHaveLength(1);
    expect(() => repo().setNote(ANYWHERE, "x".repeat(NOTE_MAX_CHARS + 1))).toThrow(/at most/);
    repo().setNote(ANYWHERE, "   ", T0 + 2);
    expect(repo().book().notes).toEqual([]);
  });

  it("recall bumps the entry and needs it to be found", () => {
    expect(() => repo().recall(ANYWHERE, T0)).toThrow(StoryError);
    grant(ANYWHERE);
    repo().recall(ANYWHERE, T0 + 5000);
    repo().recall(ANYWHERE, T0 + 9000);
    const f = repo().book().finds[0]!;
    expect(f.recallCount).toBe(2);
    expect(f.lastRecalledAt).toBe(new Date(T0 + 9000).toISOString());
  });

  it("ignores progress rows for ids that are no longer in canon (never an error)", () => {
    handle.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, source) VALUES ('spaceA', 'obj.long-gone', 'regard')`).run();
    expect(repo().book().finds).toEqual([]);
  });
});

describe("the tables belong to the brain", () => {
  it("are space-scoped, so deleting a brain removes them", () => {
    for (const t of ["story_finds", "story_links", "story_notes"]) expect(SPACE_SCOPED_TABLES).toContain(t);
  });
  it("canon has entries to find", () => {
    expect(STORY_ENTRIES.length).toBeGreaterThan(40);
  });
});

describe("/api/story over HTTP", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;
  let otherId: string;
  const call = (path: string, init: { method?: string; body?: unknown; space?: string } = {}) =>
    fetch(`${base}/api/story${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", "x-space-id": init.space ?? spaceId },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reg = async (tag: string) =>
      (
        (await (
          await fetch(`${base}/api/space/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }),
          })
        ).json()) as { id: string }
      ).id;
    spaceId = await reg("storyteller");
    otherId = await reg("bystander");
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("needs a brain (no anonymous progress)", async () => {
    const res = await fetch(`${base}/api/story/book`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("finds, links, notes and recalls end to end — and never returns a number", async () => {
    expect((await (await call("/book")).json()) as object).toEqual({ finds: [], links: [], notes: [] });
    const gifts: [string, string][] = [["obj.doorkeepers-nail", "npc:wayfarer"], ["obj.choirmasters-breath", "npc:cantor"]];
    for (const [id, source] of gifts) {
      const r = await call("/find", { method: "POST", body: { entryId: id, source } });
      expect(r.status).toBe(200);
    }
    const [A, B] = [gifts[0]![0], gifts[1]![0]];
    expect((await call("/link", { method: "PUT", body: { a: A, b: B } })).status).toBe(200);
    expect((await call("/note", { method: "PUT", body: { entryId: A, note: "a thought" } })).status).toBe(200);
    expect((await call("/recall", { method: "POST", body: { entryId: A } })).status).toBe(200);
    const book = (await (await call("/book")).json()) as { finds: unknown[]; links: unknown[]; notes: unknown[] };
    expect(book.finds).toHaveLength(2);
    expect(book.links).toHaveLength(1);
    expect(book.notes).toHaveLength(1);
    // The Book is lists only: no total, count, ratio or percentage key anywhere in the payload.
    expect(Object.keys(book).sort()).toEqual(["finds", "links", "notes"]);
    expect(JSON.stringify(book)).not.toMatch(/"(total|count|percent|progress|remaining|of)"/i);
    expect((await call("/link", { method: "DELETE", body: { a: B, b: A } })).status).toBe(200);
  });

  it("refuses forged and malformed input with 4xx, and keeps brains apart", async () => {
    expect((await call("/find", { method: "POST", body: { entryId: "obj.nope", source: "regard" } })).status).toBe(404);
    expect((await call("/find", { method: "POST", body: { entryId: "sight.missing-stratum", source: "regard" } })).status).toBe(403); // at home, not there
    expect((await call("/find", { method: "POST", body: { entryId: "obj.follower-ribbon", source: "listen" } })).status).toBe(403); // wrong way to find it
    expect((await call("/find", { method: "POST", body: { nonsense: 1 } })).status).toBe(400);
    expect((await call("/note", { method: "PUT", body: { entryId: "obj.kiths-drawing", note: "x" } })).status).toBe(403);
    expect(((await (await call("/book", { space: otherId })).json()) as { finds: unknown[] }).finds).toEqual([]);
  });
});

describe("/api/story/narration over HTTP", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;
  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    spaceId = (
      (await (
        await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: "listener", passcode: "secret123", name: "listener" }) })
      ).json()) as { id: string }
    ).id;
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });
  const get = (path: string) => fetch(`${base}/api/story${path}`, { headers: { "x-space-id": spaceId } });

  it("will not voice something you have not found (no leaking unfound lore)", async () => {
    expect((await get("/narration/obj.kiths-drawing")).status).toBe(403);
  });
  it("says 204 (read it yourself) when there is no key — and never errors", async () => {
    await fetch(`${base}/api/story/find`, { method: "POST", headers: { "Content-Type": "application/json", "x-space-id": spaceId }, body: JSON.stringify({ entryId: "obj.doorkeepers-nail", source: "npc:wayfarer" }) });
    const res = await get("/narration/obj.doorkeepers-nail?register=grave&tide=weight");
    expect(res.status).toBe(204);
  });
  it("a reaction clip: only a pairing the canon has, and only if you hold the thing", async () => {
    expect((await get("/narration/react/keeper?holds=relic.harbor-nail")).status).toBe(404); // the Keeper has nothing to say about that
    expect((await get("/narration/react/wayfarer?holds=relic.harbor-nail")).status).toBe(403); // real pairing, but not held
    await fetch(`${base}/api/story/find`, { method: "POST", headers: { "Content-Type": "application/json", "x-space-id": spaceId }, body: JSON.stringify({ entryId: "obj.dorrows-page", source: "npc:broker" }) });
    expect((await get("/narration/react/broker?holds=obj.dorrows-page")).status).toBe(204); // held, but no key in tests: read it yourself
  });
  it("serves the flavour key as words and labels only", async () => {
    const j = (await (await get("/flavor")).json()) as { on: boolean; key: { register: string; tide: { first: string }; lean: string[]; hour: string } };
    expect(["plain", "warm", "grave"]).toContain(j.key.register);
    expect(j.key.lean).toHaveLength(2);
    expect(JSON.stringify(j)).not.toMatch(/"(score|count|percent|total)"/i);
  });
});

describe("the owner's Voices console", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let ownerId: string;
  let otherId: string;
  const saved = process.env.OWNER_SPACE_IDS;
  const call = (path: string, space: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${base}/api/story${path}`, { method: init.method ?? "GET", headers: { "Content-Type": "application/json", "x-space-id": space }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reg = async (tag: string) =>
      ((await (await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }) })).json()) as { id: string }).id;
    ownerId = await reg("voiceowner");
    otherId = await reg("voiceguest");
    process.env.OWNER_SPACE_IDS = ownerId;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.OWNER_SPACE_IDS;
    else process.env.OWNER_SPACE_IDS = saved;
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("is for the owner only — everyone else gets 403 and nothing changes", async () => {
    expect((await call("/narration/voices", otherId)).status).toBe(403);
    expect((await call("/narration/voice", otherId, { method: "PUT", body: { role: "narrator", voiceId: "abcdefghij12" } })).status).toBe(403);
    expect((await call("/narration/test", otherId, { method: "POST", body: {} })).status).toBe(403);
    expect(ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM lore_voices`).get()).toEqual({ n: 0 });
  });
  it("lets the owner choose and clear a voice per role, and rejects nonsense", async () => {
    const put = (body: unknown) => call("/narration/voice", ownerId, { method: "PUT", body });
    expect((await put({ role: "calend", voiceId: "abcdefghij12" })).status).toBe(200);
    expect(ctx.handle.sqlite.prepare(`SELECT voice_id FROM lore_voices WHERE role = 'calend'`).get()).toEqual({ voice_id: "abcdefghij12" });
    expect((await put({ role: "calend", voiceId: "bad id; drop table" })).status).toBe(400);
    expect((await put({ role: "nobody", voiceId: "abcdefghij12" })).status).toBe(400);
    expect((await put({ role: "calend", voiceId: null })).status).toBe(200);
    expect(ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM lore_voices`).get()).toEqual({ n: 0 });
  });
  it("a test with no key says exactly why instead of failing silently", async () => {
    const r = await call("/narration/test", ownerId, { method: "POST", body: { role: "narrator" } });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toMatch(/API key|narrator voice/);
  });
});
