import type { AppContext } from "../context.js";

/**
 * Who speaks for Eternity (owner, 2026-10-30): "have him access the free Gemini one … it's only a couple of times a day".
 * The app's shared provider prefers OpenAI whenever an OpenAI key exists, so Eternity gets his OWN line to Gemini whenever a
 * Gemini key is configured (the same Fly secret Maya would use), and only falls back to the shared provider otherwise. No
 * key at all → null, and he speaks his own offline lines. Calls are metered in the same usage ledger and respect the spend
 * budget; every call is bounded by a timeout so a hung request can never stall the minute tick.
 */
export interface EternalVoice {
  /** "gemini" = his own free-tier line; "shared" = the app's configured provider. */
  readonly via: "gemini" | "shared";
  eternalVoice(occasion: string, brief: string): Promise<string>;
  /** The whole cast's day in ONE call (npcs/dailyScript.ts). Absent when the line has no such method. */
  npcDayScript?(prompt: string): Promise<{ npc: string; situation: string; lines: string[] }[]>;
}

export const ETERNITY_VOICE_TIMEOUT_MS = 20_000;
/** The batched day script is one bigger call than a single line. */
export const NPC_SCRIPT_TIMEOUT_MS = 45_000;

function findGeminiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const [k, v] of Object.entries(process.env)) if (v && /gemini.*(api|key)/i.test(k)) return v;
  return undefined;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("eternity voice timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function createEternityVoice(ctx: AppContext): Promise<EternalVoice | null> {
  const key = findGeminiKey();
  if (key) {
    const { GeminiProvider } = await import("../llm/gemini.js");
    const gemini = new GeminiProvider(key, (model, inTok, outTok) => ctx.usage.record(model, inTok, outTok));
    return {
      via: "gemini",
      eternalVoice: async (occasion, brief) => {
        if (ctx.usage.overBudget()) throw new Error("AI budget reached for now");
        return withTimeout(gemini.eternalVoice(occasion, brief), ETERNITY_VOICE_TIMEOUT_MS);
      },
      npcDayScript: async (prompt) => {
        if (ctx.usage.overBudget()) throw new Error("AI budget reached for now");
        return withTimeout(gemini.npcDayScript(prompt), NPC_SCRIPT_TIMEOUT_MS);
      },
    };
  }
  const shared = ctx.llm;
  if (shared.eternalVoice && shared.available) {
    return {
      via: "shared",
      eternalVoice: (occasion, brief) => withTimeout(shared.eternalVoice!(occasion, brief), ETERNITY_VOICE_TIMEOUT_MS),
      ...(shared.npcDayScript
        ? { npcDayScript: (prompt: string) => withTimeout(shared.npcDayScript!(prompt), NPC_SCRIPT_TIMEOUT_MS) }
        : {}),
    };
  }
  return null;
}
