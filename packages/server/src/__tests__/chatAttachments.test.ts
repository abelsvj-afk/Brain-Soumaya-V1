import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { chat } from "../chat/graphrag.js";
import { buildAnswerPrompt } from "../llm/prompts.js";
import type { LlmProvider, AnswerOptions } from "../llm/adapter.js";

/**
 * IM-106: in-chat attachments. The user attaches a file to ONE chat message;
 * its extracted text must reach the model as clearly-labelled one-turn
 * context — and must not exist anywhere when no attachment is sent (every
 * pre-existing caller, incl. Telegram and the agent loop, passes none).
 */

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

describe("buildAnswerPrompt — attachment section", () => {
  it("renders the attachment text under its own labelled section", () => {
    const prompt = buildAnswerPrompt(
      "summarize this",
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      "[notes.txt]\nTHE ATTACHED BODY",
    );
    expect(prompt).toContain("ATTACHED TO THIS MESSAGE");
    expect(prompt).toContain("[notes.txt]");
    expect(prompt).toContain("THE ATTACHED BODY");
  });

  it("omits the section entirely when no attachment is passed", () => {
    const prompt = buildAnswerPrompt("hello", [], undefined, undefined, undefined, undefined, undefined);
    expect(prompt).not.toContain("ATTACHED TO THIS MESSAGE");
  });
});

describe("chat() — attachment plumbing", () => {
  it("passes the formatted attachment text into llm.answer's opts", async () => {
    const base = new HeuristicProvider();
    let seenOpts: AnswerOptions | undefined;
    const spy: LlmProvider = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      answer: async (q: string, c: never, opts?: AnswerOptions) => {
        seenOpts = opts;
        return base.answer(q, c, opts);
      },
    }) as LlmProvider;

    const res = await chat(
      handle,
      { embeddings, llm: spy },
      "what does the attached file say?",
      undefined,
      undefined,
      [],
      null,
      null,
      [{ name: "lease.txt", text: "The rent is due on the first." }],
    );
    expect(res.answer.length).toBeGreaterThanOrEqual(0);
    expect(seenOpts?.attachments).toContain("[lease.txt]");
    expect(seenOpts?.attachments).toContain("The rent is due on the first.");
  });

  it("sends attachments: undefined when the caller attaches nothing (prior behaviour)", async () => {
    const base = new HeuristicProvider();
    let seenOpts: AnswerOptions | undefined;
    const spy: LlmProvider = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      answer: async (q: string, c: never, opts?: AnswerOptions) => {
        seenOpts = opts;
        return base.answer(q, c, opts);
      },
    }) as LlmProvider;

    await chat(handle, { embeddings, llm: spy }, "anything?");
    expect(seenOpts?.attachments).toBeUndefined();
  });
});
