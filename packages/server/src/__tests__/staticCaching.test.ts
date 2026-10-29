import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp, isHashedBuildAsset } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Static caching policy. Content-hashed build output is immutable; the shell
 * must never be cached; un-hashed public files (the .glb models) keep their
 * names across deploys so they must stay revalidatable.
 */
describe("isHashedBuildAsset", () => {
  const dir = "/srv/dist";
  it("matches Vite's hyphenated hashes under assets/ — the shape the old rule missed", () => {
    expect(isHashedBuildAsset("/srv/dist/assets/index-BX3EQEE3.js", dir)).toBe(true);
    expect(isHashedBuildAsset("/srv/dist/assets/index-1laLpjij.css", dir)).toBe(true);
    expect(isHashedBuildAsset("/srv/dist/assets/Graph3D-8qpR0twJ.js", dir)).toBe(true);
    expect(isHashedBuildAsset("/srv/dist/assets/pdf.worker.min-CHFwMXne.mjs", dir)).toBe(true);
  });
  it("never matches un-hashed public files, even with a hyphen in the name", () => {
    expect(isHashedBuildAsset("/srv/dist/space_station_3.glb", dir)).toBe(false);
    expect(isHashedBuildAsset("/srv/dist/sf-ice-planet-procedural.glb", dir)).toBe(false);
    expect(isHashedBuildAsset("/srv/dist/draco/draco_wasm_wrapper.js", dir)).toBe(false);
    expect(isHashedBuildAsset("/srv/dist/sw.js", dir)).toBe(false);
  });
  it("is scoped to assets/: a hash-shaped name elsewhere is not trusted", () => {
    expect(isHashedBuildAsset("/srv/dist/models/hero-ABCDEFGH.glb", dir)).toBe(false);
    expect(isHashedBuildAsset("/srv/dist/assets", dir)).toBe(false);
  });
  it("needs a real hash — a short suffix is just a name", () => {
    expect(isHashedBuildAsset("/srv/dist/assets/icon-small.png", dir)).toBe(false);
  });
});

describe("served Cache-Control (real HTTP)", () => {
  let server: Server;
  let ctx: AppContext;
  let base = "";
  let dir = "";
  const prev = process.env.WEB_DIR;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "webdir-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    writeFileSync(join(dir, "sw.js"), "// sw");
    writeFileSync(join(dir, "assets", "index-BX3EQEE3.js"), "x");
    writeFileSync(join(dir, "model.glb"), "glb");
    process.env.WEB_DIR = dir;
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    await new Promise<void>((r) => {
      server = createApp(ctx).listen(0, () => r());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.WEB_DIR;
    else process.env.WEB_DIR = prev;
  });
  const cc = async (p: string) => (await fetch(base + p)).headers.get("cache-control");

  it("hashed bundle: immutable for a year", async () => {
    expect(await cc("/assets/index-BX3EQEE3.js")).toBe("public, max-age=31536000, immutable");
  });
  it("shell and service worker: never cached", async () => {
    expect(await cc("/sw.js")).toMatch(/no-cache/);
    expect(await cc("/")).toMatch(/no-cache/);
  });
  it("an un-hashed model is NOT immutable — it keeps its name across deploys", async () => {
    expect(await cc("/model.glb")).not.toMatch(/immutable/);
  });

  // The service worker's background validation of cached models (web/public/sw.js) depends on
  // this: a conditional request must get a 304, not the whole file. A request carrying
  // `Cache-Control: no-cache` — which browsers add themselves when a script uses
  // `cache: "no-store"` — is treated as a forced reload and gets the full 200. Measured with a
  // 14 MB model: the worker's "cheap check" silently downloaded 14 MB every launch.
  describe("conditional requests for models", () => {
    const etagOf = async () => (await fetch(base + "/model.glb")).headers.get("etag")!;
    // Raw http, not fetch(): the fetch spec (and Node's fetch, like browsers) silently turns a
    // request carrying If-None-Match into `no-store` and adds `Cache-Control: no-cache` — the
    // exact trap below. This sends precisely the headers given.
    const rawGet = (headers: Record<string, string>) =>
      new Promise<{ status: number; bytes: number }>((resolve, reject) => {
        http
          .get(base + "/model.glb", { headers }, (res) => {
            let bytes = 0;
            res.on("data", (d) => (bytes += d.length));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, bytes }));
          })
          .on("error", reject);
      });
    it("a matching If-None-Match gets a 304 with no body", async () => {
      const r = await rawGet({ "if-none-match": await etagOf() });
      expect(r.status).toBe(304);
      expect(r.bytes).toBe(0);
    });
    it("fetch() itself adds no-cache once If-None-Match is set (spec behaviour) — and so gets the full 200", async () => {
      const r = await fetch(base + "/model.glb", { headers: { "if-none-match": await etagOf() } });
      expect(r.status).toBe(200);
    });
    it("…also when the request carries Cache-Control: max-age=0 (what the worker sends)", async () => {
      const r = await fetch(base + "/model.glb", { headers: { "if-none-match": await etagOf(), "cache-control": "max-age=0" } });
      expect(r.status).toBe(304);
    });
    it("…but NOT when it carries Cache-Control: no-cache — documenting why the worker must not send that", async () => {
      const r = await fetch(base + "/model.glb", { headers: { "if-none-match": await etagOf(), "cache-control": "no-cache" } });
      expect(r.status).toBe(200);
    });
    it("a changed file (different ETag) is returned in full", async () => {
      const r = await fetch(base + "/model.glb", { headers: { "if-none-match": 'W/"stale"' } });
      expect(r.status).toBe(200);
    });
  });
});
