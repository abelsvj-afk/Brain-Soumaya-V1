/**
 * One-off generator for `fixtures/webChatSystemPrompt.golden.txt`.
 *
 * Run from packages/server:
 *   npx tsx src/chat/__tests__/generateGolden.ts
 *
 * IMPORTANT: the committed fixture was generated from the PRE-REFACTOR base
 * code (deploy HEAD 52ffbd6, before companionContext.ts existed) — that is
 * what makes the golden test in companionContext.test.ts a proof that the
 * Phase 0 extraction changed no byte of the web chat's system prompt.
 * Regenerating after the refactor should reproduce the identical file; if it
 * does not, the refactor (or a later change) altered the prompt — do not
 * bless a diff without understanding it.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../../db/client.js";
import { GOLDEN_NOW_MS, assembleGoldenSystemPrompt, seedGoldenBrain } from "./goldenSeed.js";

// Freeze the wall clock at the golden instant (only Date is patched; timers
// and everything else stay real). All code under test reads the global Date.
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(GOLDEN_NOW_MS);
    else super(...(args as [value: number]));
  }
  static now(): number {
    return GOLDEN_NOW_MS;
  }
}
(globalThis as { Date: typeof Date }).Date = FrozenDate as typeof Date;

const handle = createDb(":memory:");
try {
  await seedGoldenBrain(handle);
  const prompt = await assembleGoldenSystemPrompt(handle);
  const out = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "webChatSystemPrompt.golden.txt");
  writeFileSync(out, prompt, "utf8");
  console.log(`wrote ${out} (${prompt.length} chars)`);
} finally {
  handle.sqlite.close();
}
