/**
 * Pre-voice the lore (docs/specs/lore-narration-2026-10-30.md §2). Voices every written line of the canon in every register into the shared cache so the first player to hear a
 * line pays nothing and waits for nothing. Prints a cost estimate first; only spends with --yes. Safe to re-run: cached lines are free, and an edited line (new hash) is the only
 * thing re-voiced.
 *
 *   LORE_TTS_API_KEY=… LORE_TTS_VOICE_NARRATOR=… LORE_AUDIO_DIR=/data/lore-audio npx tsx scripts/lore-narrate.ts [--yes]
 *
 * The key is read from the environment only (a Fly secret) and never written anywhere.
 */
import { STORY_ENTRIES, STORY_REACTIONS } from "../packages/shared/src/index.js";
import { createNarrator, narrationConfig } from "../packages/server/src/story/narration.js";
import type { Register, VoiceRole } from "../packages/shared/src/index.js";

const REGISTERS: Register[] = ["plain", "warm", "grave"];
const lines = new Map<string, { id: string; register: Register; text: string; role: VoiceRole }>();
for (const e of STORY_ENTRIES) {
  if (!e.text || e.retired) continue;
  for (const register of REGISTERS) {
    const text = e.text[register] ?? e.text.plain;
    lines.set(`narrator|${register}|${text}`, { id: e.id, register, text, role: "narrator" }); // identical wording voiced once
  }
}
// What people say about what you hold, each in their own voice.
for (const r of STORY_REACTIONS) lines.set(`${r.role}|plain|${r.line}`, { id: `${r.npc} on ${r.holds}`, register: "plain", text: r.line, role: r.role });
const chars = [...lines.values()].reduce((n, l) => n + l.text.length, 0);
console.log(`${lines.size} lines, ${chars.toLocaleString()} characters to voice at most (cached lines cost nothing).`);

const cfg = narrationConfig();
if (!cfg) {
  console.error("Narration is off: set LORE_TTS_API_KEY (or TELEGRAM_TTS_API_KEY) and LORE_TTS_VOICE_NARRATOR.");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.log("Dry run. Re-run with --yes to voice them.");
  process.exit(0);
}
async function main(): Promise<void> {
  const narrator = createNarrator({ dir: process.env.LORE_AUDIO_DIR ?? "./lore-audio" });
  let ok = 0;
  for (const l of lines.values()) {
    const clip = await narrator.narrate(l.text, l.register, l.role);
    if (clip) ok++;
    else console.error(`  not voiced: ${l.id} (${l.register})`);
  }
  console.log(`Done: ${ok} of ${lines.size} lines have audio.`);
}
void main();
