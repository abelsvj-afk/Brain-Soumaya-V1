import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { SpacesRepo } from "../auth/spaces.js";
import { handleTelegramUpdate, type TelegramUpdate } from "../telegram/bot.js";

/**
 * Audit-2 item 4 — error-path hardening (falsification suite).
 *
 * The four space-route catches and the Telegram /link catch used to return
 * `(err as Error).message` indiscriminately. Today SpacesRepo's throws are
 * curated, but an UNEXPECTED failure inside them (SQLite locked, constraint
 * / missing-table, runtime) would have leaked its raw message.
 *
 * Contract pinned here:
 *  - curated (UserFacingError) throws keep flowing EXACTLY as before —
 *    same message, same per-catch status (auth 400, profile 409,
 *    passcode 400, delete 400, /link verbatim reply);
 *  - unexpected throws are logged server-side with raw detail and answered
 *    sanitized: HTTP 500 { error: "Internal error" } (the centralized
 *    handler's shape), Telegram with a clean generic sentence — the raw
 *    exception text appears NOWHERE in the response / chat text.
 */

const RAW = "database is locked — RAWDIAGNOSTIC";
const OWNER_TAG = "hardeningOwner";
const OWNER_PASS = "owner-pass-123";

let ctx: AppContext;
let server: Server;
let base: string;
let idOwner: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(
  method: string,
  path: string,
  opts: { spaceId?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.spaceId) headers["x-space-id"] = opts.spaceId;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function stubThrow(method: "authOrCreate" | "updateProfile" | "changePasscode" | "deleteSpace") {
  vi.spyOn(SpacesRepo.prototype, method).mockImplementation(() => {
    throw new Error(RAW);
  });
}

function expectSanitizedHttp(r: { status: number; body: any }) {
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ error: "Internal error" });
  expect(JSON.stringify(r.body)).not.toContain("RAWDIAGNOSTIC");
  expect(JSON.stringify(r.body)).not.toContain("database is locked");
}

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT_MAX = "1000";
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

  // Seed brains directly via the repo (bypasses the HTTP auth rate limiter).
  const repo = new SpacesRepo(ctx.handle);
  idOwner = repo.authOrCreate(OWNER_TAG, OWNER_PASS)!.space.id;
  repo.authOrCreate("hardeningOther", "other-pass-123");
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

describe("space routes — unexpected throws are sanitized (500, no raw text)", () => {
  it("POST /api/space/auth: stubbed authOrCreate raw throw → 500 Internal error, logged raw server-side", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubThrow("authOrCreate");
    const r = await call("POST", "/api/space/auth", {
      body: { gamerTag: "whateverTag", passcode: "whatever123" },
    });
    expectSanitizedHttp(r);
    expect(log.mock.calls.flat().map((a) => (a instanceof Error ? a.message : String(a))).join(" ")).toContain("RAWDIAGNOSTIC");
  });

  it("PATCH /api/space/profile: stubbed updateProfile raw throw → 500 (not the curated 409)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubThrow("updateProfile");
    const r = await call("PATCH", "/api/space/profile", {
      spaceId: idOwner,
      body: { name: "New Name" },
    });
    expectSanitizedHttp(r);
  });

  it("POST /api/space/passcode: stubbed changePasscode raw throw → 500 (not the curated 400)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubThrow("changePasscode");
    const r = await call("POST", "/api/space/passcode", {
      spaceId: idOwner,
      body: { currentPasscode: OWNER_PASS, newPasscode: "brand-new-pass" },
    });
    expectSanitizedHttp(r);
  });

  it("DELETE /api/space: stubbed deleteSpace raw throw → 500 (not the curated 400)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubThrow("deleteSpace");
    const r = await call("DELETE", "/api/space", {
      spaceId: idOwner,
      body: { passcode: OWNER_PASS, confirmation: OWNER_TAG },
    });
    expectSanitizedHttp(r);
  });
});

describe("space routes — curated throws keep their exact message + original status", () => {
  it("POST /api/space/auth: short passcode for a new brain → 400 curated", async () => {
    const r = await call("POST", "/api/space/auth", {
      body: { gamerTag: "brandNewTag", passcode: "short" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Passcode must be at least 8 characters for a new brain.");
  });

  it("PATCH /api/space/profile: reserved gamer tag → 409 curated", async () => {
    const r = await call("PATCH", "/api/space/profile", {
      spaceId: idOwner,
      body: { gamerTag: "soumaya" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("The gamer tag 'Soumaya' is reserved.");
  });

  it("POST /api/space/passcode: too-short new passcode → 400 curated", async () => {
    const r = await call("POST", "/api/space/passcode", {
      spaceId: idOwner,
      body: { currentPasscode: OWNER_PASS, newPasscode: "short" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("New passcode must be at least 8 characters.");
  });

  it("DELETE /api/space: wrong confirmation → 400 curated, nothing deleted", async () => {
    const r = await call("DELETE", "/api/space", {
      spaceId: idOwner,
      body: { passcode: OWNER_PASS, confirmation: "WRONG" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Confirmation does not match this brain's gamer tag — nothing was deleted.");
    expect((await call("GET", "/api/space/me", { spaceId: idOwner })).status).toBe(200);
  });
});

describe("telegram /link — unexpected throw is sanitized, curated still verbatim", () => {
  function harness() {
    const outbox: { chatId: number; text: string }[] = [];
    const send = async (chatId: number, text: string) => {
      outbox.push({ chatId, text });
    };
    const update = (chatId: number, text: string): TelegramUpdate => ({
      message: { chat: { id: chatId }, text },
    });
    return { outbox, send, update };
  }

  it("stubbed authOrCreate raw throw → generic sentence, no raw text, logged raw server-side", async () => {
    const { outbox, send, update } = harness();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubThrow("authOrCreate");
    await handleTelegramUpdate(ctx, update(9002, "/link someTag somepass123"), send);
    const text = outbox.at(-1)!.text;
    expect(text).toBe("Something went wrong linking that brain — please try again.");
    expect(text).not.toContain("RAWDIAGNOSTIC");
    expect(text).not.toContain("database is locked");
    expect(log.mock.calls.flat().map((a) => (a instanceof Error ? a.message : String(a))).join(" ")).toContain("RAWDIAGNOSTIC");
  });

  it("curated short-passcode throw → verbatim curated message", async () => {
    const { outbox, send, update } = harness();
    await handleTelegramUpdate(ctx, update(9001, "/link tgNewBrain short"), send);
    expect(outbox.at(-1)!.text).toBe("Passcode must be at least 8 characters for a new brain.");
  });
});
