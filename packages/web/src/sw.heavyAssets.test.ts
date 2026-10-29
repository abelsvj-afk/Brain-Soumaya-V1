// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

/**
 * The service worker's heavy-binary cache (public/sw.js). The worker is a plain
 * script, so it is evaluated here against a fake `self`, fake Cache Storage and a
 * scriptable network, and driven with real `fetch` events.
 *
 * Why it exists: the browser's own HTTP cache would not keep the 14 MB and 10.5 MB
 * models — they were re-downloaded in full on every visit (measured). Models and
 * decoders now live in a persistent cache that survives deploys, are served at once,
 * and are re-validated in the background. Code, pages and /api must be untouched.
 */
const SW_SRC = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

type Handler = (e: any) => void;
interface Net {
  calls: { url: string; init?: any }[];
  respond: (url: string, init?: any) => Response | Promise<Response>;
}

function makeWorker() {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const net: Net = { calls: [], respond: () => new Response("net", { status: 200 }) };
  const key = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        match: async (r: Request | string) => m.get(key(r))?.clone(),
        put: async (r: Request | string, res: Response) => {
          m.set(key(r), res.clone());
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (r: Request | string) => {
      for (const m of stores.values()) if (m.has(key(r))) return m.get(key(r))!.clone();
      return undefined;
    },
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: {},
  };
  const fetchFn = async (input: Request | string, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    net.calls.push({ url, init });
    const res = await net.respond(url, init);
    // A real same-origin network response has type "basic"; a bare `new Response()` reports
    // "default". The worker (correctly) only keeps "basic" ones, so mirror the real thing.
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  };
  vm.runInNewContext(SW_SRC.replace(/__BUILD_ID__/g, "btest"), { self, caches, fetch: fetchFn, URL, Request, Response, Promise, console });
  const bg: Promise<unknown>[] = [];
  /** Dispatch a GET and return {intercepted, response}; background work is collected. */
  const get = async (path: string, headers: Record<string, string> = {}) => {
    let responded: Promise<Response> | undefined;
    const e = {
      request: new Request("https://app.test" + path, { headers }),
      respondWith: (p: Promise<Response>) => (responded = Promise.resolve(p)),
      waitUntil: (p: Promise<unknown>) => bg.push(Promise.resolve(p)),
    };
    handlers.fetch!(e);
    return { intercepted: !!responded, response: responded ? await responded : undefined };
  };
  const settle = () => Promise.all(bg.splice(0));
  return { handlers, stores, net, get, settle, caches };
}

const glb = (body: string, etag = '"v1"') =>
  new Response(body, { status: 200, headers: { "content-type": "model/gltf-binary", etag } });

let w: ReturnType<typeof makeWorker>;
beforeEach(() => {
  w = makeWorker();
});

describe("heavy binaries: persistent cache", () => {
  it("first request goes to the network once and is stored", async () => {
    w.net.respond = () => glb("MODEL-A");
    const r = await w.get("/space_station_3.glb");
    expect(await r.response!.text()).toBe("MODEL-A");
    await w.settle();
    expect(w.net.calls).toHaveLength(1);
    expect([...w.stores.get("soumaya-assets-v1")!.keys()]).toEqual(["https://app.test/space_station_3.glb"]);
  });

  it("second request is served from the cache at once — the 14 MB is not downloaded again", async () => {
    w.net.respond = () => glb("MODEL-A");
    await w.get("/space_station_3.glb");
    await w.settle();
    w.net.calls.length = 0;
    // The network now answers 304 to the background check.
    w.net.respond = () => new Response(null, { status: 304 });
    const r = await w.get("/space_station_3.glb");
    expect(await r.response!.text()).toBe("MODEL-A");
    await w.settle();
    // Exactly one background request, and it was CONDITIONAL — never a full re-download.
    expect(w.net.calls).toHaveLength(1);
    expect(w.net.calls[0]!.init.headers["If-None-Match"]).toBe('"v1"');
    expect(w.net.calls[0]!.init.cache).toBe("no-store");
    // `no-store` makes browsers add `Cache-Control: no-cache`, which Express treats as a forced
    // reload (full 200 instead of 304). The worker must send its OWN Cache-Control, and it must
    // not be a no-cache — see server/__tests__/staticCaching.test.ts for the server side.
    const cc = w.net.calls[0]!.init.headers["Cache-Control"];
    expect(cc).toBeTruthy();
    expect(cc).not.toMatch(/no-cache|no-store/);
  });

  it("a file replaced on the server is picked up: this launch serves the old copy, the next the new one", async () => {
    w.net.respond = () => glb("OLD", '"v1"');
    await w.get("/sf-lava-planet.glb");
    await w.settle();
    w.net.respond = () => glb("NEW-SLIMMED", '"v2"');
    expect(await (await w.get("/sf-lava-planet.glb")).response!.text()).toBe("OLD"); // instant, no wait on the network
    await w.settle();
    expect(await (await w.get("/sf-lava-planet.glb")).response!.text()).toBe("NEW-SLIMMED");
  });

  it("covers the Draco and Basis decoders too", async () => {
    w.net.respond = () => new Response("wasm", { status: 200, headers: { etag: '"d"' } });
    await w.get("/draco/draco_decoder.wasm");
    await w.get("/basis/basis_transcoder.wasm");
    await w.settle();
    expect(w.stores.get("soumaya-assets-v1")!.size).toBe(2);
  });

  it("offline: the cached copy keeps serving and a failed background check changes nothing", async () => {
    w.net.respond = () => glb("MODEL-A");
    await w.get("/a.glb");
    await w.settle();
    w.net.respond = () => {
      throw new Error("offline");
    };
    const r = await w.get("/a.glb");
    expect(await r.response!.text()).toBe("MODEL-A");
    await w.settle(); // must not reject
  });
});

describe("heavy binaries: one download per file at a time", () => {
  // The destination world's models are prefetched during the flight. If the scene mounts and asks
  // for the same file while that is still streaming, it must JOIN it — not start a second 14 MB download.
  it("two simultaneous requests for the same uncached file share ONE network fetch, and both get the bytes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    w.net.respond = async () => {
      await gate;
      return glb("SHARED-BYTES");
    };
    const a = w.get("/space_station_3.glb");
    const b = w.get("/space_station_3.glb");
    await Promise.resolve();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(await ra.response!.text()).toBe("SHARED-BYTES");
    expect(await rb.response!.text()).toBe("SHARED-BYTES");
    await w.settle();
    expect(w.net.calls.filter((c) => c.url.endsWith("space_station_3.glb"))).toHaveLength(1);
  });

  it("different files do not wait on each other", async () => {
    w.net.respond = (url) => glb("X-" + url.split("/").pop());
    const [a, b] = await Promise.all([w.get("/a.glb"), w.get("/b.glb")]);
    expect(await a.response!.text()).toBe("X-a.glb");
    expect(await b.response!.text()).toBe("X-b.glb");
    expect(w.net.calls).toHaveLength(2);
  });

  it("after a download finishes or fails, the next request starts fresh (nothing sticks)", async () => {
    w.net.respond = () => {
      throw new Error("flaky network");
    };
    await expect(w.get("/a.glb")).rejects.toThrow();
    w.net.respond = () => glb("RECOVERED");
    expect(await (await w.get("/a.glb")).response!.text()).toBe("RECOVERED");
  });
});

describe("heavy binaries: what must NOT be cached or intercepted", () => {
  it("never keeps an HTML page served for a .glb — the SPA fallback answers unknown paths with a 200", async () => {
    w.net.respond = () => new Response("<html>app</html>", { status: 200, headers: { "content-type": "text/html" } });
    await w.get("/missing-model.glb");
    await w.settle();
    expect(w.stores.get("soumaya-assets-v1")?.size ?? 0).toBe(0);
  });

  it("never keeps a failed response", async () => {
    w.net.respond = () => new Response("nope", { status: 404 });
    await w.get("/gone.glb");
    await w.settle();
    expect(w.stores.get("soumaya-assets-v1")?.size ?? 0).toBe(0);
  });

  it("a background 'changed' answer that is really an HTML error page does not replace the good copy", async () => {
    w.net.respond = () => glb("GOOD");
    await w.get("/a.glb");
    await w.settle();
    w.net.respond = () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } });
    await w.get("/a.glb");
    await w.settle();
    expect(await (await w.get("/a.glb")).response!.text()).toBe("GOOD");
  });

  it("a Range request (partial content) never reads from or writes to the asset cache", async () => {
    w.net.respond = () => glb("FULL");
    await w.get("/a.glb"); // a full copy is cached
    await w.settle();
    w.net.calls.length = 0;
    w.net.respond = () => new Response("PART", { status: 206, headers: { "content-type": "model/gltf-binary" } });
    const r = await w.get("/a.glb", { range: "bytes=0-3" });
    expect(await r.response!.text()).toBe("PART"); // answered by the network, not the cached full copy
    await w.settle();
    expect(w.net.calls.some((c) => c.init?.headers?.["If-None-Match"])).toBe(false); // no background check either
    expect(await (await w.get("/a.glb")).response!.text()).toBe("FULL"); // and the partial did not replace it
  });

  it("does not intercept /api", async () => {
    expect((await w.get("/api/graph")).intercepted).toBe(false);
  });

  it("code stays network-first and is NOT put in the persistent asset cache", async () => {
    w.net.respond = () => new Response("js", { status: 200, headers: { "content-type": "text/javascript" } });
    const r = await w.get("/assets/index-BX3EQEE3.js");
    expect(r.intercepted).toBe(true);
    await w.settle();
    expect(w.stores.get("soumaya-assets-v1")?.size ?? 0).toBe(0);
    // and it always asks the network first (never serves a stale bundle)
    expect(w.net.calls.some((c) => c.url.endsWith("index-BX3EQEE3.js"))).toBe(true);
  });
});

describe("lifecycle", () => {
  it("activate evicts old build caches but KEEPS the asset cache across deploys", async () => {
    await w.caches.open("soumaya-bold1");
    await w.caches.open("soumaya-btest");
    await w.caches.open("soumaya-assets-v1");
    let done: Promise<unknown> | undefined;
    w.handlers.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...w.stores.keys()].sort()).toEqual(["soumaya-assets-v1", "soumaya-btest"]);
  });

  it("falls back to the plain network if cache storage is unavailable", async () => {
    w.caches.open = async () => {
      throw new Error("storage disabled");
    };
    w.net.respond = () => glb("MODEL-A");
    // re-evaluating the worker is not needed: heavyAsset reads the same `caches` object
    const r = await w.get("/a.glb");
    expect(await r.response!.text()).toBe("MODEL-A");
  });
});
