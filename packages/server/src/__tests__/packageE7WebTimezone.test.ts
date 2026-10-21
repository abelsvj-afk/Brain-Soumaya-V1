import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AnswerOptions, LlmProvider } from "../llm/adapter.js";
import { chat, DEFAULT_CHAT } from "../chat/graphrag.js";
import { composeSystem, formatNowUnavailableLine } from "../llm/prompts.js";
import { getPreferences, setPreference } from "../agent/notify/policy.js";

/**
 * Package E7 — the WEB chat path gets the agent loop's E2 timezone chain.
 *
 * Pre-fix, chat() read getPreferences() inside a try/catch that left the
 * zone undefined on ANY failure, and composeSystem then grounded the turn
 * in the UTC rendering — the same silent-UTC defect E2 fixed on Telegram,
 * on the web surface. Post-fix, chat() resolves through
 * resolveAgentTimezone (preferences → stored space_meta.timezone → the
 * sweep's shared resolver → null): a preferences failure falls through to
 * the STORED zone, and a genuinely unresolvable zone renders the explicit
 * "local time unavailable" grounding — never UTC. On the happy path the
 * resolved value is exactly getPreferences().timezone, so the composed
 * prompt is byte-identical to before (the parity golden fixture pins it).
 */

let handle: DbHandle;
const SPACE = "e7-space";
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  vi.restoreAllMocks();
  handle.sqlite.close();
});

/** A minimal cloud-shaped provider that captures the AnswerOptions chat()
 *  hands it, so the tests can assert the timezone chat() resolved and
 *  render the system prompt from those exact options via the real
 *  composeSystem — the same composition the cloud providers perform. */
function capturingLlm(): { llm: LlmProvider; captured: () => AnswerOptions | undefined } {
  let captured: AnswerOptions | undefined;
  const base = new HeuristicProvider();
  const answerImpl: LlmProvider["answer"] = async (_q, _c, opts) => {
    captured = opts;
    return { answer: "A full cloud answer.", citations: [] };
  };
  const llm = {
    ...Object.getPrototypeOf(base),
    available: true,
    model: "fake-cloud",
    extract: base.extract.bind(base),
    validateLink: base.validateLink.bind(base),
    synthesize: base.synthesize.bind(base),
    detectContradiction: base.detectContradiction.bind(base),
    interpretClarificationAnswer: base.interpretClarificationAnswer.bind(base),
    answer: answerImpl,
    research: base.research.bind(base),
    summarizeSector: base.summarizeSector.bind(base),
    generateDailyLog: base.generateDailyLog.bind(base),
  } as LlmProvider;
  return { llm, captured: () => captured };
}

/** A handle whose FULL preferences read throws (the exact getPreferences
 *  SELECT), while every other statement — incl. the single-column
 *  space_meta.timezone read — works against the real DB. The same failure
 *  injection E2 used for the agent loop. */
function prefsFailingHandle(): DbHandle {
  const real = handle.sqlite;
  const wrapped = new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (sql.startsWith("SELECT timezone, quiet_start")) throw new Error("injected preferences failure");
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { ...handle, sqlite: wrapped } as DbHandle;
}

describe("E7 — web chat happy path: the resolved zone is exactly the preferences zone", () => {
  it("passes the stored timezone through unchanged (byte-identical prompt inputs)", async () => {
    setPreference(handle.sqlite, SPACE, "timezone", "Pacific/Kiritimati");
    const { llm, captured } = capturingLlm();
    const res = await chat(handle, { embeddings, llm }, "what day is it for me?", DEFAULT_CHAT, SPACE);
    expect(res.answer).toBe("A full cloud answer.");
    const opts = captured()!;
    expect(opts.timezone).toBe("Pacific/Kiritimati");
    expect(opts.timezone).toBe(getPreferences(handle.sqlite, SPACE).timezone);
    const sys = composeSystem(opts);
    expect(sys).toContain("in the user's timezone (Pacific/Kiritimati)");
    expect(sys).not.toContain("time are unavailable");
  });

  it("an unset timezone resolves to the shared default, exactly as getPreferences reports it", async () => {
    const { llm, captured } = capturingLlm();
    await chat(handle, { embeddings, llm }, "hello there", DEFAULT_CHAT, SPACE);
    expect(captured()!.timezone).toBe(getPreferences(handle.sqlite, SPACE).timezone);
  });
});

describe("E7 — preferences failure still grounds web chat in the STORED local timezone", () => {
  it("falls through to space_meta.timezone when the preferences read throws", async () => {
    setPreference(handle.sqlite, SPACE, "timezone", "Pacific/Kiritimati");
    const { llm, captured } = capturingLlm();
    const res = await chat(prefsFailingHandle(), { embeddings, llm }, "what day is it for me?", DEFAULT_CHAT, SPACE);
    expect(res.answer).toBe("A full cloud answer.");
    const opts = captured()!;
    // Pre-fix this was undefined and the prompt grounded in UTC.
    expect(opts.timezone).toBe("Pacific/Kiritimati");
    const sys = composeSystem(opts);
    expect(sys).toContain("in the user's timezone (Pacific/Kiritimati)");
    expect(sys).not.toContain("time are unavailable");
  });
});

describe("E7 — no valid timezone resolvable: unavailable grounding, never UTC", () => {
  it("passes timezone:null and the composed prompt renders the unavailable line", async () => {
    handle.sqlite
      .prepare(`INSERT INTO space_meta (space_id, timezone) VALUES (?, 'Not/AZone')`)
      .run(SPACE);
    const { llm, captured } = capturingLlm();
    const res = await chat(handle, { embeddings, llm }, "what day is it?", DEFAULT_CHAT, SPACE);
    expect(res.answer).toBe("A full cloud answer."); // the turn still works
    const opts = captured()!;
    // Explicit null — "tried and could not resolve" — not undefined, and
    // never the invalid string the pre-fix code passed through to a UTC
    // rendering.
    expect(opts.timezone).toBeNull();
    const sys = composeSystem(opts);
    expect(sys).toContain(formatNowUnavailableLine());
    expect(sys).toContain("current local date and time are unavailable");
    expect(sys).not.toContain("in the user's timezone");
  });
});
