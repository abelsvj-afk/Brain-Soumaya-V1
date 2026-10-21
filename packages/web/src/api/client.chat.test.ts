import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { askChat } from "./client.js";
import { ChatRequestError } from "./chatSend.js";

/**
 * Finding 1: askChat is the ONE send path (fresh sends and ChatDock retries
 * alike). It must (a) put a contract-valid body on the wire no matter what
 * it was handed, and (b) never let the server's raw error string escape —
 * failures surface as plain-language ChatRequestErrors mapped from status.
 */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

let lastBody: Record<string, unknown> | null;
let responder: () => Promise<Response>;

beforeEach(() => {
  lastBody = null;
  responder = async () => jsonResponse({ answer: "ok", citations: [], contextIds: [] });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    lastBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return responder();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("askChat — sanitized wire body", () => {
  it("truncates history entry text to 4000 and the question to 2000 on the wire", async () => {
    await askChat("q".repeat(2500), [{ role: "soumaya", text: "x".repeat(5000) }]);
    expect(String(lastBody!.question)).toHaveLength(2000);
    const history = lastBody!.history as { text: string }[];
    expect(history[0]!.text).toHaveLength(4000);
  });

  it("drops an empty-text attachment and caps the attachment name at 200", async () => {
    await askChat("hi", [], undefined, undefined, [
      { name: "scan.pdf", text: "" },
      { name: "n".repeat(300), text: "real text" },
    ]);
    const atts = lastBody!.attachments as { name: string; text: string }[];
    expect(atts).toHaveLength(1);
    expect(atts[0]!.name).toHaveLength(200);
    expect(atts[0]!.text).toBe("real text");
  });

  it("omits the attachments field entirely when none survive sanitizing", async () => {
    await askChat("hi", [], undefined, undefined, [{ name: "scan.pdf", text: "" }]);
    expect("attachments" in lastBody!).toBe(false);
  });
});

describe("askChat — raw server text never escapes", () => {
  it("a 400 whose body carries the old raw contract string throws plain language instead", async () => {
    responder = async () => jsonResponse({ error: "Body must be { question: string }" }, false, 400);
    const err = await askChat("hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatRequestError);
    expect((err as Error).message).toContain("couldn't be sent as-is");
    expect((err as Error).message).not.toContain("Body must be");
  });

  it("a 500 with a stack-flavoured server string throws the generic server-problem copy", async () => {
    responder = async () => jsonResponse({ error: "SqliteError: no such table: nodes at chat (graphrag.ts:85)" }, false, 500);
    const err = await askChat("hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatRequestError);
    expect((err as Error).message).toContain("server hit a problem");
    expect((err as Error).message).not.toContain("SqliteError");
    expect((err as Error).message).not.toContain("graphrag");
  });
});
