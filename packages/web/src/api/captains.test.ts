import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CaptainClientError,
  askCaptain,
  getCaptain,
  getCaptains,
  getChronicle,
  resumeCaptain,
  stopCaptain,
  wipeCaptainMeetings,
} from "./captains.js";
import type { CaptainState } from "@brain/shared";

/**
 * Captain client (NPC-Player Layer L1): the binding over the server
 * engine. These tests pin the wire shape (paths, bodies, response
 * unwrapping — note ask returns { answer, state } from the engine)
 * and the error grammar (server plain-language message + code
 * preserved; 404 mapped to NOT_FOUND).
 */

const captainState = (over: Partial<CaptainState> = {}): CaptainState => ({
  id: "bex",
  name: "Bex",
  role: "Regular",
  pronouns: "she",
  ageBand: "late 20s",
  personality: "Warm, sociable, always at the Station.",
  traits: ["Sociable", "Generous", "Cautious"],
  active: true,
  present: true,
  homeWorld: "great-station",
  currentWorld: "great-station",
  sessionState: "visiting",
  doingLine: "Visiting the Great Station.",
  fuel: 60,
  credits: 120,
  stopped: false,
  actsToday: 1,
  speaksToday: 0,
  meetingsRemembered: 0,
  firstMetAt: null,
  recentLog: [],
  barks: [],
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

describe("getCaptains / getCaptain / getChronicle", () => {
  it("returns the roster with state", async () => {
    stubFetch(async () => jsonRes(200, { captains: [captainState()] }));
    const list = await getCaptains();
    expect(list?.map((c) => c.id)).toEqual(["bex"]);
  });

  it("returns null when the brain is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await getCaptains()).toBeNull();
    expect(await getCaptain("bex")).toBeNull();
    expect(await getChronicle()).toBeNull();
  });

  it("unwraps one captain and the Chronicle lines", async () => {
    stubFetch(async (url) => {
      if (url.includes("/chronicle")) {
        return jsonRes(200, {
          lines: [
            {
              id: 1,
              npcId: "bex",
              npcName: "Bex — Regular",
              kind: "arrive",
              line: "Came into the Great Station.",
              cause: "Her rhythm.",
              createdAt: "2026-10-22T12:00:00.000Z",
            },
          ],
        });
      }
      return jsonRes(200, { captain: captainState() });
    });
    expect((await getCaptain("bex"))?.name).toBe("Bex");
    const lines = await getChronicle();
    expect(lines?.[0]?.npcName).toBe("Bex — Regular");
  });
});

describe("askCaptain", () => {
  it("posts the question and unwraps { answer, state }", async () => {
    const fn = stubFetch(async (url, init) => {
      expect(url).toContain("/api/captains/bex/ask");
      expect(JSON.parse(String(init?.body))).toEqual({ question: "doing" });
      return jsonRes(200, { answer: "I'm at the Great Station just now.", state: captainState() });
    });
    const out = await askCaptain("bex", "doing");
    expect(out.answer).toContain("Great Station");
    expect(out.captain.id).toBe("bex");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("surfaces the server's plain-language error with its code", async () => {
    stubFetch(async () => jsonRes(409, { error: "Bex is stopped.", code: "CAPTAIN_STOPPED" }));
    await expect(askCaptain("bex", "met")).rejects.toMatchObject({
      name: "CaptainClientError",
      code: "CAPTAIN_STOPPED",
      message: "Bex is stopped.",
    });
  });

  it("maps a 404 to NOT_FOUND", async () => {
    stubFetch(async () => jsonRes(404, { error: "no", code: "UNKNOWN_CAPTAIN" }));
    await expect(stopCaptain("nobody")).rejects.toBeInstanceOf(CaptainClientError);
    await expect(stopCaptain("nobody")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("owner controls", () => {
  it("stop / resume / wipe-meetings post to their routes and unwrap the captain", async () => {
    const seen: string[] = [];
    stubFetch(async (url) => {
      seen.push(url);
      return jsonRes(200, { captain: captainState({ stopped: url.includes("/stop") }) });
    });
    expect((await stopCaptain("bex")).stopped).toBe(true);
    expect((await resumeCaptain("bex")).stopped).toBe(false);
    await wipeCaptainMeetings("bex");
    expect(seen.some((u) => u.includes("/api/captains/bex/stop"))).toBe(true);
    expect(seen.some((u) => u.includes("/api/captains/bex/resume"))).toBe(true);
    expect(seen.some((u) => u.includes("/api/captains/bex/wipe-meetings"))).toBe(true);
  });
});
