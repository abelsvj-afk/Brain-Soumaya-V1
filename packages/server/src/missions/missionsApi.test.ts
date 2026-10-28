import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Fleet missions — HTTP contract. The routes are thin: the loop owns
 * every outcome, the client renders what the server returns. Auth
 * and space scoping ride the same guard as every other per-brain
 * route (requireSpace); the missions routes add no auth of their own.
 * Time cannot be injected over HTTP, so the settle is covered at the
 * loop level — here the contract is dispatch, idempotency, refusal
 * codes, recall, the stop switch, and space isolation. Missions are
 * free: there is no 402 path.
 */
describe("Mission routes", () => {
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
    spaceId = await auth("mission-tester");
    space2 = await auth("mission-other");
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("returns the overview: no missions yet, fleet running, fuel shown", async () => {
    const { status, body } = await call("GET", "/api/missions", spaceId);
    expect(status).toBe(200);
    expect(body.missions).toEqual([]);
    expect(body.fleetStopped).toBe(false);
    expect((body.fuel as { fuel: number; capacity: number }).capacity).toBe(200);
    expect(body.log).toEqual([]);
    expect(body).not.toHaveProperty("suggestions");
    expect(body).not.toHaveProperty("chartedRoutes");
    expect(body).not.toHaveProperty("keepsakes");
  });

  it("dispatches a mission for free and replays idempotently", async () => {
    const dispatched = await call("POST", "/api/missions/dispatch", spaceId, {
      clientKey: "api-journey-1",
      kind: "journey",
      destination: "scale",
      durationMinutes: 30,
      fleetSize: 1,
    });
    expect(dispatched.status).toBe(200);
    const mission = dispatched.body.mission as { id: string; state: string; fuelCost: number; ships: string[] };
    expect(mission.state).toBe("outbound");
    expect(mission.fuelCost).toBe(0);
    expect(mission.ships).toHaveLength(1);
    const overview = dispatched.body.overview as { fuel: { fuel: number } };
    expect(overview.fuel.fuel).toBeCloseTo(25, 6);

    const replay = await call("POST", "/api/missions/dispatch", spaceId, {
      clientKey: "api-journey-1",
      kind: "scouting",
      destination: "quiet-archive",
      durationMinutes: 60,
      fleetSize: 3,
    });
    expect(replay.status).toBe(200);
    expect((replay.body.mission as { id: string }).id).toBe(mission.id);
    expect((replay.body.overview as { fuel: { fuel: number } }).fuel.fuel).toBeCloseTo(25, 6);
  });

  it("refuses invalid input with plain codes — and never a 402", async () => {
    const bad = await call("POST", "/api/missions/dispatch", spaceId, {
      clientKey: "api-bad-1",
      kind: "defense",
      destination: "scale",
      durationMinutes: 30,
      fleetSize: 1,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_KIND");

    const privateWorld = await call("POST", "/api/missions/dispatch", spaceId, {
      clientKey: "api-bad-2",
      kind: "journey",
      destination: "growing-place",
      durationMinutes: 30,
      fleetSize: 1,
    });
    expect(privateWorld.status).toBe(400);
    expect(privateWorld.body.code).toBe("UNKNOWN_DESTINATION");

    // A big mission is still free: no balance can refuse it.
    const big = await call("POST", "/api/missions/dispatch", spaceId, {
      clientKey: "api-big-1",
      kind: "journey",
      destination: "great-station",
      durationMinutes: 60,
      fleetSize: 3,
    });
    expect(big.status).toBe(200);
    expect((big.body.mission as { fuelCost: number }).fuelCost).toBe(0);
  });

  it("recalls a mission, and unknown recall 404s", async () => {
    const dispatched = await call("POST", "/api/missions/dispatch", space2, {
      clientKey: "api-recall-1",
      kind: "scouting",
      destination: "scale",
      durationMinutes: 30,
      fleetSize: 1,
    });
    expect(dispatched.status).toBe(200);
    const id = (dispatched.body.mission as { id: string }).id;
    const recalled = await call("POST", `/api/missions/${id}/recall`, space2);
    expect(recalled.status).toBe(200);
    expect((recalled.body.mission as { state: string }).state).toBe("recalled");
    expect((recalled.body.mission as { outcome: string }).outcome).toContain("returned without its outcome");
    const unknown = await call("POST", "/api/missions/no-such-id/recall", space2);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("UNKNOWN_MISSION");
  });

  it("stop blocks dispatch until resume", async () => {
    const stopped = await call("POST", "/api/missions/stop", spaceId);
    expect(stopped.status).toBe(200);
    expect((stopped.body.overview as { fleetStopped: boolean }).fleetStopped).toBe(true);
    const blocked = await call("POST", "/api/missions/dispatch", spaceId, {
      clientKey: "api-stopped-1",
      kind: "scouting",
      destination: "quiet-archive",
      durationMinutes: 30,
      fleetSize: 1,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("FLEET_STOPPED");
    const resumed = await call("POST", "/api/missions/resume", spaceId);
    expect(resumed.status).toBe(200);
    expect((resumed.body.overview as { fleetStopped: boolean }).fleetStopped).toBe(false);
  });

  it("one space's missions are invisible to another", async () => {
    const mine = await call("GET", "/api/missions", space2);
    const missions = mine.body.missions as { id: string }[];
    expect(missions.length).toBe(1); // only space2's own recalled scout
    const theirs = (await call("GET", "/api/missions", spaceId)).body.missions as { id: string }[];
    expect(missions.map((m) => m.id)).not.toContain(theirs[0]?.id);
  });
});
