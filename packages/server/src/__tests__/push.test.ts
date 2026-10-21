import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";

// Mock the web-push transport so the reminder-integration tests below never
// touch a real push service. Injected-sender tests don't use this mock.
const mockSendNotification = vi.fn(async (..._args: unknown[]) => ({}));
const mockSetVapidDetails = vi.fn((..._args: unknown[]) => {});
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...a: unknown[]) => mockSetVapidDetails(...a),
    sendNotification: (...a: unknown[]) => mockSendNotification(...a),
  },
}));

import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { PushSubscriptionsRepo } from "../repositories/pushSubscriptions.repo.js";
import { getVapidConfig, sendPushToSpace, type VapidConfig } from "../push/service.js";
import { reminderTool } from "../agent/tools/reminder.js";
import type { ToolContext } from "../agent/tools/types.js";

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: "BTestPublicKey123",
  VAPID_PRIVATE_KEY: "test-private-key",
  VAPID_SUBJECT: "mailto:test@example.com",
} as const;

const CONFIG: VapidConfig = {
  publicKey: VAPID_ENV.VAPID_PUBLIC_KEY,
  privateKey: VAPID_ENV.VAPID_PRIVATE_KEY,
  subject: VAPID_ENV.VAPID_SUBJECT,
};

function setVapidEnv() {
  for (const [k, v] of Object.entries(VAPID_ENV)) process.env[k] = v;
}
function clearVapidEnv() {
  for (const k of Object.keys(VAPID_ENV)) delete process.env[k];
}

afterEach(() => {
  clearVapidEnv();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Service worker (static asset — its contract is pinned by reading the file)
// ---------------------------------------------------------------------------

describe("service worker push handlers", () => {
  const sw = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/public/sw.js"),
    "utf8",
  );

  it("registers push + notificationclick handlers that show/focus", () => {
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("showNotification");
    expect(sw).toContain("openWindow");
  });

  it("keeps the build-id placeholder + the never-cache-/api fetch contract", () => {
    expect(sw).toContain("soumaya-__BUILD_ID__");
    expect(sw).toContain('addEventListener("fetch"');
    expect(sw).toContain('url.pathname.startsWith("/api/")');
  });
});

// ---------------------------------------------------------------------------
// Schema / migration
// ---------------------------------------------------------------------------

describe("push_subscriptions schema", () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = createDb(":memory:");
  });
  afterEach(() => handle.sqlite.close());

  it("fresh bootstrap creates the table with the expected columns", () => {
    const cols = handle.sqlite.prepare(`PRAGMA table_info(push_subscriptions)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(["id", "space_id", "endpoint", "p256dh", "auth", "user_agent", "created_at"]);
    const idx = handle.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='push_subscriptions_space_idx'`)
      .get();
    expect(idx).toBeDefined();
  });

  it("migrateSchema adds the table to a pre-existing volume that lacks it", () => {
    const dir = mkdtempSync(join(tmpdir(), "brain-push-mig-"));
    const path = join(dir, "old.db");
    const old = new BetterSqlite3(path);
    old.exec(`
      CREATE TABLE nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    old.close();
    let migrated: DbHandle | undefined;
    try {
      expect(() => {
        migrated = createDb(path);
      }).not.toThrow();
      const t = migrated!.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'`)
        .get();
      expect(t).toBeDefined();
    } finally {
      migrated?.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

describe("PushSubscriptionsRepo", () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = createDb(":memory:");
  });
  afterEach(() => handle.sqlite.close());

  const sub = { endpoint: "https://push.example.com/sub/1", p256dh: "pk1", auth: "a1" };

  it("upsert inserts, then refreshes keys + owner on endpoint conflict", () => {
    const repo = new PushSubscriptionsRepo(handle, "s1");
    const first = repo.upsert({ ...sub, userAgent: "UA/1" });
    expect(first.spaceId).toBe("s1");
    expect(first.p256dh).toBe("pk1");

    const other = new PushSubscriptionsRepo(handle, "s2");
    const refreshed = other.upsert({ endpoint: sub.endpoint, p256dh: "pk2", auth: "a2" });
    expect(refreshed.id).toBe(first.id); // same row — endpoint is UNIQUE
    expect(refreshed.p256dh).toBe("pk2");
    expect(refreshed.spaceId).toBe("s2");
    expect(repo.listForSpace()).toHaveLength(0); // ownership moved
    expect(other.listForSpace()).toHaveLength(1);
  });

  it("listForSpace is space-scoped", () => {
    new PushSubscriptionsRepo(handle, "s1").upsert(sub);
    new PushSubscriptionsRepo(handle, "s2").upsert({ endpoint: "https://push.example.com/sub/2", p256dh: "pk", auth: "a" });
    expect(new PushSubscriptionsRepo(handle, "s1").listForSpace()).toHaveLength(1);
    expect(new PushSubscriptionsRepo(handle, "s2").listForSpace()).toHaveLength(1);
  });

  it("deleteByEndpoint is space-scoped by default and reports removal", () => {
    const s1 = new PushSubscriptionsRepo(handle, "s1");
    const s2 = new PushSubscriptionsRepo(handle, "s2");
    s1.upsert(sub);
    expect(s2.deleteByEndpoint(sub.endpoint)).toBe(false); // not s2's row
    expect(s1.listForSpace()).toHaveLength(1);
    expect(s1.deleteByEndpoint(sub.endpoint)).toBe(true);
    expect(s1.listForSpace()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// VAPID config
// ---------------------------------------------------------------------------

describe("getVapidConfig", () => {
  it("is null unless ALL three env vars are set", () => {
    expect(getVapidConfig({})).toBeNull();
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "x" })).toBeNull();
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y" })).toBeNull();
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "x", VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "  ", VAPID_PRIVATE_KEY: "y", VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
  });

  it("returns the triple when fully configured", () => {
    expect(getVapidConfig({ ...VAPID_ENV })).toEqual({
      publicKey: VAPID_ENV.VAPID_PUBLIC_KEY,
      privateKey: VAPID_ENV.VAPID_PRIVATE_KEY,
      subject: VAPID_ENV.VAPID_SUBJECT,
    });
  });
});

// ---------------------------------------------------------------------------
// Send path (injected sender — no real push service)
// ---------------------------------------------------------------------------

describe("sendPushToSpace", () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = createDb(":memory:");
    new PushSubscriptionsRepo(handle, "s1").upsert({ endpoint: "https://push.example.com/a", p256dh: "pkA", auth: "aA" });
    new PushSubscriptionsRepo(handle, "s1").upsert({ endpoint: "https://push.example.com/b", p256dh: "pkB", auth: "aB" });
    new PushSubscriptionsRepo(handle, "s2").upsert({ endpoint: "https://push.example.com/other", p256dh: "pkO", auth: "aO" });
  });
  afterEach(() => handle.sqlite.close());

  it("is a strict no-op when unconfigured — sender never called", async () => {
    const sender = vi.fn(async () => {});
    const res = await sendPushToSpace(handle, "s1", { title: "t", body: "b" }, { config: null, sender });
    expect(res).toEqual({ skipped: true, sent: 0, pruned: 0, failed: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  it("is a no-op when env is unconfigured (default config resolution)", async () => {
    clearVapidEnv();
    const res = await sendPushToSpace(handle, "s1", { title: "t", body: "b" });
    expect(res.skipped).toBe(true);
  });

  it("sends the minimal payload to only the space's subscriptions", async () => {
    const seen: { endpoint: string; payload: unknown }[] = [];
    const sender = vi.fn(async (target: { endpoint: string }, payloadJson: string) => {
      seen.push({ endpoint: target.endpoint, payload: JSON.parse(payloadJson) });
    });
    const res = await sendPushToSpace(handle, "s1", { title: "⏰ Soumaya reminder", body: "hi", url: "/" }, { config: CONFIG, sender });
    expect(res).toEqual({ skipped: false, sent: 2, pruned: 0, failed: 0 });
    expect(seen.map((s) => s.endpoint).sort()).toEqual(["https://push.example.com/a", "https://push.example.com/b"]);
    expect(seen[0]!.payload).toEqual({ title: "⏰ Soumaya reminder", body: "hi", url: "/" });
  });

  it("prunes subscriptions on 410 and 404, keeps them on other failures", async () => {
    const sender = vi.fn(async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith("/a")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      throw Object.assign(new Error("boom"), { statusCode: 500 });
    });
    const res = await sendPushToSpace(handle, "s1", { title: "t", body: "b" }, { config: CONFIG, sender });
    expect(res).toEqual({ skipped: false, sent: 0, pruned: 1, failed: 1 });
    const remaining = new PushSubscriptionsRepo(handle, "s1").listForSpace();
    expect(remaining.map((r) => r.endpoint)).toEqual(["https://push.example.com/b"]); // 500 kept, 410 pruned

    const sender404 = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    });
    const res2 = await sendPushToSpace(handle, "s1", { title: "t", body: "b" }, { config: CONFIG, sender: sender404 });
    expect(res2.pruned).toBe(1);
    expect(new PushSubscriptionsRepo(handle, "s1").listForSpace()).toHaveLength(0);
  });

  it("never throws even when every send fails without a status code", async () => {
    const sender = vi.fn(async () => {
      throw new Error("network down");
    });
    const res = await sendPushToSpace(handle, "s1", { title: "t", body: "b" }, { config: CONFIG, sender });
    expect(res.failed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("push routes", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    clearVapidEnv();
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
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "pushtester", passcode: "secret123", name: "pushtester" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });

  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function req(method: string, path: string, body?: unknown, withSpace = true): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(withSpace ? { "x-space-id": spaceId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  const goodSub = {
    endpoint: "https://push.example.com/route-sub",
    keys: { p256dh: "pk", auth: "au" },
    expirationTime: null,
  };

  it("requires a valid space (401 without x-space-id)", async () => {
    const { status } = await req("GET", "/api/push/config", undefined, false);
    expect(status).toBe(401);
  });

  it("config reports disabled with a null key when VAPID is unconfigured", async () => {
    clearVapidEnv();
    const { status, body } = await req("GET", "/api/push/config");
    expect(status).toBe(200);
    expect(body).toEqual({ enabled: false, vapidPublicKey: null });
  });

  it("subscribe REFUSES when unconfigured and stores nothing", async () => {
    clearVapidEnv();
    const { status, body } = await req("POST", "/api/push/subscribe", goodSub);
    expect(status).toBe(503);
    expect(body.error).toMatch(/not configured/i);
    const n = ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).get() as { n: number };
    expect(n.n).toBe(0); // never half-store
  });

  it("config reports enabled + the public key when configured", async () => {
    setVapidEnv();
    const { status, body } = await req("GET", "/api/push/config");
    expect(status).toBe(200);
    expect(body).toEqual({ enabled: true, vapidPublicKey: VAPID_ENV.VAPID_PUBLIC_KEY });
  });

  it("subscribe stores the subscription when configured; unsubscribe removes it", async () => {
    setVapidEnv();
    const sub = await req("POST", "/api/push/subscribe", goodSub);
    expect(sub.status).toBe(201);
    expect(sub.body.ok).toBe(true);
    const rows = new PushSubscriptionsRepo(ctx.handle, spaceId).listForSpace();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endpoint).toBe(goodSub.endpoint);
    expect(rows[0]!.p256dh).toBe("pk");

    const un = await req("POST", "/api/push/unsubscribe", { endpoint: goodSub.endpoint });
    expect(un.status).toBe(200);
    expect(un.body).toEqual({ ok: true, removed: true });
    expect(new PushSubscriptionsRepo(ctx.handle, spaceId).listForSpace()).toHaveLength(0);
  });

  it("rejects malformed subscribe bodies with 400", async () => {
    setVapidEnv();
    expect((await req("POST", "/api/push/subscribe", { endpoint: "not-a-url", keys: { p256dh: "x", auth: "y" } })).status).toBe(400);
    expect((await req("POST", "/api/push/subscribe", { endpoint: "https://push.example.com/x" })).status).toBe(400);
    expect((await req("POST", "/api/push/subscribe", { endpoint: "https://push.example.com/x", keys: { p256dh: "", auth: "y" } })).status).toBe(400);
    expect(new PushSubscriptionsRepo(ctx.handle, spaceId).listForSpace()).toHaveLength(0);
  });

  it("DELETE unsubscribe works too", async () => {
    setVapidEnv();
    await req("POST", "/api/push/subscribe", goodSub);
    const un = await req("DELETE", "/api/push/unsubscribe", { endpoint: goodSub.endpoint });
    expect(un.status).toBe(200);
    expect(un.body.removed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reminder firing path -> web push dispatch (web-push transport mocked)
// ---------------------------------------------------------------------------

describe("reminder firing dispatches web push", () => {
  let handle: DbHandle;
  const SPACE = "push-space";

  beforeEach(() => {
    handle = createDb(":memory:");
    mockSendNotification.mockClear();
    mockSetVapidDetails.mockClear();
  });
  afterEach(() => handle.sqlite.close());

  function insertReminder(label: string, remindAtIso: string): number {
    const info = handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, remind_at) VALUES (?, ?, 'event', 'ctx', ?)`)
      .run(SPACE, label, remindAtIso);
    return Number(info.lastInsertRowid);
  }

  function toolCtx(now: number): ToolContext {
    return {
      ctx: { handle } as unknown as AppContext,
      spaceId: SPACE,
      now,
      notify: async () => {},
    };
  }

  it("a due reminder sends exactly one push per subscription when configured", async () => {
    setVapidEnv();
    new PushSubscriptionsRepo(handle, SPACE).upsert({ endpoint: "https://push.example.com/due", p256dh: "pk", auth: "au" });
    const now = Date.now();
    const id = insertReminder("Call the dentist", new Date(now - 5 * 60_000).toISOString());
    const res = await reminderTool.run(toolCtx(now), { nodeId: id });
    expect(res.ok).toBe(true);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const [target, payloadJson] = mockSendNotification.mock.calls[0]! as unknown as [{ endpoint: string }, string];
    expect(target.endpoint).toBe("https://push.example.com/due");
    const payload = JSON.parse(payloadJson) as { title: string; body: string; url: string };
    expect(payload.title).toContain("reminder");
    expect(payload.body).toContain("Call the dentist");
    expect(payload.url).toBe("/");
    expect(mockSetVapidDetails).toHaveBeenCalledWith(VAPID_ENV.VAPID_SUBJECT, VAPID_ENV.VAPID_PUBLIC_KEY, VAPID_ENV.VAPID_PRIVATE_KEY);
  });

  it("a due reminder sends NO push when VAPID is unconfigured (zero behavior change)", async () => {
    clearVapidEnv();
    new PushSubscriptionsRepo(handle, SPACE).upsert({ endpoint: "https://push.example.com/due", p256dh: "pk", auth: "au" });
    const now = Date.now();
    const id = insertReminder("Water the plants", new Date(now - 5 * 60_000).toISOString());
    const res = await reminderTool.run(toolCtx(now), { nodeId: id });
    expect(res.ok).toBe(true); // reminder still fires + is claimed exactly as before
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("a stale (retired) reminder sends no push", async () => {
    setVapidEnv();
    new PushSubscriptionsRepo(handle, SPACE).upsert({ endpoint: "https://push.example.com/due", p256dh: "pk", auth: "au" });
    const now = Date.now();
    const id = insertReminder("Ancient task", new Date(now - 4 * 24 * 3600_000).toISOString());
    const res = await reminderTool.run(toolCtx(now), { nodeId: id });
    expect(res.ok).toBe(true);
    expect(res.summary).toMatch(/retired stale/);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
