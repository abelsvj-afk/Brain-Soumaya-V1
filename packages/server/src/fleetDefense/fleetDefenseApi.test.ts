import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Fleet defense — HTTP contract. The routes are thin: the service
 * owns every outcome, the client renders what the server returns.
 * Auth and space scoping ride the same guard as every other
 * per-brain route (requireSpace); the defense routes add no auth
 * of their own. No route here spends fuel, and no route writes to
 * a brain record.
 */
describe("Fleet defense routes", () => {
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
    spaceId = await auth("defense-tester");
    space2 = await auth("defense-other");
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("starts empty: no releases, no defense, no history", async () => {
    const res = await call("GET", "/api/fleet-defense", spaceId);
    expect(res.status).toBe(200);
    const overview = res.body.overview as Record<string, unknown>;
    expect(overview.releases).toEqual([]);
    expect(overview.activeDefense).toBeNull();
    expect(overview.history).toEqual([]);
  });

  it("offers a release, summons the fleet, and plays a defense to a win", async () => {
    const offered = await call("POST", "/api/fleet-defense/releases", spaceId, {
      kind: "emotion",
      size: "small",
      label: "the old argument",
    });
    expect(offered.status).toBe(201);
    const release = offered.body.release as { id: number; status: string };
    expect(release.status).toBe("offered");

    const started = await call("POST", `/api/fleet-defense/releases/${release.id}/start`, spaceId);
    expect(started.status).toBe(201);
    const defense = started.body.defense as { id: number; status: string; invaders: unknown[] };
    expect(defense.status).toBe("active");
    expect(defense.invaders).toHaveLength(3);

    // Helm play: one lane per tick, three ticks, three ships.
    for (const lane of [1, 2, 3]) {
      const ticked = await call("POST", `/api/fleet-defense/defenses/${defense.id}/tick`, spaceId, {
        mode: "helm",
        lane,
      });
      expect(ticked.status).toBe(200);
    }
    const done = await call("GET", `/api/fleet-defense/defenses/${defense.id}`, spaceId);
    const finalDefense = done.body.defense as { status: string; outcomeLine: string };
    expect(finalDefense.status).toBe("won");
    expect(finalDefense.outcomeLine).toMatch(/charge was let go/);

    const overview = await call("GET", "/api/fleet-defense", spaceId);
    const ov = overview.body.overview as { releases: { status: string }[]; history: unknown[] };
    expect(ov.releases[0]?.status).toBe("cleared");
    expect(ov.history).toHaveLength(1);
  });

  it("refuses bad offers, bad lanes, and unknown ids with plain words", async () => {
    const noLabel = await call("POST", "/api/fleet-defense/releases", spaceId, {
      kind: "emotion",
      size: "small",
      label: "  ",
    });
    expect(noLabel.status).toBe(400);
    expect(noLabel.body.code).toBe("INVALID_INPUT");

    const badKind = await call("POST", "/api/fleet-defense/releases", spaceId, {
      kind: "grudge",
      size: "small",
      label: "something",
    });
    expect(badKind.status).toBe(400);

    const ghost = await call("POST", "/api/fleet-defense/releases/999999/start", spaceId);
    expect(ghost.status).toBe(404);
    expect(ghost.body.code).toBe("UNKNOWN_RELEASE");

    const offered = await call("POST", "/api/fleet-defense/releases", spaceId, {
      kind: "debt",
      size: "steady",
      label: "the card balance",
    });
    const release = offered.body.release as { id: number };
    const started = await call("POST", `/api/fleet-defense/releases/${release.id}/start`, spaceId);
    const defense = started.body.defense as { id: number };

    const badLane = await call("POST", `/api/fleet-defense/defenses/${defense.id}/tick`, spaceId, {
      mode: "helm",
      lane: 9,
    });
    expect(badLane.status).toBe(400);
    expect(badLane.body.code).toBe("INVALID_INPUT");

    const noLane = await call("POST", `/api/fleet-defense/defenses/${defense.id}/tick`, spaceId, {
      mode: "helm",
    });
    expect(noLane.status).toBe(400);

    const ghostDefense = await call("GET", "/api/fleet-defense/defenses/999999", spaceId);
    expect(ghostDefense.status).toBe(404);
    expect(ghostDefense.body.code).toBe("UNKNOWN_DEFENSE");
  });

  it("a second summoning while a defense is active is a conflict", async () => {
    const offered = await call("POST", "/api/fleet-defense/releases", spaceId, {
      kind: "emotion",
      size: "small",
      label: "the second charge",
    });
    const release = offered.body.release as { id: number };
    const first = await call("POST", `/api/fleet-defense/releases/${release.id}/start`, spaceId);
    expect(first.status).toBe(201);
    const second = await call("POST", `/api/fleet-defense/releases/${release.id}/start`, spaceId);
    expect(second.status).toBe(409);
  });

  it("another space sees none of this", async () => {
    const overview = await call("GET", "/api/fleet-defense", space2);
    expect(overview.status).toBe(200);
    const ov = overview.body.overview as { releases: unknown[] };
    expect(ov.releases).toEqual([]);
  });
});
