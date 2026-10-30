import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { StoryError, StoryRepo, NOTE_MAX_CHARS } from "../story/story.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { STORY_ENTRIES } from "@brain/shared";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/** docs/specs/lore-storage-2026-10-30.md — progress is private, id-only, idempotent, server-authoritative and never a number. */
const T0 = Date.parse("2026-10-30T12:00:00.000Z");
const ANYWHERE = "obj.follower-ribbon"; // world: anywhere
const ANOTHER = "sight.blank-nameplate"; // world: anywhere
const PEOPLE = "obj.kiths-drawing"; // world: people
const DEEP = "sight.missing-stratum"; // world: deep-past

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());
const repo = (space = "spaceA") => new StoryRepo(handle, space);

describe("finds", () => {
  it("records a find once; replays are harmless and keep the first time", () => {
    const first = repo().find(ANYWHERE, "regard", T0);
    expect(first.isNew).toBe(true);
    const again = repo().find(ANYWHERE, "regard", T0 + 60_000);
    expect(again.isNew).toBe(false);
    expect(again.foundAt).toBe(first.foundAt);
    expect(repo().book().finds).toHaveLength(1);
  });

  it("rejects an id that is not canon — a client can never invent a find", () => {
    expect(() => repo().find("obj.made-up", "regard", T0)).toThrow(StoryError);
    expect(repo().book().finds).toEqual([]);
  });

  it("rejects an unknown source, and a companion source on a non-companion", () => {
    expect(() => repo().find(ANYWHERE, "telepathy", T0)).toThrow(/source/);
    expect(() => repo().find(ANYWHERE, "companion", T0)).toThrow(/companion/);
    expect(repo().find("companion.dock-1", "companion", T0).isNew).toBe(true);
  });

  it("checks a world find against where the travel ledger says the ship is", () => {
    // Home by default: the People world's entry cannot be found there, nor claimed from another world.
    expect(() => repo().find(PEOPLE, "world:people", T0)).toThrow(/not there/);
    expect(() => repo().find(PEOPLE, "world:great-station", T0)).toThrow(/not found there/);
    // An "anywhere" entry is found wherever the ship truly is.
    expect(repo().find(ANYWHERE, "world:home", T0).isNew).toBe(true);
    // Put the ship in the Deep Past for real, then the find is accepted.
    const t = new TravelRepo(handle, "spaceA");
    const j = t.depart({ clientKey: "k", kind: "drift", destination: "deep-past" }, T0);
    t.arrive(j.id, Date.parse(j.cancelDeadline) + 1000);
    const later = Date.parse(j.cancelDeadline) + 5000;
    expect(t.currentWorld(later)).toBe("deep-past");
    expect(repo().find(DEEP, "world:deep-past", later).isNew).toBe(true);
    expect(() => repo().find(PEOPLE, "world:deep-past", later)).toThrow(/not found there/); // right place, wrong world for that entry
  });

  it("is private to a brain", () => {
    repo("spaceA").find(ANYWHERE, "regard", T0);
    expect(repo("spaceB").book().finds).toEqual([]);
  });
});

describe("Concordance links", () => {
  it("need both ends found; store one sorted row for either direction; light only when canon joins them", () => {
    repo().find(ANYWHERE, "regard", T0);
    expect(() => repo().link(ANYWHERE, ANOTHER)).toThrow(/not found/);
    repo().find(ANOTHER, "regard", T0);
    const lit = repo().link(ANOTHER, ANYWHERE); // reversed on purpose
    expect(repo().link(ANYWHERE, ANOTHER).linkedAt).toBe(lit.linkedAt);
    expect(repo().book().links).toHaveLength(1);
    expect(repo().book().links[0]!.a < repo().book().links[0]!.b).toBe(true);
    expect(lit.lit).toBe(false); // a private guess the canon does not join: kept, harmless
    repo().unlink(ANYWHERE, ANOTHER);
    expect(repo().book().links).toEqual([]);
  });

  it("lights a pair the story itself joins (derived at read, not stored)", () => {
    repo().find("obj.vesh-paper-boat", "regard", T0);
    repo().find("sight.lullaby-hollow", "regard", T0);
    expect(repo().link("obj.vesh-paper-boat", "sight.lullaby-hollow").lit).toBe(true);
    expect(() => repo().link(ANYWHERE, ANYWHERE)).toThrow(/itself/);
  });
});

describe("notes and recall", () => {
  it("keeps a note per found entry, caps its length, and an empty note removes it", () => {
    expect(() => repo().setNote(ANYWHERE, "hi")).toThrow(/not found/);
    repo().find(ANYWHERE, "regard", T0);
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
    repo().find(ANYWHERE, "regard", T0);
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
    for (const id of [ANYWHERE, ANOTHER]) {
      const r = await call("/find", { method: "POST", body: { entryId: id, source: "regard" } });
      expect(r.status).toBe(200);
    }
    expect((await call("/link", { method: "PUT", body: { a: ANYWHERE, b: ANOTHER } })).status).toBe(200);
    expect((await call("/note", { method: "PUT", body: { entryId: ANYWHERE, note: "a thought" } })).status).toBe(200);
    expect((await call("/recall", { method: "POST", body: { entryId: ANYWHERE } })).status).toBe(200);
    const book = (await (await call("/book")).json()) as { finds: unknown[]; links: unknown[]; notes: unknown[] };
    expect(book.finds).toHaveLength(2);
    expect(book.links).toHaveLength(1);
    expect(book.notes).toHaveLength(1);
    // The Book is lists only: no total, count, ratio or percentage key anywhere in the payload.
    expect(Object.keys(book).sort()).toEqual(["finds", "links", "notes"]);
    expect(JSON.stringify(book)).not.toMatch(/"(total|count|percent|progress|remaining|of)"/i);
    expect((await call("/link", { method: "DELETE", body: { a: ANOTHER, b: ANYWHERE } })).status).toBe(200);
  });

  it("refuses forged and malformed input with 4xx, and keeps brains apart", async () => {
    expect((await call("/find", { method: "POST", body: { entryId: "obj.nope", source: "regard" } })).status).toBe(404);
    expect((await call("/find", { method: "POST", body: { entryId: PEOPLE, source: "world:people" } })).status).toBe(403);
    expect((await call("/find", { method: "POST", body: { nonsense: 1 } })).status).toBe(400);
    expect((await call("/note", { method: "PUT", body: { entryId: PEOPLE, note: "x" } })).status).toBe(403);
    expect(((await (await call("/book", { space: otherId })).json()) as { finds: unknown[] }).finds).toEqual([]);
  });
});
