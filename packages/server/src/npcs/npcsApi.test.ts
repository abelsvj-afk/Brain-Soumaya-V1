import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * NPC autonomy — HTTP contract. The routes are thin: the loop owns
 * every outcome, the client renders what the server returns. Auth
 * and space scoping ride the same guard as every other per-brain
 * route (requireSpace); the NPC routes add no auth of their own.
 */
describe("NPC routes", () => {
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
    spaceId = await auth("npc-tester");
    space2 = await auth("npc-other");
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("lists the roster with state, and the detail read runs one lazy tick", async () => {
    const list = await call("GET", "/api/npcs", spaceId);
    expect(list.status).toBe(200);
    const npcs = list.body.npcs as { id: string; name: string; world: string }[];
    expect(npcs.map((n) => n.id)).toEqual(["harbor-controller"]);
    expect(npcs[0]?.name).toBe("Harbor controller");
    expect(npcs[0]?.world).toBe("great-station");

    const detail = await call("GET", "/api/npcs/harbor-controller", spaceId);
    expect(detail.status).toBe(200);
    const npc = detail.body.npc as { actsToday: number; recentLog: { kind: string }[] };
    expect(npc.actsToday).toBe(1); // the lazy tick acted (explore)
    expect(npc.recentLog[0]?.kind).toBe("explore");

    // A second read inside the throttle window ticks to nothing.
    const again = await call("GET", "/api/npcs/harbor-controller", spaceId);
    const npc2 = again.body.npc as { actsToday: number };
    expect(npc2.actsToday).toBe(1);
  });

  it("ask answers each question kind, and an unknown question is a 400", async () => {
    for (const q of ["routes", "arrivals", "traffic", "fuel", "gate"]) {
      const r = await call("POST", "/api/npcs/harbor-controller/ask", spaceId, { question: q });
      expect(r.status).toBe(200);
      expect(typeof r.body.answer).toBe("string");
      expect((r.body.answer as string).length).toBeGreaterThan(20);
    }
    const bad = await call("POST", "/api/npcs/harbor-controller/ask", spaceId, {
      question: "meaning-of-life",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_QUESTION");
  });

  it("unknown NPCs are a 404", async () => {
    const r = await call("GET", "/api/npcs/keeper", spaceId);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("UNKNOWN_NPC");
  });

  it("stop silences the NPC (ask is a 409) and resume brings it back", async () => {
    const stopped = await call("POST", "/api/npcs/harbor-controller/stop", spaceId);
    expect(stopped.status).toBe(200);
    expect((stopped.body.npc as { stopped: boolean }).stopped).toBe(true);

    const asked = await call("POST", "/api/npcs/harbor-controller/ask", spaceId, { question: "fuel" });
    expect(asked.status).toBe(409);
    expect(asked.body.code).toBe("NPC_STOPPED");

    const resumed = await call("POST", "/api/npcs/harbor-controller/resume", spaceId);
    expect(resumed.status).toBe(200);
    expect((resumed.body.npc as { stopped: boolean }).stopped).toBe(false);

    const answered = await call("POST", "/api/npcs/harbor-controller/ask", spaceId, { question: "fuel" });
    expect(answered.status).toBe(200);
  });

  it("one space's NPC is invisible to another", async () => {
    const other = await call("GET", "/api/npcs/harbor-controller", space2);
    expect(other.status).toBe(200);
    const npc = other.body.npc as { actsToday: number; recentLog: unknown[] };
    // space2's own tick acted once (its own explore) — but it never
    // sees spaceId's log: the two spaces' counts are independent.
    expect(npc.actsToday).toBe(1);
    expect(npc.recentLog).toHaveLength(1);
  });
});
