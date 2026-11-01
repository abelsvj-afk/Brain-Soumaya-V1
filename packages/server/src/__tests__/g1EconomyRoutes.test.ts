import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * G1 economy routes — the HTTP surface of the G1 build:
 *  - the full loop over HTTP (state → gather → dock → sell → guide),
 *  - TX-AC-04 isolation sweep: authenticated as space A, every game
 *    route is probed with space B identifiers in body and query; no
 *    read or write touches space B, and B's identifiers never resolve
 *    in A's space,
 *  - TX-AC-08 forged price: a request carrying a client-invented price
 *    is ignored — the committed sale uses the server's posted price,
 *  - TX-AC-13 at the wire: a guest-marked request cannot mutate.
 */

let ctx: AppContext;
let server: Server;
let base: string;
let idA: string;
let idB: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(
  method: string,
  path: string,
  opts: { spaceId?: string; body?: unknown; actorKind?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.spaceId) headers["x-space-id"] = opts.spaceId;
  if (opts.actorKind) headers["x-actor-kind"] = opts.actorKind;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function auth(gamerTag: string, passcode: string): Promise<string> {
  const r = await call("POST", "/api/space/auth", { body: { gamerTag, passcode } });
  expect(r.status).toBe(200);
  return r.body.id as string;
}

function gameSnapshot(spaceId: string): string {
  const tables = [
    "game_credits",
    "game_cargo",
    "game_storage",
    "game_ledger",
    "game_action_results",
    "game_resource_nodes",
    "game_demand",
    "game_dock_state",
  ];
  return JSON.stringify(
    tables.map((t) =>
      ctx.handle.sqlite.prepare(`SELECT * FROM ${t} WHERE space_id = ? ORDER BY 1, 2, 3`).all(spaceId),
    ),
  );
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
  idA = await auth("g1Alpha", "alpha-pass-123");
  idB = await auth("g1Beta", "beta-pass-1234");
  expect(idA).not.toBe(idB);
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

describe("G1 routes — the loop over HTTP", () => {
  it("state → gather → dock → sell → buyers-guide, all space-scoped", async () => {
    const st0 = await call("GET", "/api/game/state", { spaceId: idA });
    expect(st0.status).toBe(200);
    expect(st0.body.credits).toBe(0);
    expect(st0.body.docked).toBe(false);
    expect(st0.body.nodes.length).toBeGreaterThan(0);

    const g = await call("POST", "/api/game/gather", {
      spaceId: idA,
      body: { nodeId: "belt-1", idempotencyKey: "http-gather-1" },
    });
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ ok: true, gathered: 20, good: "ore" });

    // Selling before docking is refused at the Station door.
    const early = await call("POST", "/api/game/sell", {
      spaceId: idA,
      body: { buyerId: "station-exchange", good: "ore", qty: 1, idempotencyKey: "http-sell-early" },
    });
    expect(early.status).toBe(400);
    expect(early.body.error).toBe("not_docked");

    const dock = await call("POST", "/api/game/dock", { spaceId: idA });
    expect(dock.status).toBe(200);

    const sale = await call("POST", "/api/game/sell", {
      spaceId: idA,
      body: { buyerId: "station-foundry", good: "ore", qty: 12, idempotencyKey: "http-sell-1" },
    });
    expect(sale.status).toBe(200);
    expect(sale.body).toMatchObject({ ok: true, unitPrice: 6, totalCredits: 72, accepted: 12 });

    // Replay over the wire: same key, same body → stored result, no double pay.
    const replay = await call("POST", "/api/game/sell", {
      spaceId: idA,
      body: { buyerId: "station-foundry", good: "ore", qty: 12, idempotencyKey: "http-sell-1" },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);

    const st1 = await call("GET", "/api/game/state", { spaceId: idA });
    expect(st1.body.credits).toBe(72);
    expect(st1.body.cargo.ore).toBe(8);

    const guide = await call("GET", "/api/game/buyers-guide", { spaceId: idA });
    expect(guide.status).toBe(200);
    const foundryOre = (guide.body.entries as Array<any>).find(
      (x) => x.buyerId === "station-foundry" && x.good === "ore",
    );
    expect(foundryOre.unitPrice).toBe(6);
    expect(foundryOre.demandRemaining).toBe(28);

    const mint = await call("GET", "/api/game/mint-report", { spaceId: idA });
    expect(mint.status).toBe(200);
    expect((mint.body.days as Array<any>).reduce((s, d) => s + d.mintedCredits, 0)).toBe(72);

    const rec = await call("GET", "/api/game/reconcile", { spaceId: idA });
    expect(rec.body.ok).toBe(true);
  });

  it("unauthenticated requests are refused (401) on every game route", async () => {
    for (const [method, path] of [
      ["GET", "/api/game/state"],
      ["GET", "/api/game/buyers-guide"],
      ["POST", "/api/game/gather"],
      ["POST", "/api/game/sell"],
      ["POST", "/api/game/refine"],
      ["POST", "/api/game/transfer"],
      ["POST", "/api/game/dock"],
    ] as const) {
      const r = await call(method, path, method === "GET" ? {} : { body: {} });
      expect(r.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("TX-AC-04 isolation sweep — foreign identifiers are never honored", () => {
  it("space B is untouched by every A request that carries B identifiers", async () => {
    // Give B real state worth stealing: cargo, credits, a private node.
    const gb = await call("POST", "/api/game/gather", {
      spaceId: idB,
      body: { nodeId: "belt-1", idempotencyKey: "b-gather-1" },
    });
    expect(gb.body.ok).toBe(true);
    ctx.handle.sqlite
      .prepare(
        `INSERT INTO game_resource_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
         VALUES (?, 'b-private-node', 'wreck', 'salvage', 9, 9, 0)`,
      )
      .run(idB);
    const beforeB = gameSnapshot(idB);
    const beforeA = gameSnapshot(idA);

    // As A: probe every mutating route with B's identifiers in the body.
    const probes: Array<[string, unknown]> = [
      ["/api/game/gather", { nodeId: "b-private-node", idempotencyKey: "probe-1", spaceId: idB }],
      [
        "/api/game/sell",
        { buyerId: "station-exchange", good: "ore", qty: 1, idempotencyKey: "probe-2", spaceId: idB, targetSpace: idB },
      ],
      ["/api/game/refine", { recipeId: "R-1", idempotencyKey: "probe-3", spaceId: idB }],
      [
        "/api/game/transfer",
        { direction: "to-storage", good: "ore", qty: 1, idempotencyKey: "probe-4", spaceId: idB, fromSpace: idB },
      ],
    ];
    for (const [path, body] of probes) {
      const r = await call("POST", path, { spaceId: idA, body });
      // Each probe either fails honestly in A's own space or acts only
      // on A — B's private node never resolves for A:
      if (path.endsWith("gather")) {
        expect(r.body.ok).toBe(false);
        expect(r.body.error).toBe("unknown_node");
      }
    }
    // B is byte-for-byte untouched.
    expect(gameSnapshot(idB)).toBe(beforeB);
    // A's reads never leak B either: A's state shows no salvage from B's node.
    const stA = await call("GET", "/api/game/state", { spaceId: idA });
    expect(stA.body.cargo.salvage).toBe(0);
    // (A's own snapshot may legitimately differ — A's probes acted on A
    // or failed; what matters is B, asserted above.)
    void beforeA;
  });
});

describe("TX-AC-08 forged price — the server's posted price is the only price", () => {
  it("a body carrying price/yield fields is ignored; the sale commits at the posted price", async () => {
    // B's hold is full of ore from the sweep test — sell it off first
    // (also proving B's own economy works), then gather data.
    await call("POST", "/api/game/dock", { spaceId: idB });
    const clear = await call("POST", "/api/game/sell", {
      spaceId: idB,
      body: { buyerId: "station-exchange", good: "ore", qty: 20, idempotencyKey: "b-sell-clear" },
    });
    expect(clear.body.ok).toBe(true);
    const g = await call("POST", "/api/game/gather", {
      spaceId: idB,
      body: { nodeId: "signal-1", idempotencyKey: "b-gather-2", yield: 9999 },
    });
    expect(g.body.ok).toBe(true);
    expect(g.body.gathered).toBe(15); // the server's node yield, not the forged 9999
    const sale = await call("POST", "/api/game/sell", {
      spaceId: idB,
      body: {
        buyerId: "archive-broker",
        good: "data",
        qty: 2,
        idempotencyKey: "b-sell-forged",
        price: 99999,
        unitPrice: 99999,
        totalCredits: 99999,
      },
    });
    expect(sale.status).toBe(200);
    expect(sale.body.unitPrice).toBe(12); // Archive Broker's posted Data premium
    expect(sale.body.totalCredits).toBe(24);
    const st = await call("GET", "/api/game/state", { spaceId: idB });
    expect(st.body.credits).toBe(80 + 24); // 80 from clearing the ore + 24 from this sale
  });
});

describe("TX-AC-13 at the wire — guest-marked requests cannot mutate", () => {
  it("every mutating route refuses a guest actor and changes nothing", async () => {
    const before = gameSnapshot(idA);
    const attempts: Array<[string, unknown]> = [
      ["/api/game/gather", { nodeId: "belt-2", idempotencyKey: "guest-1" }],
      ["/api/game/sell", { buyerId: "station-exchange", good: "ore", qty: 1, idempotencyKey: "guest-2" }],
      ["/api/game/refine", { recipeId: "R-1", idempotencyKey: "guest-3" }],
      ["/api/game/transfer", { direction: "to-storage", good: "ore", qty: 1, idempotencyKey: "guest-4" }],
      ["/api/game/dock", {}],
      ["/api/game/undock", {}],
    ];
    for (const [path, body] of attempts) {
      const r = await call("POST", path, { spaceId: idA, body, actorKind: "guest" });
      expect(r.body.ok, path).toBe(false);
      expect(r.body.error, path).toBe("guest_cannot_mutate");
    }
    expect(gameSnapshot(idA)).toBe(before);
    // Reads remain open to a guest (look and talk).
    const st = await call("GET", "/api/game/state", { spaceId: idA, actorKind: "guest" });
    expect(st.status).toBe(200);
  });
});
