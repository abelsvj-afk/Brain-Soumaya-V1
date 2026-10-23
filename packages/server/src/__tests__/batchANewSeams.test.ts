import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import {
  AmbiguousSendError,
  NoRecipientsError,
} from "../agent/notify/sendErrors.js";
import {
  createPolicyNotify,
  sweepNotifications,
  type BoundaryDeps,
} from "../agent/notify/boundary.js";
import { enqueue, getRow } from "../agent/notify/outbox.js";
import { countActiveClaims } from "../agent/notify/capClaims.js";
import { createTelegramSpaceSender, tgSend } from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { reminderTool } from "../agent/tools/reminder.js";
import type { ToolContext } from "../agent/tools/types.js";

/**
 * Batch A — NEW-seam unit tests (RE-01 classification, RE-02 zero
 * recipients). These import the seams the fix introduces
 * (agent/notify/sendErrors.ts, createTelegramSpaceSender), so on the
 * base this file fails at import — recorded as the fail-before for the
 * new seam; the behavioural fail-before pairs live in
 * batchAAutomationSafety.test.ts.
 */

let handle: DbHandle;
let ctx: AppContext;

const MIDDAY = new Date("2026-10-19T15:00:00Z"); // 11:00 EDT
const DAY = "2026-10-19";

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: new UsageTracker(handle),
  };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});
afterEach(() => {
  vi.unstubAllGlobals();
  handle.sqlite.close();
});

function fetchOk() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: {} }),
  }));
}
function fetchRefused(status = 403) {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({ ok: false, description: "Forbidden" }),
  }));
}
function fetchNetworkDown() {
  return vi.fn(async () => {
    throw new Error("fetch failed: network unreachable");
  });
}

// ---------------------------------------------------------------------------
// RE-01 classification at the sender: response-received = definite,
// no-response = ambiguous
// ---------------------------------------------------------------------------

describe("RE-01 tgSend classification", () => {
  it("network failure (no response) throws AmbiguousSendError", async () => {
    vi.stubGlobal("fetch", fetchNetworkDown());
    const err = await tgSend("TOKEN", 42, "hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmbiguousSendError);
  });

  it("HTTP refusal (response received) throws a definite error, NOT ambiguous", async () => {
    vi.stubGlobal("fetch", fetchRefused(403));
    const err = await tgSend("TOKEN", 42, "hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AmbiguousSendError);
    expect((err as Error).message).toMatch(/403/);
  });
});

// ---------------------------------------------------------------------------
// RE-02(a) — the production raw sender (index.ts seam): zero recipients
// ---------------------------------------------------------------------------

describe("RE-02 createTelegramSpaceSender", () => {
  it("zero linked chats → NoRecipientsError, no fetch attempted", async () => {
    const fetchSpy = fetchOk();
    vi.stubGlobal("fetch", fetchSpy);
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    const err = await rawSend("no-such-space", "hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoRecipientsError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("one linked chat, Telegram accepts → resolves", async () => {
    new TelegramLinksRepo(handle).link(71, "sp-a", "Brain A");
    vi.stubGlobal("fetch", fetchOk());
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    await expect(rawSend("sp-a", "hello")).resolves.toBeUndefined();
  });

  it("one linked chat, Telegram refuses → definite throw", async () => {
    new TelegramLinksRepo(handle).link(72, "sp-a", "Brain A");
    vi.stubGlobal("fetch", fetchRefused(403));
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    const err = await rawSend("sp-a", "hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AmbiguousSendError);
    expect(err).not.toBeInstanceOf(NoRecipientsError);
  });

  it("one linked chat, network down → AmbiguousSendError", async () => {
    new TelegramLinksRepo(handle).link(73, "sp-a", "Brain A");
    vi.stubGlobal("fetch", fetchNetworkDown());
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    const err = await rawSend("sp-a", "hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmbiguousSendError);
  });

  it("two linked chats: every chat is attempted even when one refuses; definite wins", async () => {
    new TelegramLinksRepo(handle).link(74, "sp-a", "Brain A");
    new TelegramLinksRepo(handle).link(75, "sp-a", "Brain A");
    const fetchSpy = vi.fn(async (url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { chat_id?: number };
      if (body.chat_id === 74) {
        return { ok: false, status: 403, json: async () => ({ ok: false, description: "blocked" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    });
    vi.stubGlobal("fetch", fetchSpy);
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    const err = await rawSend("sp-a", "hello").catch((e: unknown) => e);
    expect(fetchSpy.mock.calls.length).toBe(2); // both attempted
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AmbiguousSendError);
  });
});

// ---------------------------------------------------------------------------
// RE-01 / RE-02 at the boundary: outcome classification drives the ledger
// ---------------------------------------------------------------------------

function depsWith(send: BoundaryDeps["send"]): BoundaryDeps {
  return { sqlite: handle.sqlite, handle, send, audit: () => {}, workerId: "batch-a-seams" };
}

function enqueueCheckin(spaceId: string): number {
  const { id } = enqueue(handle.sqlite, {
    spaceId,
    meta: { tool: "checkin", occurrenceId: `day:${DAY}` },
    message: "morning checkin",
    urgency: { isUrgent: false },
    deliverAfter: new Date(MIDDAY.getTime() - 60_000).toISOString(),
    queueReason: "test",
  });
  return id;
}

function claimState(spaceId: string): string | undefined {
  const rows = handle.sqlite
    .prepare(`SELECT state FROM notification_cap_claims WHERE space_id = ?`)
    .all(spaceId) as { state: string }[];
  return rows[0]?.state;
}

describe("boundary outcome classification", () => {
  it("AmbiguousSendError → row ambiguous, claim retained as ambiguous, never resent", async () => {
    const send = vi.fn(async () => {
      throw new AmbiguousSendError("no response from Telegram");
    });
    const id = enqueueCheckin("sp-amb");
    await sweepNotifications(depsWith(send), MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("ambiguous");
    expect(claimState("sp-amb")).toBe("ambiguous");
    expect(countActiveClaims(handle.sqlite, "sp-amb", DAY)).toBe(1);
    await sweepNotifications(depsWith(send), new Date(MIDDAY.getTime() + 3600_000));
    expect(send.mock.calls.length).toBe(1);
  });

  it("NoRecipientsError → row dropped, claim released (never sent, no slot kept)", async () => {
    const send = vi.fn(async () => {
      throw new NoRecipientsError("no linked chats");
    });
    const id = enqueueCheckin("sp-none");
    await sweepNotifications(depsWith(send), MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("dropped");
    expect(claimState("sp-none")).toBe("released");
    expect(countActiveClaims(handle.sqlite, "sp-none", DAY)).toBe(0);
  });

  it("plain definite error → existing retry path (queued, attempts+1, claim released)", async () => {
    const send = vi.fn(async () => {
      throw new Error("Telegram send failed: HTTP 500");
    });
    const id = enqueueCheckin("sp-def");
    await sweepNotifications(depsWith(send), MIDDAY);
    const row = getRow(handle.sqlite, id)!;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(claimState("sp-def")).toBe("released");
  });

  it("createPolicyNotify surfaces NoRecipientsError to its caller after recording the drop", async () => {
    // Keep the immediate path out of quiet hours regardless of wall clock:
    // a 1-hour quiet window six hours from the current UTC hour.
    const nowH = new Date().getUTCHours();
    const qs = String((nowH + 6) % 24).padStart(2, "0") + ":00";
    const qe = String((nowH + 7) % 24).padStart(2, "0") + ":00";
    handle.sqlite
      .prepare(
        `INSERT INTO space_meta (space_id, timezone, quiet_start, quiet_end, digest_time, daily_proactive_cap)
         VALUES ('sp-imm', 'UTC', ?, ?, '06:00', 5)`,
      )
      .run(qs, qe);
    const notify = createPolicyNotify(
      depsWith(async () => {
        throw new NoRecipientsError("no linked chats");
      }),
    );
    const err = await notify("sp-imm", "hello", { tool: "checkin" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoRecipientsError);
    const rows = handle.sqlite
      .prepare(`SELECT status FROM notification_outbox WHERE space_id = 'sp-imm'`)
      .all() as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("dropped");
  });
});

// ---------------------------------------------------------------------------
// RE-02(b) — reminder whose notify reports zero recipients defers
// ---------------------------------------------------------------------------

describe("RE-02 reminder defer on NoRecipientsError", () => {
  const NOW = Date.parse("2026-01-10T12:00:00Z");

  function makeReminder(spaceId: string, label: string): number {
    const info = handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, remind_at) VALUES (?, ?, 'knowledge', ?, ?)`)
      .run(spaceId, label, label, new Date(NOW - 30_000).toISOString());
    return Number(info.lastInsertRowid);
  }
  const firedAt = (id: number) =>
    (
      handle.sqlite.prepare(`SELECT reminder_fired_at AS f FROM nodes WHERE id = ?`).get(id) as {
        f: string | null;
      }
    ).f;

  it("notify throws NoRecipientsError and push is unconfigured → deferred, still detectable", async () => {
    const id = makeReminder("sp-rem", "Water the plants");
    const tc: ToolContext = {
      ctx,
      spaceId: "sp-rem",
      now: NOW,
      notify: async () => {
        throw new NoRecipientsError("no linked chats");
      },
    };
    const res = await reminderTool.run(tc, { nodeId: id });
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(false);
    expect(res.summary).toMatch(/deferred/i);
    expect(firedAt(id)).toBeNull();
    // Still deliverable later: detect proposes it again.
    expect(reminderTool.detect(tc).some((i) => i.args.nodeId === id)).toBe(true);
  });

  it("the same reminder fires normally once notify reaches a channel", async () => {
    const id = makeReminder("sp-rem", "Water the plants");
    const bad: ToolContext = {
      ctx,
      spaceId: "sp-rem",
      now: NOW,
      notify: async () => {
        throw new NoRecipientsError("no linked chats");
      },
    };
    await reminderTool.run(bad, { nodeId: id });
    expect(firedAt(id)).toBeNull();

    const sent: string[] = [];
    const good: ToolContext = {
      ctx,
      spaceId: "sp-rem",
      now: NOW + 60_000,
      notify: async (t) => void sent.push(t),
    };
    const res = await reminderTool.run(good, { nodeId: id });
    expect(res.delivered).toBe(true);
    expect(sent.some((t) => t.includes("Water the plants"))).toBe(true);
    expect(firedAt(id)).not.toBeNull();
  });
});
