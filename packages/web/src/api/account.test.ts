import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { changePasscode, deleteBrain } from "./account.js";

/**
 * IM-129 client contract: the two account-security calls must hit the exact
 * server routes with the exact bodies (DELETE-with-body included), and must
 * THROW with the server's message on a refusal — a refused deletion must
 * never look like a successful one to the caller. fetch is stubbed.
 */

type Seen = { url: string; init?: RequestInit };
let seen: Seen[];
let responder: (call: Seen) => Response;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  seen = [];
  responder = () => jsonResponse({ ok: true, deleted: true });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call = { url, init };
    seen.push(call);
    return responder(call);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("changePasscode", () => {
  it("POSTs { currentPasscode, newPasscode } to /api/space/passcode", async () => {
    await changePasscode("old-pass-123", "new-pass-123");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/space/passcode");
    expect(seen[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({
      currentPasscode: "old-pass-123",
      newPasscode: "new-pass-123",
    });
  });

  it("throws the server's message on a 401 refusal", async () => {
    responder = () => jsonResponse({ error: "Current passcode is incorrect." }, false, 401);
    await expect(changePasscode("wrong", "new-pass-123")).rejects.toThrow("Current passcode is incorrect.");
  });
});

describe("deleteBrain", () => {
  it("sends DELETE to /api/space WITH the { passcode, confirmation } body", async () => {
    await deleteBrain("alpha-pass-123", "ownerAlpha");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/space");
    expect(seen[0]!.init?.method).toBe("DELETE");
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({
      passcode: "alpha-pass-123",
      confirmation: "ownerAlpha",
    });
  });

  it("throws the server's message on a 400 refusal (wrong confirmation)", async () => {
    responder = () =>
      jsonResponse({ error: "Confirmation does not match this brain's gamer tag — nothing was deleted." }, false, 400);
    await expect(deleteBrain("alpha-pass-123", "DELETE")).rejects.toThrow(/nothing was deleted/);
  });
});
