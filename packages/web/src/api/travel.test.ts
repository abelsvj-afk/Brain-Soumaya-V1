import { describe, it, expect, vi, afterEach } from "vitest";
import {
  arriveJourney,
  cancelJourney,
  departJourney,
  getTravelState,
  TravelClientError,
} from "./travel.js";

/**
 * P2-3 travel client: the binding over the P2-2 contract. These tests
 * pin the wire shape (paths, bodies, response unwrapping) and the error
 * grammar (server plain-language message + code preserved; 404 mapped
 * to NOT_FOUND). Transport is the global fetch that afetch wraps.
 */

const journey = {
  id: "j-1",
  kind: "warp",
  origin: "home",
  destination: "great-station",
  state: "arming",
  fuelCharged: 0,
  cancellable: true,
  createdAt: "2026-10-23T12:00:00.000Z",
  cancelDeadline: "2026-10-23T12:00:10.000Z",
};

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

describe("getTravelState", () => {
  it("returns the server's state view", async () => {
    stubFetch(async () =>
      jsonRes(200, {
        currentWorld: "home",
        activeJourney: null,
        fuel: { fuel: 25, capacity: 200, jobCost: 2, warpCost: 10 },
      }),
    );
    const s = await getTravelState();
    expect(s?.currentWorld).toBe("home");
    expect(s?.fuel.warpCost).toBe(10);
  });

  it("returns null when the brain is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await getTravelState()).toBeNull();
  });
});

describe("departJourney", () => {
  it("posts the intent and returns the journey", async () => {
    const fn = stubFetch(async () => jsonRes(200, { journey }));
    const j = await departJourney({ clientKey: "key-1", kind: "warp", destination: "great-station" });
    expect(j.id).toBe("j-1");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/travel/depart");
    expect(JSON.parse(String(init.body))).toEqual({
      clientKey: "key-1",
      kind: "warp",
      destination: "great-station",
    });
  });

  it("surfaces a 409 with the server's code and plain-language message", async () => {
    stubFetch(async () =>
      jsonRes(409, {
        error: "A journey is already in progress — finish or cancel it first.",
        code: "ACTIVE_JOURNEY_EXISTS",
      }),
    );
    await expect(
      departJourney({ clientKey: "k2", kind: "drift", destination: "great-station" }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "TravelClientError",
        code: "ACTIVE_JOURNEY_EXISTS",
        message: "A journey is already in progress — finish or cancel it first.",
      }),
    );
  });
});

describe("journey actions", () => {
  it("cancel posts the journey id and returns the committed state", async () => {
    const fn = stubFetch(async () => jsonRes(200, { journey: { ...journey, state: "cancelled" } }));
    const j = await cancelJourney("j-1");
    expect(j.state).toBe("cancelled");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/travel/cancel");
    expect(JSON.parse(String(init.body))).toEqual({ journeyId: "j-1" });
  });

  it("a 404 maps to NOT_FOUND (an unknown journey is never retried blind)", async () => {
    stubFetch(async () => jsonRes(404, { error: "Journey not found." }));
    await expect(arriveJourney("nope")).rejects.toEqual(
      expect.objectContaining({ name: "TravelClientError", code: "NOT_FOUND" }),
    );
  });

  it("arrive returns the server's arrival, never a local guess", async () => {
    stubFetch(async () =>
      jsonRes(200, { journey: { ...journey, state: "arrived", fuelCharged: 10 } }),
    );
    const j = await arriveJourney("j-1");
    expect(j.state).toBe("arrived");
    expect(j.fuelCharged).toBe(10);
  });

  it("TravelClientError is an Error with a stable name", () => {
    const e = new TravelClientError("X", "msg");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("TravelClientError");
  });
});
