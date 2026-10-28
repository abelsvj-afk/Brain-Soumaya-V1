import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FleetDefenseClientError,
  getFleetDefenseOverview,
  offerFleetDefenseRelease,
  startFleetDefense,
  tickFleetDefense,
} from "./fleetDefense.js";
import type { FleetDefenseOverview, FleetDefenseRelease, FleetDefenseState } from "@brain/shared";

/**
 * Fleet defense client: the binding over the server defense. These
 * tests pin the wire shape (paths, bodies, response unwrapping) and
 * the error grammar (server plain-language message + code preserved;
 * 404 mapped to the server's code). Transport is the global fetch
 * that afetch wraps.
 */

const release = (over: Partial<FleetDefenseRelease> = {}): FleetDefenseRelease => ({
  id: 1,
  kind: "emotion",
  size: "small",
  label: "the old argument",
  nodeId: null,
  status: "offered",
  createdAt: "2026-10-22T12:00:00.000Z",
  updatedAt: "2026-10-22T12:00:00.000Z",
  ...over,
});

const defense = (over: Partial<FleetDefenseState> = {}): FleetDefenseState => ({
  id: 1,
  releaseId: 1,
  status: "active",
  invaders: [
    { lane: 1, distance: 5, shipKey: "bob", shipUrl: "/quaternius-bob.glb", shipName: "Quaternius bob", dispersed: false },
    { lane: 2, distance: 5, shipKey: "challenger", shipUrl: "/quaternius-challenger.glb", shipName: "Quaternius challenger", dispersed: false },
    { lane: 3, distance: 5, shipKey: "dispatcher", shipUrl: "/quaternius-dispatcher.glb", shipName: "Quaternius dispatcher", dispersed: false },
  ],
  tickCount: 0,
  lastMode: null,
  lastLine: null,
  outcomeLine: null,
  createdAt: "2026-10-22T12:00:00.000Z",
  updatedAt: "2026-10-22T12:00:00.000Z",
  ...over,
});

const overview = (over: Partial<FleetDefenseOverview> = {}): FleetDefenseOverview => ({
  releases: [],
  activeDefense: null,
  activeRelease: null,
  history: [],
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

describe("getFleetDefenseOverview", () => {
  it("returns the overview", async () => {
    stubFetch(async () => jsonRes(200, { overview: overview({ releases: [release()] }) }));
    const state = await getFleetDefenseOverview();
    expect(state?.releases).toHaveLength(1);
  });

  it("returns null when the brain is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await getFleetDefenseOverview()).toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    stubFetch(async () => jsonRes(500, { error: "boom" }));
    expect(await getFleetDefenseOverview()).toBeNull();
  });
});

describe("offerFleetDefenseRelease", () => {
  it("posts the offer and returns the release", async () => {
    const fetch = stubFetch(async () => jsonRes(201, { release: release() }));
    const out = await offerFleetDefenseRelease({ kind: "emotion", size: "small", label: "the old argument" });
    expect(out.id).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/fleet-defense/releases"),
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body ?? "{}")) as Record<string, unknown>;
    expect(body).toEqual({ kind: "emotion", size: "small", label: "the old argument" });
  });

  it("throws the server's plain words on a bad offer", async () => {
    stubFetch(async () => jsonRes(400, { error: "Name what you are letting go of.", code: "INVALID_INPUT" }));
    await expect(
      offerFleetDefenseRelease({ kind: "emotion", size: "small", label: "  " }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Name what you are letting go of." });
  });
});

describe("startFleetDefense", () => {
  it("posts the start and returns the composed wave", async () => {
    stubFetch(async () => jsonRes(201, { defense: defense() }));
    const out = await startFleetDefense(1);
    expect(out.status).toBe("active");
    expect(out.invaders).toHaveLength(3);
  });

  it("keeps the server's code on a 404", async () => {
    stubFetch(async () => jsonRes(404, { error: "That release isn't here.", code: "UNKNOWN_RELEASE" }));
    await expect(startFleetDefense(999)).rejects.toBeInstanceOf(FleetDefenseClientError);
    await expect(startFleetDefense(999)).rejects.toMatchObject({ code: "UNKNOWN_RELEASE" });
  });
});

describe("tickFleetDefense", () => {
  it("posts the mode and lane and returns the new board", async () => {
    const fetch = stubFetch(async () => jsonRes(200, { defense: defense({ tickCount: 1 }) }));
    const out = await tickFleetDefense(1, "helm", 2);
    expect(out.tickCount).toBe(1);
    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body ?? "{}")) as Record<string, unknown>;
    expect(body).toEqual({ mode: "helm", lane: 2 });
  });

  it("an autonomous tick carries no lane", async () => {
    const fetch = stubFetch(async () => jsonRes(200, { defense: defense({ tickCount: 1 }) }));
    await tickFleetDefense(1, "autonomous");
    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body ?? "{}")) as Record<string, unknown>;
    expect(body.mode).toBe("autonomous");
    expect(body.lane).toBeUndefined();
  });
});
