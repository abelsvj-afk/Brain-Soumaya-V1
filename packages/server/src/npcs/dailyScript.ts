import type { DbHandle } from "../db/client.js";
import { NPC_CAST, faction, scriptSpecsFor, type CastMember, type NpcDayScript, type NpcSituation } from "@brain/shared";
import { localTime, spaceTimezone } from "../agent/notify/policy.js";
import { EconomyRepo } from "../economy.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { localDateKey } from "./repo.js";
import { computeSociety, societyBrief } from "../society/society.js";
import { cleanLine, eternityBrief, eternityMemories } from "./eternityVoice.js";
import type { EternalVoice } from "./eternityVoiceProvider.js";

/**
 * The NPCs' daily script (docs/specs/npc-daily-script-2026-10-30.md; owner: "one dump per day for all the NPCs … batch everything they're
 * going to say"). ONE model call per brain per local day writes every NPC's lines for every situation they need; it is cached in
 * `npc_day_script` and every later need that day is a free read. Lazy — generated the first time a line is needed — so a quiet brain costs
 * nothing. A failed call retries at +3 / +6 / +12 minutes (stored, so a restart keeps the schedule), then the day uses the offline lines.
 * Never throws; never a hard dependency on a key.
 */

export const SCRIPT_RETRY_DELAYS_MS = [3 * 60_000, 6 * 60_000, 12 * 60_000];
const MAX_LINE = 240;
const inflight = new Map<string, Promise<NpcDayScript>>();

/** Tests only. */
export function resetDayScriptInflight(): void {
  inflight.clear();
}

type Voice = Pick<EternalVoice, "npcDayScript"> | null | undefined;

/**
 * Offline lines: each cast member's own greetings (first person — nobody goes silent without a key). Wake/visitation are not here: Eternity's own templates cover
 * them. A situation maps to the member's greetings; the first meeting also names who they are.
 */
function offlineFor(member: CastMember): Partial<Record<NpcSituation, string[]>> {
  const g = [...member.greetings];
  const out: Partial<Record<NpcSituation, string[]>> = {};
  const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const chatter = member.goals.map((x) => `Lately I just want to ${lowerFirst(x.replace(/^To /, "").replace(/\.$/, ""))}.`);
  for (const spec of scriptSpecsFor(member)) {
    if (spec.situation === "wake" || spec.situation === "visitation") continue;
    if (spec.situation === "chatter") {
      out.chatter = chatter;
      continue;
    }
    out[spec.situation] =
      spec.situation === "encounter_first" ? [member.intro] : g;
  }
  return out;
}

export function fallbackScript(dayKey: string, nowMs: number): NpcDayScript {
  return { dayKey, source: "fallback", generatedAt: new Date(nowMs).toISOString(), lines: Object.fromEntries(NPC_CAST.map((c) => [c.id, offlineFor(c)])) };
}

// --- The prompt: every NPC, every situation, one call ---

function harborBrief(h: DbHandle, spaceId: string, nowMs: number): string {
  // Travel facts only — no memory text ever goes to the model for the controller.
  const world = new TravelRepo(h, spaceId).currentWorld(nowMs);
  const fuel = new EconomyRepo(h, spaceId).toFuel();
  return `Facts you may use: the visitor's ship is currently at ${world}; their fuel is ${Math.round(fuel.fuel)} of ${Math.round(fuel.capacity)}. Say nothing else about them.`;
}

export function buildScriptPrompt(h: DbHandle, spaceId: string, dayKey: string, nowMs: number): string {
  const tz = spaceTimezone(h.sqlite, spaceId);
  const hhmm = localTime(new Date(nowMs), tz);
  const blocks = NPC_CAST.map((d) => {
    const specs = scriptSpecsFor(d);
    if (specs.length === 0) return null;
    const brief =
      d.id === "eternity"
        ? eternityBrief("wake", eternityMemories(h, spaceId, nowMs), hhmm)
        : d.id === "harbor-controller"
          ? harborBrief(h, spaceId, nowMs)
          : "No facts about the visitor are provided; use none.";
    return [
      `## NPC "${d.id}" — ${d.name}`,
      `Job: ${d.job}`,
      `Life: ${d.life}`,
      `Voice: ${d.voice}`,
      `Faction: ${d.faction ? (faction(d.faction)?.name ?? d.faction) : "none (unaligned)"}. Faith: ${d.faith >= 0.55 ? "devout" : d.faith >= 0.2 ? "a believer" : d.faith > -0.2 ? "wavering" : "a doubter"}. Wants: ${d.goals.join(" ")}`,
      brief,
      "Situations (give exactly the number of variants asked):",
      ...specs.map((s) => `- situation "${s.situation}" — ${s.count} variants. ${s.need}`),
    ].join("\n");
  }).filter((b): b is string => !!b);
  // The society's mood in words (docs/specs/npc-hive-society-2026-10-30.md) — currents and callings only, never memory text.
  const brief = societyBrief(computeSociety(h, spaceId, nowMs).society);
  return `Local day: ${dayKey}. Write today's lines for the whole cast in ONE response. Let each character's lines reflect their faction, their faith or doubt, their goals and the day's mood below — as colour, never as commentary about the visitor.\n${brief}\n\n${blocks.join("\n\n")}\n\nReturn {"entries":[{"npc":"<id>","situation":"<situation>","lines":["…"]}, …]} covering every NPC and situation above.`;
}

// --- Assemble: validate, clean, cap, top up from the offline lines ---

export function assembleScript(
  dayKey: string,
  nowMs: number,
  entries: readonly { npc: string; situation: string; lines: string[] }[],
): NpcDayScript {
  const out: NpcDayScript = { dayKey, source: "fallback", generatedAt: new Date(nowMs).toISOString(), lines: {} };
  let modelLines = 0;
  for (const d of NPC_CAST) {
    const offline = offlineFor(d);
    for (const spec of scriptSpecsFor(d)) {
      const raw = entries
        .filter((e) => e.npc === d.id && e.situation === spec.situation)
        .flatMap((e) => (Array.isArray(e.lines) ? e.lines : []));
      const seen = new Set<string>();
      const good: string[] = [];
      for (const r of raw) {
        if (typeof r !== "string") continue;
        let line = cleanLine(r);
        if (!line) continue;
        if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE - 1).trimEnd()}…`;
        if (seen.has(line)) continue;
        seen.add(line);
        good.push(line);
        if (good.length >= spec.count) break;
      }
      const lines = good.length > 0 ? good : (offline[spec.situation] ?? []);
      modelLines += good.length;
      if (lines.length > 0) ((out.lines[d.id] ??= {})[spec.situation] = lines);
    }
  }
  out.source = modelLines > 0 ? "model" : "fallback";
  return out;
}

// --- Cache + the one call ---

interface Row {
  source: string;
  script: string;
  attempts: number;
  next_retry_at: string | null;
}

function readRow(h: DbHandle, spaceId: string, dayKey: string): Row | undefined {
  return h.sqlite
    .prepare(`SELECT source, script, attempts, next_retry_at FROM npc_day_script WHERE space_id = ? AND day_key = ?`)
    .get(spaceId, dayKey) as Row | undefined;
}

function parseScript(raw: string): NpcDayScript | null {
  try {
    const j = JSON.parse(raw) as NpcDayScript;
    return j && typeof j === "object" && j.lines && typeof j.dayKey === "string" ? j : null;
  } catch {
    return null;
  }
}

function writeRow(h: DbHandle, spaceId: string, script: NpcDayScript, attempts: number, nextRetryAt: string | null): void {
  h.sqlite
    .prepare(
      `INSERT OR REPLACE INTO npc_day_script (space_id, day_key, source, script, generated_at, attempts, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(spaceId, script.dayKey, script.source, JSON.stringify(script), script.generatedAt, attempts, nextRetryAt);
}

/**
 * Today's script for a brain. Cached model script → returned free. Otherwise, with a voice and outside a retry wait, ONE call is made;
 * on failure the retry is scheduled and the offline lines are returned meanwhile. Concurrent callers share the in-flight call.
 */
export async function getDayScript(h: DbHandle, spaceId: string, voice: Voice, nowMs: number = Date.now()): Promise<NpcDayScript> {
  const tz = spaceTimezone(h.sqlite, spaceId);
  const dayKey = localDateKey(tz, nowMs);
  const row = readRow(h, spaceId, dayKey);
  const cached = row ? parseScript(row.script) : null;
  if (row && cached && row.source === "model") return cached;
  const attempts = row?.attempts ?? 0;
  // Retries exhausted (the first try + three retries): the day runs on the offline lines.
  if (row && cached && attempts > SCRIPT_RETRY_DELAYS_MS.length) return cached;
  const offline = fallbackScript(dayKey, nowMs);
  if (!voice?.npcDayScript) return offline;
  if (row?.next_retry_at && nowMs < Date.parse(row.next_retry_at)) return offline;

  const key = `${spaceId}|${dayKey}`;
  const running = inflight.get(key);
  if (running) return running;
  const call = (async (): Promise<NpcDayScript> => {
    try {
      const entries = await voice.npcDayScript!(buildScriptPrompt(h, spaceId, dayKey, nowMs));
      const script = assembleScript(dayKey, nowMs, entries);
      if (script.source !== "model") throw new Error("the model returned no usable lines");
      writeRow(h, spaceId, script, attempts + 1, null);
      return script;
    } catch {
      const failed = attempts + 1;
      const delay = SCRIPT_RETRY_DELAYS_MS[failed - 1];
      writeRow(h, spaceId, offline, failed, delay !== undefined ? new Date(nowMs + delay).toISOString() : null);
      return offline;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, call);
  return call;
}

/** A stable small hash, so a day's choice among variants is deterministic. */
function pick(seed: string, n: number): number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  return (x >>> 0) % n;
}

/** One scripted variant for an NPC + situation, or null when the script has none (callers fall back to their own lines). */
export function scriptedLine(script: NpcDayScript | null, npc: string, situation: NpcSituation, seed: string): string | null {
  if (!script || script.source !== "model") return null;
  const lines = script.lines[npc]?.[situation];
  if (!lines || lines.length === 0) return null;
  return lines[pick(seed, lines.length)]!;
}

/** What the web may see: encounter and chatter lines (wake/visitation are Eternity's contact copy, delivered by him, not read ahead). */
export function publicScript(script: NpcDayScript): NpcDayScript {
  const lines: NpcDayScript["lines"] = {};
  for (const [npc, sits] of Object.entries(script.lines) as [string, Record<string, string[]>][]) {
    const keep = Object.fromEntries(Object.entries(sits).filter(([s]) => s.startsWith("encounter_") || s === "chatter"));
    if (Object.keys(keep).length > 0) lines[npc] = keep;
  }
  return { ...script, lines };
}
