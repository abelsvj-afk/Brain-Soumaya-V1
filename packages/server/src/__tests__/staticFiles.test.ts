import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Stale-shell fix, server half: the SPA fallback must serve the shell ONLY
 * for page routes. A request for a file that doesn't exist on this build
 * (e.g. a hashed chunk renamed by the latest deploy, requested by a phone
 * still holding the previous shell) must get a real 404 — answering with
 * the index HTML (200) is what made browsers execute HTML as a JS module
 * and dead-end on "Failed to fetch dynamically imported module".
 */
const SHELL_MARKER = "STALE-SHELL-TEST-SHELL";
const REAL_CHUNK = "export const real = 1;\n";

let ctx: AppContext;
let server: Server;
let base: string;
let webDir: string;
let prevWebDir: string | undefined;

beforeAll(async () => {
  webDir = mkdtempSync(path.join(tmpdir(), "brain-webdir-"));
  writeFileSync(path.join(webDir, "index.html"), `<!doctype html><title>${SHELL_MARKER}</title>`);
  mkdirSync(path.join(webDir, "assets"));
  writeFileSync(path.join(webDir, "assets", "RealChunk-AbC12345.js"), REAL_CHUNK);

  prevWebDir = process.env.WEB_DIR;
  process.env.WEB_DIR = webDir;

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
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
  if (prevWebDir === undefined) delete process.env.WEB_DIR;
  else process.env.WEB_DIR = prevWebDir;
  rmSync(webDir, { recursive: true, force: true });
});

describe("SPA fallback vs missing files", () => {
  it("returns 404 (not the shell) for a bogus hashed chunk under /assets/", async () => {
    const res = await fetch(`${base}/assets/SettingsPanel-V_KOHzCJ.js`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SHELL_MARKER);
  });

  it("returns 404 for a missing file with an extension outside /assets/", async () => {
    const res = await fetch(`${base}/some-missing-image.png`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SHELL_MARKER);
  });

  it("serves the shell with 200 for the root page route", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SHELL_MARKER);
  });

  it("serves the shell with 200 for an extensionless client-side route", async () => {
    const res = await fetch(`${base}/some/page-route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SHELL_MARKER);
  });

  it("serves a real asset file with 200 and its real bytes", async () => {
    const res = await fetch(`${base}/assets/RealChunk-AbC12345.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(REAL_CHUNK);
  });

  it("leaves API routes untouched", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
