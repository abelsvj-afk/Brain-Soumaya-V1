import type { CaptainDefinition, CaptainWorld } from "@brain/shared";
import { rngFor } from "./seed.js";

/**
 * The bark seam (design §13): every line a captain speaks comes
 * from a BarkSource. L1 ships exactly one implementation — the
 * TemplateBarkSource: deterministic lines built from the captain's
 * fixed voice profile (§13.2), chosen by seed so the same day and
 * visit always produce the same line. A model-backed source is a
 * later, separately-authorized cartridge behind this same
 * interface; it would write lines, never decisions, and pass the
 * §13.5 fact gate before storage. There is NO LLM code, provider
 * call, or key handling in this increment.
 *
 * Storage lives in the engine (CaptainRepo.addBark) with
 * source='template' — the seam's provenance rule (§13.9 S4).
 */

export interface BarkContext {
  def: CaptainDefinition;
  world: CaptainWorld;
  /** The world's plain name, resolved by the caller. */
  worldName: string;
  /** Space-local day the line belongs to. */
  dayKey: string;
  /** What makes this utterance distinct (a visit key, a session). */
  occasionKey: string;
}

export interface BarkSource {
  /** A hello to a visitor the captain shares a world with. */
  greeting(ctx: BarkContext): string;
  /** A line spoken to no one in particular — Chronicle color. */
  idle(ctx: BarkContext): string;
}

function pick(lines: readonly string[], seedParts: (string | number)[], worldName: string): string {
  if (lines.length === 0) return "";
  const idx = Math.floor(rngFor(...seedParts)() * lines.length) % lines.length;
  return (lines[idx] ?? lines[0] ?? "").replaceAll("{world}", worldName);
}

export class TemplateBarkSource implements BarkSource {
  greeting(ctx: BarkContext): string {
    return pick(ctx.def.voice.greetingLines, [ctx.def.id, "greeting", ctx.dayKey, ctx.occasionKey], ctx.worldName);
  }

  idle(ctx: BarkContext): string {
    return pick(ctx.def.voice.idleLines, [ctx.def.id, "idle", ctx.dayKey, ctx.occasionKey], ctx.worldName);
  }
}

/** The one bark source L1 runs. Swapping it is the §13 seam. */
export const templateBarkSource: BarkSource = new TemplateBarkSource();
