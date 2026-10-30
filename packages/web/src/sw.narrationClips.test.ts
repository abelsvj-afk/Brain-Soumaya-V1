// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

/** The worker keeps heard lore clips on the device (docs/specs/lore-narration-2026-10-30.md §5): per brain, per exact words, only real audio. */
const SW_SRC = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

function makeWorker() {
  const handlers: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const calls: string[] = [];
  let answer: (url: string) => Response = () => new Response("x", { status: 200 });
  const key = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return { match: async (r: Request | string) => m.get(key(r))?.clone(), put: async (r: Request | string, res: Response) => void m.set(key(r), res.clone()) };
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async () => undefined,
  };
  const self = { location: { origin: "https://app.test" }, addEventListener: (t: string, h: (e: any) => void) => (handlers[t] = h), skipWaiting: async () => {}, clients: { claim: async () => {}, matchAll: async () => [] }, registration: {} };
  const fetchFn = async (input: Request | string) => {
    calls.push(typeof input === "string" ? input : input.url);
    const res = answer(typeof input === "string" ? input : input.url);
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  };
  vm.runInNewContext(SW_SRC.replace(/__BUILD_ID__/g, "btest"), { self, caches, fetch: fetchFn, URL, Request, Response, Promise, console });
  const bg: Promise<unknown>[] = [];
  const get = async (path: string, space = "brain-a") => {
    let responded: Promise<Response> | undefined;
    handlers.fetch!({ request: new Request("https://app.test" + path, { headers: { "x-space-id": space } }), respondWith: (p: Promise<Response>) => (responded = Promise.resolve(p)), waitUntil: (p: Promise<unknown>) => bg.push(Promise.resolve(p)) });
    const res = responded ? await responded : undefined;
    await Promise.all(bg.splice(0));
    return res;
  };
  return { get, stores, calls, set: (f: (url: string) => Response) => (answer = f) };
}

const audio = (body = "MP3") => new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } });
const P = "/api/story/narration/obj.kiths-drawing?register=plain&t=abc";
let w: ReturnType<typeof makeWorker>;
beforeEach(() => {
  w = makeWorker();
});

describe("lore clips on the device", () => {
  it("a clip heard once plays again with no network", async () => {
    w.set(() => audio("CLIP"));
    expect(await (await w.get(P))!.text()).toBe("CLIP");
    w.calls.length = 0;
    expect(await (await w.get(P))!.text()).toBe("CLIP");
    expect(w.calls).toHaveLength(0);
  });
  it("is kept per brain: another brain on the same device asks the server (it may not have found that yet)", async () => {
    w.set(() => audio("CLIP"));
    await w.get(P, "brain-a");
    w.calls.length = 0;
    await w.get(P, "brain-b");
    expect(w.calls).toHaveLength(1);
  });
  it("changed words are a different clip (the hash of the words is in the key)", async () => {
    w.set(() => audio("OLD"));
    await w.get(P);
    w.set(() => audio("NEW"));
    expect(await (await w.get("/api/story/narration/obj.kiths-drawing?register=plain&t=zzz"))!.text()).toBe("NEW");
  });
  it("keeps only real audio: a 204 ('read it yourself'), an error or an HTML page is never stored", async () => {
    w.set(() => new Response(null, { status: 204 }));
    await w.get(P);
    w.set(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await w.get(P);
    w.set(() => new Response("no", { status: 403 }));
    await w.get(P);
    expect(w.stores.get("soumaya-assets-v1")?.size ?? 0).toBe(0);
  });
  it("leaves the rest of the API alone — live brain data is never cached", async () => {
    w.set(() => audio());
    const r = await w.get("/api/story/book");
    expect(r).toBeUndefined(); // not intercepted at all
    expect(w.stores.get("soumaya-assets-v1")?.size ?? 0).toBe(0);
  });
});
