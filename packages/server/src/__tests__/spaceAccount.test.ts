import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM, upsertEmbedding } from "../db/vec.js";
import { ftsUpsert } from "../db/fts.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";

/**
 * IM-129 (Q8 → option a): passcode change + brain deletion.
 *
 * These tests are the security contract for the two most destructive routes
 * in the app:
 *  - a passcode change must refuse a wrong current passcode (changing
 *    NOTHING) and, on success, kill the old login while the new one works;
 *  - a deletion must refuse on a wrong passcode OR a wrong/missing typed
 *    confirmation with ZERO rows removed (partial-failure atomicity), and
 *    on success must empty EVERY space-scoped table — checked against an
 *    independent census read from the live schema, not just the constant
 *    the implementation deletes from, so a table the implementation forgot
 *    fails this suite — plus the derived vec/FTS index rows, and leave a
 *    second brain completely untouched.
 */

let ctx: AppContext;
let server: Server;
let base: string;

const TAG_A = "ownerAlpha";
const PASS_A = "alpha-old-pass";
const TAG_B = "ownerBeta";
const PASS_B = "beta-pass-1234";
let idA: string;
let idB: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(
  method: string,
  path: string,
  opts: { spaceId?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.spaceId) headers["x-space-id"] = opts.spaceId;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function auth(gamerTag: string, passcode: string): Promise<{ status: number; body: any }> {
  return call("POST", "/api/space/auth", { body: { gamerTag, passcode } });
}

/** Independent census: every real table in the DB that carries a space_id
 *  column, straight from sqlite_master + PRAGMA — deliberately NOT imported
 *  from the implementation, so the two lists can disagree and fail loudly. */
function censusSpaceTables(): string[] {
  const names = ctx.handle.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  const out: string[] = [];
  for (const { name } of names) {
    if (name === "spaces") continue;
    const cols = ctx.handle.sqlite.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === "space_id")) out.push(name);
  }
  return out.sort();
}

function countFor(table: string, spaceId: string): number {
  const r = ctx.handle.sqlite
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE space_id = ?`)
    .get(spaceId) as { c: number };
  return r.c;
}

function snapshotCounts(spaceId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of censusSpaceTables()) m.set(t, countFor(t, spaceId));
  return m;
}

function expectCountsUnchanged(before: Map<string, number>, spaceId: string): void {
  for (const [t, c] of before) {
    expect(countFor(t, spaceId), `rows in ${t}`).toBe(c);
  }
}

/** Seed brain A with rows across a representative spread of space-scoped
 *  tables, including the derived vec/FTS index rows keyed by entity id. */
function seedBrain(spaceId: string): { nodeId: number; episodeId: number; chunkId: number } {
  const s = ctx.handle.sqlite;
  const node = s
    .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'alpha memory', 'note', 'alpha secret content')`)
    .run(spaceId);
  const nodeId = Number(node.lastInsertRowid);
  s.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, 'relates')`).run(spaceId, nodeId, nodeId);
  s.prepare(`INSERT INTO insights (space_id, node_a, node_b, text) VALUES (?, ?, ?, 'alpha insight')`).run(spaceId, nodeId, nodeId);
  s.prepare(`INSERT INTO attachments (space_id, node_id, filename, data) VALUES (?, ?, 'a.txt', 'QUJD')`).run(spaceId, nodeId);
  s.prepare(`INSERT INTO daily_logs (space_id, content) VALUES (?, 'alpha log')`).run(spaceId);
  s.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'act', 'desc', '[]')`).run(spaceId);
  s.prepare(`INSERT INTO telegram_links (chat_id, space_id, space_name) VALUES (424242, ?, 'Alpha')`).run(spaceId);
  s.prepare(`INSERT INTO lore (space_id, subject_type, subject_id, version, text) VALUES (?, 'memory', '1', 1, 'alpha lore')`).run(spaceId);
  const doc = s.prepare(`INSERT INTO knowledge_docs (space_id, name) VALUES (?, 'alpha doc')`).run(spaceId);
  const chunk = s
    .prepare(`INSERT INTO knowledge_chunks (space_id, doc_id, ordinal, content) VALUES (?, ?, 0, 'alpha chunk')`)
    .run(spaceId, Number(doc.lastInsertRowid));
  const chunkId = Number(chunk.lastInsertRowid);
  const profile = s
    .prepare(`INSERT INTO instruction_profiles (space_id, name, body) VALUES (?, 'alpha profile', 'be nice')`)
    .run(spaceId);
  const journey = s.prepare(`INSERT INTO journeys (space_id, title) VALUES (?, 'alpha journey')`).run(spaceId);
  s.prepare(`INSERT INTO fin_goal (space_id, bucket_id, name) VALUES (?, 1, 'alpha goal')`).run(spaceId);
  s.prepare(
    `INSERT INTO user_model (space_id, slot, content, confidence, valid_at, origin) VALUES (?, 'belief', 'alpha believes', 0.9, '2026-01-01T00:00:00Z', 'stated')`,
  ).run(spaceId);
  const ep = s
    .prepare(
      `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at) VALUES (?, 'session', 'alpha episode summary', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(spaceId);
  const episodeId = Number(ep.lastInsertRowid);
  s.prepare(
    `INSERT INTO notification_outbox (notif_key, space_id, tool, occurrence_id, message, deliver_after) VALUES ('nk-alpha', ?, 'reminder', 'occ-1', 'alpha msg', '2026-01-01T00:00:00Z')`,
  ).run(spaceId);
  s.prepare(`INSERT INTO working_memory (space_id, text) VALUES (?, 'alpha working')`).run(spaceId);

  // Derived indexes: rows keyed by entity id, invisible to a space_id delete.
  upsertEmbedding(s, nodeId, new Float32Array(EMBED_DIM).fill(0.25));
  ftsUpsert(s, nodeId, "alpha memory", "alpha secret content");
  s.prepare(`DELETE FROM vec_docs WHERE chunk_id = ?`).run(BigInt(chunkId));
  s.prepare(`INSERT INTO vec_docs (chunk_id, embedding) VALUES (?, ?)`)
    .run(BigInt(chunkId), Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer));
  s.prepare(`DELETE FROM vec_profiles WHERE profile_id = ?`).run(BigInt(Number(profile.lastInsertRowid)));
  s.prepare(`INSERT INTO vec_profiles (profile_id, embedding) VALUES (?, ?)`)
    .run(BigInt(Number(profile.lastInsertRowid)), Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer));
  s.prepare(`DELETE FROM vec_journeys WHERE journey_id = ?`).run(BigInt(Number(journey.lastInsertRowid)));
  s.prepare(`INSERT INTO vec_journeys (journey_id, embedding) VALUES (?, ?)`)
    .run(BigInt(Number(journey.lastInsertRowid)), Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer));
  s.prepare(`DELETE FROM vec_episodes WHERE episode_id = ?`).run(BigInt(episodeId));
  s.prepare(`INSERT INTO vec_episodes (episode_id, embedding) VALUES (?, ?)`)
    .run(BigInt(episodeId), Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer));
  s.prepare(`INSERT INTO episodes_fts (rowid, summary, detail) VALUES (?, 'alpha episode summary', 'alpha detail')`).run(episodeId);

  return { nodeId, episodeId, chunkId };
}

beforeAll(async () => {
  ctx = await buildContext({
    dbPath: ":memory:",
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
  });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const a = await auth(TAG_A, PASS_A);
  expect(a.status).toBe(200);
  idA = a.body.id;
  const b = await auth(TAG_B, PASS_B);
  expect(b.status).toBe(200);
  idB = b.body.id;
  expect(idA).not.toBe(idB);
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

describe("census sanity — the test's independent table list is real", () => {
  it("finds the space-scoped tables in the live schema", () => {
    const census = censusSpaceTables();
    // The implementation's deletion list must cover every table the schema
    // census finds — this is the assertion that catches a forgotten table.
    for (const t of census) {
      expect(SPACE_SCOPED_TABLES, `SPACE_SCOPED_TABLES is missing ${t}`).toContain(t);
    }
    expect(census.length).toBeGreaterThan(40);
  });
});

describe("POST /api/space/passcode — passcode change", () => {
  it("refuses without a valid space id (401)", async () => {
    const r = await call("POST", "/api/space/passcode", {
      body: { currentPasscode: PASS_A, newPasscode: "alpha-new-pass" },
    });
    expect(r.status).toBe(401);
  });

  it("refuses a wrong current passcode (401) and the passcode does NOT change", async () => {
    const r = await call("POST", "/api/space/passcode", {
      spaceId: idA,
      body: { currentPasscode: "not-the-passcode", newPasscode: "alpha-new-pass" },
    });
    expect(r.status).toBe(401);
    // Old passcode still logs in; the attempted new one does not.
    expect((await auth(TAG_A, PASS_A)).status).toBe(200);
    expect((await auth(TAG_A, "alpha-new-pass")).status).toBe(401);
  });

  it("refuses a too-short new passcode (400) with the registration minimum, changing nothing", async () => {
    const r = await call("POST", "/api/space/passcode", {
      spaceId: idA,
      body: { currentPasscode: PASS_A, newPasscode: "short" },
    });
    expect(r.status).toBe(400);
    expect((await auth(TAG_A, PASS_A)).status).toBe(200);
  });

  it("succeeds with the correct current passcode: old login dies, new login works, id unchanged", async () => {
    const r = await call("POST", "/api/space/passcode", {
      spaceId: idA,
      body: { currentPasscode: PASS_A, newPasscode: "alpha-new-pass" },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    expect((await auth(TAG_A, PASS_A)).status).toBe(401);
    const relogin = await auth(TAG_A, "alpha-new-pass");
    expect(relogin.status).toBe(200);
    // The space id is the bearer credential and does NOT rotate on a
    // passcode change (documented residual) — same brain, same id.
    expect(relogin.body.id).toBe(idA);
    const me = await call("GET", "/api/space/me", { spaceId: idA });
    expect(me.status).toBe(200);
  });
});

describe("DELETE /api/space — brain deletion", () => {
  const PASS_A2 = "alpha-new-pass"; // after the change above
  let seeded: { nodeId: number; episodeId: number; chunkId: number };

  beforeAll(() => {
    seeded = seedBrain(idA);
    // Brain B gets a node too, so the success case can prove isolation.
    ctx.handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'beta memory', 'note', 'beta content')`)
      .run(idB);
    ctx.handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'act', 'beta audit', '[]')`)
      .run(idB);
  });

  it("refuses a wrong passcode (401) and deletes ZERO rows", async () => {
    const before = snapshotCounts(idA);
    expect(before.get("nodes")).toBeGreaterThan(0);
    const r = await call("DELETE", "/api/space", {
      spaceId: idA,
      body: { passcode: "wrong-passcode", confirmation: TAG_A },
    });
    expect(r.status).toBe(401);
    expectCountsUnchanged(before, idA);
    expect((await call("GET", "/api/space/me", { spaceId: idA })).status).toBe(200);
  });

  it("refuses a wrong confirmation (400) and deletes ZERO rows", async () => {
    const before = snapshotCounts(idA);
    const r = await call("DELETE", "/api/space", {
      spaceId: idA,
      body: { passcode: PASS_A2, confirmation: "DELETE" },
    });
    expect(r.status).toBe(400);
    expectCountsUnchanged(before, idA);
  });

  it("refuses a case-mismatched confirmation (400) — the match is exact", async () => {
    const before = snapshotCounts(idA);
    const r = await call("DELETE", "/api/space", {
      spaceId: idA,
      body: { passcode: PASS_A2, confirmation: TAG_A.toLowerCase() },
    });
    expect(r.status).toBe(400);
    expectCountsUnchanged(before, idA);
  });

  it("refuses a missing confirmation (400) and deletes ZERO rows", async () => {
    const before = snapshotCounts(idA);
    const r = await call("DELETE", "/api/space", {
      spaceId: idA,
      body: { passcode: PASS_A2 },
    });
    expect(r.status).toBe(400);
    expectCountsUnchanged(before, idA);
  });

  it("refuses without a valid space id (401) and deletes ZERO rows", async () => {
    const before = snapshotCounts(idA);
    const r = await call("DELETE", "/api/space", {
      body: { passcode: PASS_A2, confirmation: TAG_A },
    });
    expect(r.status).toBe(401);
    expectCountsUnchanged(before, idA);
  });

  it("succeeds with passcode + exact gamer-tag confirmation: every table emptied, auth dead, other brain intact", async () => {
    const bBefore = snapshotCounts(idB);
    expect(bBefore.get("nodes")).toBeGreaterThan(0);
    const r = await call("DELETE", "/api/space", {
      spaceId: idA,
      body: { passcode: PASS_A2, confirmation: TAG_A },
    });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);

    // Every space-scoped table in the independent census is empty for A.
    for (const t of censusSpaceTables()) {
      expect(countFor(t, idA), `rows left in ${t}`).toBe(0);
    }
    // The spaces row itself is gone.
    const spaceRow = ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM spaces WHERE id = ?`).get(idA) as { c: number };
    expect(spaceRow.c).toBe(0);
    // Telegram link gone (the census covers it; assert explicitly too).
    const tg = ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM telegram_links WHERE space_id = ?`).get(idA) as { c: number };
    expect(tg.c).toBe(0);

    // Derived index rows keyed by entity id are gone too.
    const s = ctx.handle.sqlite;
    const count = (sql: string, v: unknown) =>
      (s.prepare(sql).get(v) as { c: number }).c;
    expect(count(`SELECT COUNT(*) AS c FROM vec_nodes WHERE node_id = ?`, BigInt(seeded.nodeId))).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM nodes_fts WHERE rowid = ?`, seeded.nodeId)).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM vec_docs WHERE chunk_id = ?`, BigInt(seeded.chunkId))).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM vec_episodes WHERE episode_id = ?`, BigInt(seeded.episodeId))).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM episodes_fts WHERE rowid = ?`, seeded.episodeId)).toBe(0);

    // Auth is dead: the old id no longer validates, and the old credentials
    // no longer open the brain — the same gamerTag+passcode now creates a
    // BRAND-NEW empty brain under a different id.
    expect((await call("GET", "/api/space/me", { spaceId: idA })).status).toBe(401);
    expect(
      (await call("DELETE", "/api/space", { spaceId: idA, body: { passcode: PASS_A2, confirmation: TAG_A } })).status,
    ).toBe(401);
    const recreated = await auth(TAG_A, PASS_A2);
    expect(recreated.status).toBe(200);
    expect(recreated.body.created).toBe(true);
    expect(recreated.body.id).not.toBe(idA);

    // The append-only guard on agent_logs was lifted ONLY for A's rows and
    // restored verbatim: the trigger still exists and still blocks a delete
    // of B's audit rows.
    const trig = ctx.handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_logs_no_delete'`)
      .get() as { c: number };
    expect(trig.c).toBe(1);
    expect(countFor("agent_logs", idB)).toBe(1);
    expect(() =>
      ctx.handle.sqlite.prepare(`DELETE FROM agent_logs WHERE space_id = ?`).run(idB),
    ).toThrow(/append-only/);

    // Brain B is completely untouched — every table, not just nodes.
    expectCountsUnchanged(bBefore, idB);
    expect((await call("GET", "/api/space/me", { spaceId: idB })).status).toBe(200);
    expect((await auth(TAG_B, PASS_B)).status).toBe(200);
  });
});
