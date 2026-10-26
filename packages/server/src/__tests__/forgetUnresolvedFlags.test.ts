import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { createDb, bootstrapSchema, migrateSchema, type DbHandle } from "../db/client.js";
import { BOOTSTRAP_SQL } from "../db/schemaSql.js";
import BetterSqlite3 from "better-sqlite3";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { upsertProfileEmbedding } from "../db/vec.js";
import { HashEmbeddingProvider as _Hep } from "../embeddings/hash.js";
import { SourcesRepo } from "../repositories/sources.repo.js";
import { InstructionProfilesRepo } from "../repositories/instructions.repo.js";
import { SpacesRepo } from "../auth/spaces.js";
import {
  forgetSourceByRequest,
  containsVerbatimSpan,
  createForgetSourceRequest,
  approveForgetSourceRequest,
} from "../sources/forgetSource.js";

/**
 * Review surface for flagged forget rows (`unresolved`) — acceptance
 * tests T-F1…T-F11 (design note
 * `~/workspace/verbatim-recall/unresolved-flag-review-surface-design-2026-10-25.md`
 * §6). Each test is fail-before/pass-after against the HTTP surface
 * (buildContext + createApp + fetch), so the routes, the flag
 * persistence, and the content-free serialization are all proven
 * through the same door the Settings panel uses.
 *
 * Fixture shape (mirrors the fix-round-4 sweep test): source A holds
 * a 24-char span; a stated user_model row and an owner-pasted
 * instruction profile quote it and are left in place by policy;
 * a quoting *inferred* row is deleted by the span pass and must
 * never appear in the list.
 */

const SPAN = "alpha capture ZQXWEXCEPT"; // 24 chars, a true window of the source chunk
const SOURCE_TEXT = `alpha capture ZQXWEXCEPT alpha`;

let ctx: AppContext;
let server: Server;
let base: string;

async function startServer(dbPath: string): Promise<{ ctx: AppContext; server: Server; base: string }> {
  const c = await buildContext({
    dbPath,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
  });
  const app = createApp(c);
  const s = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { ctx: c, server: s, base: b };
}

async function authSpace(baseUrl: string, gamerTag: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag, passcode: "secret123", name: gamerTag }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

let spaceCounter = 0;
async function freshSpace(): Promise<string> {
  // Repo-level creation: /api/space/auth is rate-limited to 10 per
  // server, and this file needs a fresh space per test for flag
  // isolation. The HTTP guard accepts any space id that exists in
  // the DB, so a repo-created space is equivalent for the routes.
  spaceCounter += 1;
  const tag = `flag-tester-${spaceCounter}`;
  const created = new SpacesRepo(ctx.handle).authOrCreate(tag, "secret123", tag);
  expect(created).not.toBeNull();
  return created!.space.id;
}

async function get(path: string, space: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { "x-space-id": space } });
  return { status: res.status, body: await res.json() };
}

async function post(path: string, space: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-space-id": space },
  });
  return { status: res.status, body: await res.json() };
}

function approvedForgetRequest(handle: DbHandle, space: string, sourceId: number): number {
  const created = createForgetSourceRequest(handle, space, sourceId);
  expect(created.status).toBe("pending");
  const approved = approveForgetSourceRequest(handle, space, created.requestId);
  expect(approved.status).toBe("approved");
  return approved.requestId;
}

/** Seeds source A + one quoting stated row + one quoting profile + one quoting inferred row. */
function seedScenario(handle: DbHandle, space: string): {
  sourceId: number;
  statedId: number;
  profileId: number;
  profileName: string;
  inferredId: number;
  chunkTexts: string[];
} {
  const repo = new SourcesRepo(handle, space);
  const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: SOURCE_TEXT }).source;
  const chunkTexts = repo.chunksOf(srcA.id).map((c) => c.text);
  expect(chunkTexts.length).toBeGreaterThan(0);
  const nowIso = new Date().toISOString();
  const run = (sql: string, ...params: unknown[]) => handle.sqlite.prepare(sql).run(...params);
  const statedId = Number(
    run(
      `INSERT INTO user_model (space_id, slot, content, confidence, evidence_ids, valid_at, origin)
       VALUES (?, 'belief', ?, 0.8, '[]', ?, 'stated')`,
      space, `I said ${SPAN} myself`, nowIso,
    ).lastInsertRowid,
  );
  const inferredId = Number(
    run(
      `INSERT INTO user_model (space_id, slot, content, confidence, evidence_ids, valid_at, origin)
       VALUES (?, 'belief', ?, 0.8, '[]', ?, 'inferred')`,
      space, `I believe the note said ${SPAN} and more`, nowIso,
    ).lastInsertRowid,
  );
  const profiles = new InstructionProfilesRepo(handle, space);
  const profileName = `my unique probe ${SPAN}`;
  const profile = profiles.create({ name: profileName, body: `always remember ${SPAN} when answering` });
  return { sourceId: srcA.id, statedId, profileId: profile.id, profileName, inferredId, chunkTexts };
}

beforeAll(async () => {
  ({ ctx, server, base } = await startServer(":memory:"));
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

describe("review surface for flagged forget rows (T-F1…T-F11)", () => {
  it("T-F1 — flag persists across a restart (file-backed DB, close + reopen)", async () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "forget-flags-restart-"));
    const file = nodePath.join(dir, "brain.db");
    try {
      const first = await startServer(file);
      try {
        const s1 = await authSpace(first.base, "restart-tester");
        const seed = seedScenario(first.ctx.handle, s1);
        const res = forgetSourceByRequest(first.ctx.handle, approvedForgetRequest(first.ctx.handle, s1, seed.sourceId));
        expect(res.unresolved).toHaveLength(2);
        const before = await (async () => {
          const r = await fetch(`${first.base}/api/forget-requests/unresolved`, { headers: { "x-space-id": s1 } });
          expect(r.status).toBe(200);
          return (await r.json()) as any;
        })();
        expect(before.open).toHaveLength(2);
        first.server.close();
        first.ctx.handle.sqlite.close();
        // Reopen the same file: the flags must still be there.
        const second = await startServer(file);
        try {
          const afterRes = await fetch(`${second.base}/api/forget-requests/unresolved`, { headers: { "x-space-id": s1 } });
          expect(afterRes.status).toBe(200);
          const after = (await afterRes.json()) as any;
          expect(after.open.map((f: any) => f.flagId).sort()).toEqual(
            before.open.map((f: any) => f.flagId).sort(),
          );
          expect(after.open.map((f: any) => `${f.table}:${f.rowId}`).sort()).toEqual([
            `instruction_profiles:${seed.profileId}`,
            `user_model:${seed.statedId}`,
          ]);
        } finally {
          second.server.close();
          second.ctx.handle.sqlite.close();
        }
      } finally {
        try { first.server.close(); } catch { /* already closed */ }
        try { first.ctx.handle.sqlite.close(); } catch { /* already closed */ }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T-F2 — list returns exactly the unresolved rows (inferred row deleted, never listed)", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    const res = forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    expect(res.unresolved).toEqual([
      { table: "user_model", rowId: seed.statedId },
      { table: "instruction_profiles", rowId: seed.profileId },
    ]);
    const { status, body } = await get("/api/forget-requests/unresolved", spaceId);
    expect(status).toBe(200);
    expect(body.open.map((f: any) => `${f.table}:${f.rowId}`).sort()).toEqual([
      `instruction_profiles:${seed.profileId}`,
      `user_model:${seed.statedId}`,
    ]);
    const um = body.open.find((f: any) => f.table === "user_model");
    expect(um.policyReason).toBe("stated_user_model");
    expect(um.slot).toBe("belief");
    expect(um.origin).toBe("stated");
    expect(um.confidence).toBe(0.8);
    const prof = body.open.find((f: any) => f.table === "instruction_profiles");
    expect(prof.policyReason).toBe("instruction_profile");
    expect(prof.mode).toBe("always");
    expect(prof.priority).toBe(0);
    expect(prof.enabled).toBe(true);
    // The quoting inferred row was deleted by the span pass — it is
    // neither a flag nor a listed row.
    expect(ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM user_model WHERE id = ?`).get(seed.inferredId) as { c: number }).toEqual({ c: 0 });
    expect(body.reviewedCount).toBe(0);
    expect(body.reviewed).toEqual([]);
  });

  it("T-F3 — no forgotten span ever renders (JSON contains no 24-char window; quoting profile name absent)", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const { status, body } = await get("/api/forget-requests/unresolved", spaceId);
    expect(status).toBe(200);
    const json = JSON.stringify(body);
    expect(containsVerbatimSpan(json, seed.chunkTexts)).toBe(false);
    expect(json).not.toContain(seed.profileName);
    expect(json).not.toContain("my unique probe");
    expect(json).not.toContain(SPAN);
  });

  it("T-F4 — mark reviewed does what it says and nothing else", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const before = await get("/api/forget-requests/unresolved", spaceId);
    const umFlag = before.body.open.find((f: any) => f.table === "user_model");
    const profFlag = before.body.open.find((f: any) => f.table === "instruction_profiles");
    const statedBefore = ctx.handle.sqlite.prepare(`SELECT * FROM user_model WHERE id = ?`).get(seed.statedId) as Record<string, unknown>;

    const reviewed = await post(`/api/forget-requests/unresolved/${umFlag.flagId}/review`, spaceId);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe("reviewed");

    const after = await get("/api/forget-requests/unresolved", spaceId);
    expect(after.body.open.map((f: any) => f.flagId)).toEqual([profFlag.flagId]);
    expect(after.body.reviewed).toHaveLength(1);
    expect(after.body.reviewed[0].flagId).toBe(umFlag.flagId);
    expect(after.body.reviewedCount).toBe(1);
    // The underlying row is untouched, byte-identical.
    const statedAfter = ctx.handle.sqlite.prepare(`SELECT * FROM user_model WHERE id = ?`).get(seed.statedId) as Record<string, unknown>;
    expect(statedAfter).toEqual(statedBefore);
    // The other flag is untouched.
    expect(after.body.open[0].status).toBe("open");
  });

  it("T-F5 — delete does what it says and nothing else", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    // A clean inferred row whose replaced_by points at the stated row:
    // deleting the stated row must null the link so history still walks.
    const nowIso = new Date().toISOString();
    const chainOldId = Number(
      ctx.handle.sqlite.prepare(
        `INSERT INTO user_model (space_id, slot, content, confidence, evidence_ids, valid_at, origin, replaced_by)
         VALUES (?, 'belief', 'an older clean claim', 0.8, '[]', ?, 'inferred', ?)`,
      ).run(spaceId, nowIso, seed.statedId).lastInsertRowid,
    );
    // The profile gets a vec row (the round-4 residual: it stays while the profile stays).
    const emb = new _Hep(EMBED_DIM);
    upsertProfileEmbedding(ctx.handle.sqlite, seed.profileId, await emb.embed("profile probe"));
    expect((ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_profiles WHERE profile_id = ?`).get(BigInt(seed.profileId)) as { c: number }).c).toBe(1);

    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const list = await get("/api/forget-requests/unresolved", spaceId);
    const profFlag = list.body.open.find((f: any) => f.table === "instruction_profiles");
    const umFlag = list.body.open.find((f: any) => f.table === "user_model");

    const deleted = await post(`/api/forget-requests/unresolved/${profFlag.flagId}/delete`, spaceId);
    expect(deleted.status).toBe(200);
    expect(deleted.body.status).toBe("resolved_deleted");
    expect(ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM instruction_profiles WHERE id = ?`).get(seed.profileId) as { c: number }).toEqual({ c: 0 });
    expect((ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_profiles WHERE profile_id = ?`).get(BigInt(seed.profileId)) as { c: number }).c).toBe(0);
    // A second delete 404s; the user_model flag is untouched.
    const again = await post(`/api/forget-requests/unresolved/${profFlag.flagId}/delete`, spaceId);
    expect(again.status).toBe(404);
    const mid = await get("/api/forget-requests/unresolved", spaceId);
    expect(mid.body.open.map((f: any) => f.flagId)).toEqual([umFlag.flagId]);

    // Delete the user_model flag: inbound replaced_by is nulled, history still walks.
    const umDeleted = await post(`/api/forget-requests/unresolved/${umFlag.flagId}/delete`, spaceId);
    expect(umDeleted.status).toBe(200);
    expect(ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM user_model WHERE id = ?`).get(seed.statedId) as { c: number }).toEqual({ c: 0 });
    const chainOld = ctx.handle.sqlite.prepare(`SELECT replaced_by FROM user_model WHERE id = ?`).get(chainOldId) as { replaced_by: number | null };
    expect(chainOld.replaced_by).toBeNull();
  });

  it("T-F6 — no arbitrary-row deletion door", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    // A flag id that was never issued.
    const never = await post("/api/forget-requests/unresolved/999999/delete", spaceId);
    expect(never.status).toBe(404);
    // A real flag id that is not open (reviewed first) refuses too, and the row survives.
    const list = await get("/api/forget-requests/unresolved", spaceId);
    const umFlag = list.body.open.find((f: any) => f.table === "user_model");
    expect((await post(`/api/forget-requests/unresolved/${umFlag.flagId}/review`, spaceId)).status).toBe(200);
    const refused = await post(`/api/forget-requests/unresolved/${umFlag.flagId}/delete`, spaceId);
    expect(refused.status).toBe(404);
    expect(ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM user_model WHERE id = ?`).get(seed.statedId) as { c: number }).toEqual({ c: 1 });
  });

  it("T-F7 — cross-space isolation", async () => {
    const spaceId = await freshSpace();
    const otherSpaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const list = await get("/api/forget-requests/unresolved", spaceId);
    const umFlag = list.body.open.find((f: any) => f.table === "user_model");
    // Another space sees an empty list and cannot touch this space's flags.
    const otherList = await get("/api/forget-requests/unresolved", otherSpaceId);
    expect(otherList.status).toBe(200);
    expect(otherList.body.open).toEqual([]);
    expect((await post(`/api/forget-requests/unresolved/${umFlag.flagId}/review`, otherSpaceId)).status).toBe(404);
    expect((await post(`/api/forget-requests/unresolved/${umFlag.flagId}/delete`, otherSpaceId)).status).toBe(404);
    // And a flag created in the other space is visible only there.
    const otherSeed = seedScenario(ctx.handle, otherSpaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, otherSpaceId, otherSeed.sourceId));
    const otherList2 = await get("/api/forget-requests/unresolved", otherSpaceId);
    expect(otherList2.body.open.map((f: any) => `${f.table}:${f.rowId}`).sort()).toEqual([
      `instruction_profiles:${otherSeed.profileId}`,
      `user_model:${otherSeed.statedId}`,
    ]);
    const ownList2 = await get("/api/forget-requests/unresolved", spaceId);
    expect(ownList2.body.open.find((f: any) => f.rowId === otherSeed.statedId)).toBeUndefined();
  });

  it("T-F8 — re-flag: a second forget opens a second open flag for the same row", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    const repo = new SourcesRepo(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const first = await get("/api/forget-requests/unresolved", spaceId);
    expect(first.body.open).toHaveLength(2);
    // Source B's text IS the stated row's content, so it quotes the same row.
    const srcB = repo.persistText({
      kind: "note",
      citationClass: "verbatim_typed",
      text: `I said ${SPAN} myself`,
    }).source;
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, srcB.id));
    const second = await get("/api/forget-requests/unresolved", spaceId);
    const umFlags = second.body.open.filter((f: any) => f.table === "user_model" && f.rowId === seed.statedId);
    expect(umFlags).toHaveLength(2);
    expect(umFlags[0].requestId).not.toBe(umFlags[1].requestId);
    // Reviewing the first does not close the second.
    expect((await post(`/api/forget-requests/unresolved/${umFlags[0].flagId}/review`, spaceId)).status).toBe(200);
    const third = await get("/api/forget-requests/unresolved", spaceId);
    expect(third.body.open.filter((f: any) => f.table === "user_model" && f.rowId === seed.statedId)).toHaveLength(1);
    expect(third.body.reviewed).toHaveLength(1);
  });

  it("T-F9 — dangling target: targetMissing + dismiss", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const list = await get("/api/forget-requests/unresolved", spaceId);
    const umFlag = list.body.open.find((f: any) => f.table === "user_model");
    // The row vanishes out-of-band (deleted elsewhere).
    ctx.handle.sqlite.prepare(`DELETE FROM user_model WHERE id = ?`).run(seed.statedId);
    const dangling = await get("/api/forget-requests/unresolved", spaceId);
    const danglingFlag = dangling.body.open.find((f: any) => f.flagId === umFlag.flagId);
    expect(danglingFlag.targetMissing).toBe(true);
    const dismissed = await post(`/api/forget-requests/unresolved/${umFlag.flagId}/dismiss`, spaceId);
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.status).toBe("dismissed");
    const after = await get("/api/forget-requests/unresolved", spaceId);
    expect(after.body.open.find((f: any) => f.flagId === umFlag.flagId)).toBeUndefined();
    // The flag row itself is the audit trail — dismissed, not deleted.
    const flagRow = ctx.handle.sqlite.prepare(`SELECT status FROM forget_unresolved_flags WHERE id = ?`).get(umFlag.flagId) as { status: string };
    expect(flagRow.status).toBe("dismissed");
  });

  it("T-F10 — audit honesty: the apply log line still carries only counts", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const log = ctx.handle.sqlite.prepare(
      `SELECT description FROM agent_logs WHERE action = 'forget_source_applied' AND space_id = ? ORDER BY id DESC LIMIT 1`,
    ).get(spaceId) as { description: string };
    expect(log.description).toContain("unresolved=2");
    expect(log.description).not.toContain(SPAN);
    expect(log.description).not.toContain("my unique probe");
  });

  it("T-F11 — route ordering: GET /unresolved does not collide with GET /:id", async () => {
    const spaceId = await freshSpace();
    const seed = seedScenario(ctx.handle, spaceId);
    forgetSourceByRequest(ctx.handle, approvedForgetRequest(ctx.handle, spaceId, seed.sourceId));
    const list = await get("/api/forget-requests/unresolved", spaceId);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.open)).toBe(true);
    // A numeric id that does not exist is a clean 404, not a 400.
    const missing = await get("/api/forget-requests/999999", spaceId);
    expect(missing.status).toBe(404);
    // A non-numeric id is a 400 from the :id route itself.
    const bad = await get("/api/forget-requests/notanumber", spaceId);
    expect(bad.status).toBe(400);
  });

  it("schema — bootstrap and migration agree on forget_unresolved_flags DDL", () => {
    const fresh = new BetterSqlite3(":memory:");
    bootstrapSchema(fresh);
    const freshCols = (fresh.prepare(`PRAGMA table_info(forget_unresolved_flags)`).all() as { name: string }[]).map((c) => c.name);
    const freshSql = (fresh.prepare(`SELECT sql FROM sqlite_master WHERE name = 'forget_unresolved_flags'`).get() as { sql: string }).sql;
    const freshIdx = (fresh.prepare(`SELECT sql FROM sqlite_master WHERE name = 'idx_forget_unresolved_flags_space'`).get() as { sql: string }).sql;
    fresh.close();
    expect(freshCols).toEqual(["id", "space_id", "request_id", "source_id", "table_name", "row_id", "policy_reason", "status", "created_at", "reviewed_at"]);

    // A volume that predates the table: drop it, then migrateSchema must
    // recreate it with byte-identical DDL.
    const legacy = new BetterSqlite3(":memory:");
    bootstrapSchema(legacy);
    legacy.exec(`DROP TABLE IF EXISTS forget_unresolved_flags; DROP INDEX IF EXISTS idx_forget_unresolved_flags_space;`);
    migrateSchema(legacy);
    const migCols = (legacy.prepare(`PRAGMA table_info(forget_unresolved_flags)`).all() as { name: string }[]).map((c) => c.name);
    const migSql = (legacy.prepare(`SELECT sql FROM sqlite_master WHERE name = 'forget_unresolved_flags'`).get() as { sql: string }).sql;
    const migIdx = (legacy.prepare(`SELECT sql FROM sqlite_master WHERE name = 'idx_forget_unresolved_flags_space'`).get() as { sql: string }).sql;
    legacy.close();
    expect(migCols).toEqual(freshCols);
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(norm(migSql)).toBe(norm(freshSql));
    expect(norm(migIdx)).toBe(norm(freshIdx));
  });
});
