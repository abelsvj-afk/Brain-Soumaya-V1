import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { CodexDiscoveriesRepo } from "../repositories/codexDiscoveries.repo.js";
import { CODEX_STATIC_KEYS } from "@brain/shared";

/**
 * IM-93: the codex-claim allow-list must cover the REAL client Codex catalog.
 * Before the fix, every mind-* entry, five phenomena (supernova, crown,
 * goldenhour, theweight, aurora) and every fieldnote-* entry were rejected
 * with 400 — and the client marked them seen anyway, so the fuel was lost.
 */
let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

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
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "codex-tester", passcode: "secret123", name: "codex-tester" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function claim(key: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/maintenance/codex-claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-space-id": spaceId },
    body: JSON.stringify({ key }),
  });
  return { status: res.status, body: await res.json() };
}

describe("codex-claim covers the real Codex catalog (IM-93)", () => {
  it("awards a mind-* entry (400 before the fix)", async () => {
    const first = await claim("mind-goal");
    expect(first.status).toBe(200);
    expect(first.body.awarded).toBe(true);
    // Still one-time: a second claim is a no-op, not a farm.
    const again = await claim("mind-goal");
    expect(again.status).toBe(200);
    expect(again.body.awarded).toBe(false);
  });

  it("awards the remaining mind-* entries", async () => {
    for (const key of ["mind-skill", "mind-person_entity", "mind-identity", "mind-idea", "mind-intention", "mind-motivation"]) {
      const r = await claim(key);
      expect(r.status, key).toBe(200);
      expect(r.body.awarded, key).toBe(true);
    }
  });

  it("awards the five phenomena the old allow-list missed", async () => {
    for (const key of ["phenom-supernova", "phenom-crown", "phenom-goldenhour", "phenom-theweight", "phenom-aurora"]) {
      const r = await claim(key);
      expect(r.status, key).toBe(200);
      expect(r.body.awarded, key).toBe(true);
    }
  });

  // Relic Buffs v2 (design note v2 §7, criterion A4): the old trust-me
  // door is closed. POST /api/maintenance/codex-claim refuses EVERY
  // relic-* key and points at the verified find endpoint — the scenario
  // "a relic entry is awarded once it is found in its world" now lives
  // on that endpoint and is covered in relicBuffsV2.test.ts ("A1/A3 over
  // HTTP: wrong world refused; standing in the world, the find lands
  // once and pays once", plus its own A4 test). What this file pins is
  // the refusal itself: no award, no exception, with the pointer.
  it("refuses a relic entry — relic finds go through the verified find endpoint (v2 A4)", async () => {
    const r = await claim("relic-harbor-nail");
    expect(r.status).toBe(400);
    expect(r.body.awarded).toBeUndefined();
    expect(r.body.error).toMatch(/relics\/found/);
    // The refusal is not a one-time state: a repeat is refused identically.
    const again = await claim("relic-harbor-nail");
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/relics\/found/);
  });

  // The relic-* refusal has no exceptions — not even for a deferred
  // relic whose world has not opened yet (e.g. relic-star-hanger, whose
  // world is Scale). Under the pre-v2 contract this key was accepted on
  // key membership alone (the B-03 hole); v2 §7 closes that door for all
  // relics, and the find endpoint separately refuses not-yet-findable
  // relics (relicBuffsV2.test.ts, criterion A2).
  it("refuses a deferred relic's key too — the relic-* refusal has no exceptions (v2 A4)", async () => {
    const r = await claim("relic-star-hanger");
    expect(r.status).toBe(400);
    expect(r.body.awarded).toBeUndefined();
    expect(r.body.error).toMatch(/relics\/found/);
  });

  it("awards a fieldnote-* entry Soumaya actually charted for this space", async () => {
    new CodexDiscoveriesRepo(ctx.handle, spaceId).add({
      key: "sector:daily:25",
      title: "A Sector Comes of Age",
      lore: "The Drift reached 25 memories.",
      icon: "✦",
    });
    const r = await claim("fieldnote-sector:daily:25");
    expect(r.status).toBe(200);
    expect(r.body.awarded).toBe(true);
  });

  it("accepts every non-relic key in the shared static catalog, and refuses every relic key in it (v2 A4)", async () => {
    expect(CODEX_STATIC_KEYS.size).toBeGreaterThan(0);
    let nonRelicKeys = 0;
    let relicKeys = 0;
    for (const key of CODEX_STATIC_KEYS) {
      const r = await claim(key);
      if (key.startsWith("relic-")) {
        // Relic keys stay IN the shared catalog (the client still
        // generates them) — but since Relic Buffs v2 they are refused
        // here and awarded only through the verified find endpoint.
        relicKeys += 1;
        expect(r.status, key).toBe(400);
        expect(r.body.error, key).toMatch(/relics\/found/);
      } else {
        // Every non-relic catalog key is accepted exactly as before.
        nonRelicKeys += 1;
        expect(r.status, key).toBe(200);
      }
    }
    // Both halves of the catalog were actually exercised.
    expect(nonRelicKeys).toBeGreaterThan(0);
    expect(relicKeys).toBeGreaterThan(0);
  });

  it("still rejects invented keys and uncharted field notes (no fuel farming)", async () => {
    for (const key of ["mind-invented", "phenom-invented", "sector-invented-42", "fieldnote-never-charted", "constellation-999999"]) {
      const r = await claim(key);
      expect(r.status, key).toBe(400);
    }
  });
});
