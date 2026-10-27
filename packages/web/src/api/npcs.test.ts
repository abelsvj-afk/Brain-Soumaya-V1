import { describe, it, expect, vi, afterEach } from "vitest";
import {
  askNpc,
  getNpc,
  getNpcs,
  NpcClientError,
  resumeNpc,
  stopNpc,
} from "./npcs.js";
import type { NpcState } from "@brain/shared";

/**
 * NPC autonomy client: the binding over the server loop. These tests
 * pin the wire shape (paths, bodies, response unwrapping) and the
 * error grammar (server plain-language message + code preserved; 404
 * mapped to NOT_FOUND). Transport is the global fetch that afetch
 * wraps.
 */

const npcState = (over: Partial<NpcState> = {}): NpcState => ({
  id: "harbor-controller",
  name: "Harbor controller",
  job: "Help you arrive — routes, arrivals, traffic.",
  world: "great-station",
  stopped: false,
  actsToday: 1,
  speaksToday: 0,
  gateOpen: false,
  relicsHeld: 0,
  recentLog: [],
  ...over,
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}
const jsonRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getNpcs", () => {
  it("returns the roster with state", async () => {
    stubFetch(async () => jsonRes(200, { npcs: [npcState()] }));
    const list = await getNpcs();
    expect(list?.map((n) => n.id)).toEqual(["harbor-controller"]);
  });

  it("returns null when the brain is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await getNpcs()).toBeNull();
  });
});

describe("getNpc", () => {
  it("returns one NPC's state", async () => {
    stubFetch(async (url) => {
      expect(url).toContain("/api/npcs/harbor-controller");
      return jsonRes(200, { npc: npcState() });
    });
    const s = await getNpc("harbor-controller");
    expect(s?.name).toBe("Harbor controller");
  });

  it("returns null when the brain is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await getNpc("harbor-controller")).toBeNull();
  });
});

describe("askNpc", () => {
  it("posts the question and returns the spoken answer", async () => {
    const fn = stubFetch(async (url, init) => {
      expect(url).toContain("/api/npcs/harbor-controller/ask");
      expect(JSON.parse(String(init?.body))).toEqual({ question: "fuel" });
      return jsonRes(200, { npc: npcState({ speaksToday: 1 }), answer: "You hold 25 fuel." });
    });
    const r = await askNpc("harbor-controller", "fuel");
    expect(r.answer).toBe("You hold 25 fuel.");
    expect(r.npc.speaksToday).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("preserves the server's plain-language error and code", async () => {
    stubFetch(async () =>
      jsonRes(429, { error: "has used today's allowance", code: "NPC_BUDGET_EXHAUSTED" }),
    );
    await expect(askNpc("harbor-controller", "fuel")).rejects.toMatchObject({
      code: "NPC_BUDGET_EXHAUSTED",
    } satisfies Partial<NpcClientError>);
  });
});

describe("stopNpc / resumeNpc", () => {
  it("posts to the kill-switch routes and returns the state", async () => {
    stubFetch(async (url) => jsonRes(200, { npc: npcState({ stopped: url.includes("/stop") }) }));
    expect((await stopNpc("harbor-controller")).stopped).toBe(true);
    expect((await resumeNpc("harbor-controller")).stopped).toBe(false);
  });

  it("maps an unknown NPC to NOT_FOUND", async () => {
    stubFetch(async () => jsonRes(404, { error: "No NPC", code: "UNKNOWN_NPC" }));
    await expect(stopNpc("keeper")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
