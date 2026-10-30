import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo, TravelError } from "../repositories/travel.repo.js";
import { isOwnerSpace } from "../auth/owner.js";
import { EconomyRepo } from "../economy.js";
import { warpCost } from "@brain/shared";
import { ETERNITY_WORLD_KEY } from "@brain/shared";

/**
 * Owner access (auth/owner.ts): the deployment owner's brain skips the
 * worlds' progression gates; everyone else is untouched. The security
 * properties matter more than the convenience, so they are tested first.
 */
const T0 = Date.parse("2026-10-28T12:00:00.000Z");
const OWNER = "owner-space-id";
const OTHER = "someone-elses-space";

let handle: DbHandle;
const prev = process.env.OWNER_SPACE_IDS;
beforeEach(() => {
  handle = createDb(":memory:");
  delete process.env.OWNER_SPACE_IDS;
});
afterEach(() => {
  handle.sqlite.close();
  if (prev === undefined) delete process.env.OWNER_SPACE_IDS;
  else process.env.OWNER_SPACE_IDS = prev;
});

const travel = (space: string) => new TravelRepo(handle, space);
const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof TravelError ? e.code : "OTHER";
  }
};

describe("isOwnerSpace — fail closed", () => {
  it("nobody is exempt when OWNER_SPACE_IDS is unset, empty, or only separators", () => {
    expect(isOwnerSpace(OWNER)).toBe(false);
    process.env.OWNER_SPACE_IDS = "";
    expect(isOwnerSpace(OWNER)).toBe(false);
    process.env.OWNER_SPACE_IDS = " , ,";
    expect(isOwnerSpace("")).toBe(false);
    expect(isOwnerSpace(" ")).toBe(false);
  });
  it("matches an exact id from a comma list, tolerating spaces — never a substring or prefix", () => {
    process.env.OWNER_SPACE_IDS = `a, ${OWNER} ,b`;
    expect(isOwnerSpace(OWNER)).toBe(true);
    expect(isOwnerSpace("owner-space")).toBe(false);
    expect(isOwnerSpace(OWNER + "x")).toBe(false);
    expect(isOwnerSpace(OTHER)).toBe(false);
  });
});

describe("owner access — worlds gates", () => {
  it("without the secret, even the would-be owner meets every gate", () => {
    const t = travel(OWNER);
    expect(t.peopleGateOpen()).toBe(false);
    expect(t.eternityGateReachable()).toBe(false);
    expect(code(() => t.depart({ clientKey: "k1", kind: "drift", destination: "people" }, T0))).toBe("PEOPLE_GATE_CLOSED");
    expect(code(() => t.depart({ clientKey: "k2", kind: "drift", destination: ETERNITY_WORLD_KEY }, T0))).toBe("ETERNITY_GATE_CLOSED");
  });

  it("the owner's state reports both gates open, so the board offers them", () => {
    process.env.OWNER_SPACE_IDS = OWNER;
    const s = travel(OWNER).getState(T0);
    expect(s.peopleGateOpen).toBe(true);
    expect(s.eternityReachable).toBe(true);
  });

  it("the owner can depart straight to People and straight to Eternity (no relics, no chain)", () => {
    process.env.OWNER_SPACE_IDS = OWNER;
    const t = travel(OWNER);
    const toPeople = t.depart({ clientKey: "p", kind: "drift", destination: "people" }, T0);
    expect(toPeople.destination).toBe("people");
    t.cancel(toPeople.id, T0 + 1000);
    const toEternity = t.depart({ clientKey: "e", kind: "drift", destination: ETERNITY_WORLD_KEY }, T0 + 2000);
    expect(toEternity.destination).toBe(ETERNITY_WORLD_KEY);
  });

  it("the owner's secret opens ONLY the owner's brain — another space stays gated", () => {
    process.env.OWNER_SPACE_IDS = OWNER;
    const other = travel(OTHER);
    expect(other.peopleGateOpen()).toBe(false);
    expect(other.eternityGateReachable()).toBe(false);
    expect(code(() => other.depart({ clientKey: "x", kind: "drift", destination: ETERNITY_WORLD_KEY }, T0))).toBe("ETERNITY_GATE_CLOSED");
    // And the bypass leaves the other space's ledger untouched.
    expect(travel(OWNER).getState(T0).activeJourney).toBeNull();
  });

  it("the owner still cannot depart for the world they are already standing in", () => {
    process.env.OWNER_SPACE_IDS = OWNER;
    const t = travel(OWNER);
    const j = t.depart({ clientKey: "e1", kind: "drift", destination: ETERNITY_WORLD_KEY }, T0);
    const settled = t.getJourney(j.id, Date.parse(j.cancelDeadline!) + 1000)!;
    t.arrive(settled.id, T0 + 10 * 60_000);
    expect(t.currentWorld(T0 + 11 * 60_000)).toBe(ETERNITY_WORLD_KEY);
    expect(code(() => t.depart({ clientKey: "e2", kind: "drift", destination: ETERNITY_WORLD_KEY }, T0 + 12 * 60_000))).toBe("ETERNITY_CHAIN_REQUIRED");
  });

  it("owner access does not waive fuel: a warp still charges", () => {
    process.env.OWNER_SPACE_IDS = OWNER;
    const t = travel(OWNER);
    const econ = new EconomyRepo(handle, OWNER);
    const before = econ.get();
    const j = t.depart({ clientKey: "w", kind: "warp", destination: "people" }, T0);
    t.getJourney(j.id, Date.parse(j.cancelDeadline!) + 1000); // past the free-cancel window: settles and charges
    // EconomyRepo regen accrues on real elapsed time — a few thousandths, hence the tolerance.
    expect(before - econ.get()).toBeGreaterThan(warpCost("home", "people") - 0.5);
  });
});

describe("GET /api/space/me — owner flag over real HTTP", () => {
  it("reports owner true only for a listed space id, and never leaks the secret list", async () => {
    const { buildContext } = await import("../context.js");
    const { createApp } = await import("../api/server.js");
    const { HashEmbeddingProvider } = await import("../embeddings/hash.js");
    const { HeuristicProvider } = await import("../llm/heuristic.js");
    const { EMBED_DIM } = await import("../db/vec.js");
    const ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const server = createApp(ctx).listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      const auth = async (tag: string) =>
        (await (await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gamerTag: tag, passcode: "correct-horse-1" }) })).json()) as { id: string };
      const a = await auth("ownerperson");
      const b = await auth("bystander");
      process.env.OWNER_SPACE_IDS = a.id;
      const me = async (id: string) => (await (await fetch(`${base}/api/space/me`, { headers: { "x-space-id": id } })).json()) as Record<string, unknown>;
      const meA = await me(a.id);
      const meB = await me(b.id);
      expect(meA.owner).toBe(true);
      expect(meB.owner).toBe(false);
      expect(JSON.stringify(meB)).not.toContain(a.id);
    } finally {
      server.close();
      ctx.handle.sqlite.close();
    }
  });
});
