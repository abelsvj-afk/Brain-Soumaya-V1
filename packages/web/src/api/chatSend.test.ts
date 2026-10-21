import { describe, it, expect } from "vitest";
import {
  CHAT_ATTACHMENT_MAX,
  CHAT_ATTACHMENT_NAME_MAX,
  CHAT_ATTACHMENT_TEXT_MAX,
  CHAT_HISTORY_ENTRY_MAX,
  CHAT_HISTORY_MAX_ENTRIES,
  CHAT_QUESTION_MAX,
  CHAT_TIMEOUT_MS,
  chatErrorForStatus,
  sanitizeChatPayload,
} from "./chatSend.js";

/**
 * Finding 1: the client sanitizes every outbound chat payload to the server
 * contract (routes/chat.ts ChatBody) BEFORE sending — the three payload
 * shapes that used to produce 400s become unreachable from this client.
 */
describe("sanitizeChatPayload — mirrors the server ChatBody contract", () => {
  it("passes a well-formed payload through unchanged", () => {
    const out = sanitizeChatPayload({
      question: "hello?",
      history: [{ role: "you", text: "hi" }],
      attachments: [{ name: "a.txt", text: "body" }],
    });
    expect(out).toEqual({
      question: "hello?",
      history: [{ role: "you", text: "hi" }],
      attachments: [{ name: "a.txt", text: "body" }],
    });
  });

  it("truncates an over-long history entry's TEXT to 4000 instead of dropping the entry", () => {
    const long = "x".repeat(CHAT_HISTORY_ENTRY_MAX + 500);
    const out = sanitizeChatPayload({ question: "q", history: [{ role: "soumaya", text: long }] });
    expect(out.history).toHaveLength(1);
    expect(out.history[0]!.text).toHaveLength(CHAT_HISTORY_ENTRY_MAX);
  });

  it("keeps only the last 16 history entries", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: "you" as const, text: `turn ${i}` }));
    const out = sanitizeChatPayload({ question: "q", history });
    expect(out.history).toHaveLength(CHAT_HISTORY_MAX_ENTRIES);
    expect(out.history[0]!.text).toBe("turn 4");
    expect(out.history.at(-1)!.text).toBe("turn 19");
  });

  it("caps the question at 2000 chars", () => {
    const out = sanitizeChatPayload({ question: "q".repeat(CHAT_QUESTION_MAX + 100) });
    expect(out.question).toHaveLength(CHAT_QUESTION_MAX);
  });

  it("caps attachment count, name and text to the contract", () => {
    const atts = Array.from({ length: 5 }, (_, i) => ({
      name: `file-${i}-${"n".repeat(300)}`,
      text: "t".repeat(CHAT_ATTACHMENT_TEXT_MAX + 10),
    }));
    const out = sanitizeChatPayload({ question: "q", attachments: atts });
    expect(out.attachments).toHaveLength(CHAT_ATTACHMENT_MAX);
    for (const a of out.attachments) {
      expect(a.name.length).toBeLessThanOrEqual(CHAT_ATTACHMENT_NAME_MAX);
      expect(a.text.length).toBeLessThanOrEqual(CHAT_ATTACHMENT_TEXT_MAX);
    }
  });

  it("excludes an empty-text attachment (the server requires text ≥ 1 char)", () => {
    const out = sanitizeChatPayload({
      question: "q",
      attachments: [
        { name: "scan.pdf", text: "" },
        { name: "blank.txt", text: "   " },
        { name: "real.txt", text: "content" },
      ],
    });
    expect(out.attachments).toEqual([{ name: "real.txt", text: "content" }]);
  });

  it("is idempotent — a retry through the same path produces the identical corrected body", () => {
    const raw = {
      question: "q".repeat(3000),
      history: [{ role: "you" as const, text: "x".repeat(5000) }],
      attachments: [{ name: "n".repeat(300), text: "body" }],
    };
    expect(sanitizeChatPayload(sanitizeChatPayload(raw))).toEqual(sanitizeChatPayload(raw));
  });
});

describe("chatErrorForStatus — plain language only, never a server string", () => {
  it("maps 400 to shorten/remove-attachment copy", () => {
    const e = chatErrorForStatus(400);
    expect(e.message).toContain("couldn't be sent as-is");
    expect(e.message).not.toContain("Body must be");
    expect(e.status).toBe(400);
  });

  it("maps 500 to a server-problem line and 429 to a wait line", () => {
    expect(chatErrorForStatus(500).message).toContain("server hit a problem");
    expect(chatErrorForStatus(429).message).toContain("give it a moment");
  });
});

describe("CHAT_TIMEOUT_MS — aligned to the server turn deadline (Finding 8)", () => {
  it("is 15s: the 9s server deadline plus network slack, far under the old 60s", () => {
    expect(CHAT_TIMEOUT_MS).toBe(15_000);
    expect(CHAT_TIMEOUT_MS).toBeGreaterThan(9_000);
    expect(CHAT_TIMEOUT_MS).toBeLessThan(60_000);
  });
});
