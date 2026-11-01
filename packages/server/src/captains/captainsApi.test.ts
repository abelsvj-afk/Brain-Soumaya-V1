import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Captain routes — HTTP contract (NPC-Player Layer L1). The routes
 * are thin: the engine owns every outcome, the client renders what
 * the server returns. Auth and space scoping ride the same guard as
 * every other per-brain route.
 */
describe("Captain routes", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;
  let space2: string;

  async function auth(tag: string): Promise<string> {
    const res = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }),
    });
    return ((await res.json()) as { id: string }).id;
  }
  async function call(method: string, path: string, space: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-space-id": space },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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
    spaceId = await auth("captain-tester");
    space2 = await auth("captain-other");
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("lists all three captains; only Bex is active and she carries her own ledgers", async () => {
    const list = await call("GET", "/api/captains", spaceId);
    expect(list.status).toBe(200);
    const captains = list.body.captains as {
      id: string;
      name: string;
      active: boolean;
      present: boolean;
      fuel: number;
      credits: number;
      homeWorld: string;
    }[];
    expect(captains.map((c) => c.id)).toEqual(["dain", "veyra", "bex"]);
    const bex = captains.find((c) => c.id === "bex");
    expect(bex?.name).toBe("Bex");
    expect(bex?.active).toBe(true);
    expect(bex?.fuel).toBe(60);
    expect(bex?.credits).toBe(120);
    expect(bex?.homeWorld).toBe("great-station");
    for (const other of captains.filter((c) => c.id !== "bex")) {
      expect(other.active).toBe(false);
      expect(other.present).toBe(false);
    }
  });

  it("detail read answers for Bex and 404s an unknown captain", async () => {
    const detail = await call("GET", "/api/captains/bex", spaceId);
    expect(detail.status).toBe(200);
    const missing = await call("GET", "/api/captains/nobody", spaceId);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("UNKNOWN_CAPTAIN");
  });

  it("ask: the three L1 questions answer; a bad question is a 400; Dain is a plain 409", async () => {
    const doing = await call("POST", "/api/captains/bex/ask", spaceId, { question: "doing" });
    expect(doing.status).toBe(200);
    expect(typeof doing.body.answer).toBe("string");
    expect((doing.body.answer as string).length).toBeGreaterThan(10);

    const bad = await call("POST", "/api/captains/bex/ask", spaceId, { question: "secrets" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_QUESTION");

    const dain = await call("POST", "/api/captains/dain/ask", spaceId, { question: "doing" });
    expect(dain.status).toBe(409);
    expect(dain.body.code).toBe("CAPTAIN_NOT_ACTIVE");
  });

  it("stop silences her (ask is a 409), resume and wipe-meetings answer 200", async () => {
    const stop = await call("POST", "/api/captains/bex/stop", spaceId);
    expect(stop.status).toBe(200);
    expect((stop.body.captain as { stopped: boolean }).stopped).toBe(true);

    const whileStopped = await call("POST", "/api/captains/bex/ask", spaceId, { question: "met" });
    expect(whileStopped.status).toBe(409);
    expect(whileStopped.body.code).toBe("CAPTAIN_STOPPED");

    const resume = await call("POST", "/api/captains/bex/resume", spaceId);
    expect(resume.status).toBe(200);
    expect((resume.body.captain as { stopped: boolean }).stopped).toBe(false);

    const wipe = await call("POST", "/api/captains/bex/wipe-meetings", spaceId);
    expect(wipe.status).toBe(200);
    expect((wipe.body.captain as { meetingsRemembered: number }).meetingsRemembered).toBe(0);

    const dainStop = await call("POST", "/api/captains/dain/stop", spaceId);
    expect(dainStop.status).toBe(409);
  });

  it("the Chronicle answers lines, and a second space sees none of the first space's life", async () => {
    const feed = await call("GET", "/api/captains/chronicle", spaceId);
    expect(feed.status).toBe(200);
    const lines = feed.body.lines as { npcId: string; line: string; cause: string }[];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.line.length > 0 && l.cause.length > 0)).toBe(true);

    const other = await call("GET", "/api/captains/bex", space2);
    expect(other.status).toBe(200);
    expect((other.body.captain as { meetingsRemembered: number }).meetingsRemembered).toBe(0);
  });
});
