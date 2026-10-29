import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi, onTestFinished } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { UsageTracker } from "../usage.js";
import { NotificationsRepo, NOTIFICATION_CAP } from "../repositories/notifications.repo.js";
import { InsightsRepo } from "../repositories/insights.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { CodexDiscoveriesRepo } from "../repositories/codexDiscoveries.repo.js";
import { billRiskTool } from "../agent/tools/billRisk.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { handleTelegramUpdate, sendDailyDigests } from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";

/**
 * IM-74 — the server-backed Inbox: store, routes, and the away-event producers.
 * Retention (Q7 interim default): items persist until the user clears them;
 * only the oldest past NOTIFICATION_CAP are dropped.
 */

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

describe("NotificationsRepo — the store", () => {
  it("records and lists newest-first, space-scoped", () => {
    const repo = new NotificationsRepo(handle, "s1");
    repo.record({ source: "insight", text: "first" });
    repo.record({ source: "digest", text: "second" });
    new NotificationsRepo(handle, "other").record({ source: "insight", text: "not yours" });

    const list = repo.list();
    expect(list.map((n) => n.text)).toEqual(["second", "first"]);
    expect(list[0]).toMatchObject({ source: "digest", seen: false, seenAt: null, priority: "normal" });
  });

  it("dedupes by dedupeKey — the same event recorded twice lands once", () => {
    const repo = new NotificationsRepo(handle, "s1");
    const a = repo.record({ source: "insight", text: "x", dedupeKey: "insight:7" });
    const b = repo.record({ source: "insight", text: "x", dedupeKey: "insight:7" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(repo.list()).toHaveLength(1);
    // The same key in a DIFFERENT space is a different event.
    expect(new NotificationsRepo(handle, "s2").record({ source: "insight", text: "x", dedupeKey: "insight:7" })).not.toBeNull();
  });

  it("retention: nothing is auto-deleted by age — seen items persist until cleared", () => {
    const repo = new NotificationsRepo(handle, "s1");
    const n = repo.record({ source: "digest", text: "old but kept" })!;
    // Backdate it far past any plausible auto-expiry: it must still be listed.
    handle.sqlite.prepare(`UPDATE inbox_notifications SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).run(n.id);
    expect(repo.markSeen(n.id, "2020-01-01T00:01:00.000Z")).toBe(true);
    expect(repo.list().map((x) => x.text)).toEqual(["old but kept"]);

    expect(repo.clearSeen()).toBe(1);
    expect(repo.list()).toEqual([]);
  });

  it("drops only the oldest past the cap", () => {
    const repo = new NotificationsRepo(handle, "s1");
    for (let i = 0; i < NOTIFICATION_CAP + 5; i++) repo.record({ source: "insight", text: `n${i}` });
    const list = repo.list(NOTIFICATION_CAP + 10);
    expect(list).toHaveLength(NOTIFICATION_CAP);
    expect(list[0]!.text).toBe(`n${NOTIFICATION_CAP + 4}`); // newest kept
    expect(list[list.length - 1]!.text).toBe("n5"); // n0..n4 dropped
  });

  it("markSeen / snooze / remove are space-scoped and report misses", () => {
    const mine = new NotificationsRepo(handle, "s1");
    const theirs = new NotificationsRepo(handle, "s2");
    const n = mine.record({ source: "insight", text: "mine" })!;

    expect(theirs.markSeen(n.id)).toBe(false);
    expect(theirs.remove(n.id)).toBe(false);
    expect(theirs.snooze(n.id, "2999-01-01T00:00:00.000Z")).toBe(false);

    expect(mine.snooze(n.id, "2999-01-01T00:00:00.000Z")).toBe(true);
    expect(mine.list()[0]!.snoozedUntil).toBe("2999-01-01T00:00:00.000Z");
    expect(mine.markSeen(n.id)).toBe(true);
    expect(mine.list()[0]!.seen).toBe(true);
    expect(mine.markSeen(n.id)).toBe(false); // already seen — no double-stamp
    expect(mine.remove(n.id)).toBe(true);
    expect(mine.list()).toEqual([]);
  });

  it("markAllSeen stamps only the unseen — and never an actively-snoozed item", () => {
    const repo = new NotificationsRepo(handle, "s1");
    repo.record({ source: "insight", text: "a" });
    const b = repo.record({ source: "insight", text: "b" })!;
    repo.markSeen(b.id);
    const snoozed = repo.record({ source: "insight", text: "later" })!;
    repo.snooze(snoozed.id, "2999-01-01T00:00:00.000Z");
    expect(repo.markAllSeen()).toBe(1);
    expect(repo.markAllSeen()).toBe(0);
    const byText = new Map(repo.list().map((n) => [n.text, n.seen]));
    expect(byText.get("a")).toBe(true);
    expect(byText.get("later")).toBe(false); // snooze survives a bulk mark-all
  });
});

describe("producers — real away-events land in the store", () => {
  it("insight created (synthesis + contradiction) → notification", () => {
    const nodes = new NodesRepo(handle, "s1");
    const emb = new Float32Array(EMBED_DIM);
    const a = nodes.create({ label: "A", type: "concept", content: "a" }, emb);
    const b = nodes.create({ label: "B", type: "concept", content: "b" }, emb);
    const repo = new InsightsRepo(handle, "s1");
    repo.create(a.id, b.id, "A connects to B", 0.9);
    repo.create(a.id, b.id, "A contradicts B", 0.8, "contradiction");

    const list = new NotificationsRepo(handle, "s1").list();
    expect(list).toHaveLength(2);
    const contra = list.find((n) => n.text === "A contradicts B")!;
    expect(contra).toMatchObject({ source: "insight", priority: "high", icon: "⚡" });
    const synth = list.find((n) => n.text === "A connects to B")!;
    expect(synth).toMatchObject({ source: "insight", priority: "normal" });
  });

  it("discovery charted → notification; re-charting the same key does not duplicate", () => {
    const repo = new CodexDiscoveriesRepo(handle, "s1");
    const d = { key: "hub:1", title: "Landmark: “X”", lore: "lore", icon: "🌌" };
    expect(repo.add(d)).toBe(true);
    expect(repo.add(d)).toBe(false);
    const list = new NotificationsRepo(handle, "s1").list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "discovery", text: "Landmark: “X”", icon: "🌌" });
  });

  it("bill-risk warning issued → high-priority notification carrying the warning text", async () => {
    const ctx = {
      handle,
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
      usage: new UsageTracker(handle),
    } as AppContext;
    new FinAccountRepo(handle, "s1").setBalance(10000);
    const bill = new FinBillRepo(handle, "s1").create({
      name: "Insurance",
      amountCents: 25000,
      frequency: "monthly",
      anchorDate: "2026-01-18",
    });
    let sent = "";
    const res = await billRiskTool.run(
      { ctx, spaceId: "s1", now: Date.parse("2026-01-10T00:00:00Z"), notify: async (t) => void (sent = t) },
      { billId: bill.id, mode: "short", threshold: 5000 },
    );
    expect(res.ok).toBe(true);
    expect(sent).not.toBe("");
    const list = new NotificationsRepo(handle, "s1").list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "bill-risk", priority: "high", text: sent });
  });

  it("daily digest delivered → digest notification, once per day", async () => {
    // The digest sends only once the space's local digest time (06:00 by
    // default) has passed; pin the clock to mid-afternoon so this tests
    // delivery, not the hour the suite happens to run at.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const ctx = {
      handle,
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
      usage: new UsageTracker(handle),
    } as AppContext;
    const sent: { chatId: number; text: string }[] = [];
    const send = async (chatId: number, text: string) => void sent.push({ chatId, text });
    await handleTelegramUpdate(ctx, { message: { chat: { id: 9 }, text: "/link alice alicepass" } }, send);
    const spaceId = new TelegramLinksRepo(handle).get(9)!.spaceId;

    expect(await sendDailyDigests(ctx, send)).toBe(1);
    expect(await sendDailyDigests(ctx, send)).toBe(0); // same day: no second digest

    const list = new NotificationsRepo(handle, spaceId).list();
    expect(list).toHaveLength(1);
    expect(list[0]!.source).toBe("digest");
  });
});

describe("routes — /api/notifications", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

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
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "inboxer", passcode: "secret123", name: "inboxer" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  const call = async (method: string, path: string, body?: unknown, space = spaceId) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-space-id": space },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("lists, marks seen, snoozes, deletes, and clears — all over HTTP", async () => {
    const repo = new NotificationsRepo(ctx.handle, spaceId);
    const a = repo.record({ source: "insight", text: "route-a" })!;
    const b = repo.record({ source: "digest", text: "route-b" })!;

    const listed = await call("GET", "/api/notifications");
    expect(listed.status).toBe(200);
    expect((listed.body as unknown as { text: string }[]).map((n) => n.text)).toEqual(["route-b", "route-a"]);

    expect((await call("POST", `/api/notifications/${a.id}/seen`)).status).toBe(200);
    expect((await call("POST", `/api/notifications/${a.id}/seen`)).status).toBe(404); // already seen

    const snoozed = await call("POST", `/api/notifications/${b.id}/snooze`, { until: "2999-01-01T00:00:00.000Z" });
    expect(snoozed.status).toBe(200);
    expect(repo.list().find((n) => n.id === b.id)!.snoozedUntil).toBe("2999-01-01T00:00:00.000Z");
    expect((await call("POST", `/api/notifications/${b.id}/snooze`, { until: "not-a-date" })).status).toBe(400);

    expect((await call("DELETE", `/api/notifications/${b.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/notifications/${b.id}`)).status).toBe(404);

    const cleared = await call("POST", "/api/notifications/clear-seen");
    expect(cleared.status).toBe(200);
    expect(cleared.body.cleared).toBe(1); // only the seen one
    expect(repo.list()).toEqual([]);
  });

  it("seen-all marks the rest; another space cannot touch these rows", async () => {
    const repo = new NotificationsRepo(ctx.handle, spaceId);
    const n = repo.record({ source: "insight", text: "route-c" })!;
    const out = await call("POST", "/api/notifications/seen-all");
    expect(out.body.marked).toBe(1);
    expect(repo.list()[0]!.seen).toBe(true);

    // A second REAL space (an unknown id is rejected by the auth guard, 401):
    // its list is empty and it cannot mark this space's row seen.
    const auth2 = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "outsider", passcode: "secret123", name: "outsider" }),
    });
    const otherId = ((await auth2.json()) as { id: string }).id;
    const other = await call("POST", `/api/notifications/${n.id}/seen`, undefined, otherId);
    expect(other.status).toBe(404);
    const otherList = await call("GET", "/api/notifications", undefined, otherId);
    expect(otherList.body).toEqual([]);
  });
});
