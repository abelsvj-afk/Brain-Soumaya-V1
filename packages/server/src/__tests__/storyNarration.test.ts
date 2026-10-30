import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNarrator, narrationConfig, narrationIssue, narrationText } from "../story/narration.js";

const ENV = { LORE_TTS_API_KEY: "k-test", LORE_TTS_VOICE_NARRATOR: "voice-n" };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeFetch(opts: { status?: number; delay?: number } = {}) {
  const calls: { url: string; body: { text: string; model_id: string; voice_settings: Record<string, number> }; key: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), key: String((init.headers as Record<string, string>)["xi-api-key"]) });
    if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
    return new Response(opts.status && opts.status !== 200 ? "no" : new Uint8Array([1, 2, 3, 4]), { status: opts.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("narration gate", () => {
  it("is off without a key and voice, off when switched off, and reuses the Telegram secret", () => {
    expect(narrationConfig({})).toBeNull();
    expect(narrationConfig({ LORE_TTS_API_KEY: "k" })).toBeNull(); // no voice
    expect(narrationConfig({ ...ENV, LORE_TTS_ENABLED: "0" })).toBeNull();
    expect(narrationConfig({ TELEGRAM_TTS_API_KEY: "tk", TELEGRAM_TTS_VOICE_ID: "tv" })).toMatchObject({ apiKey: "tk", voiceId: "tv" });
    expect(narrationConfig(ENV)?.modelId).toBe("eleven_multilingual_v2");
  });
});

describe("what is spoken is canon, never the client's words", () => {
  it("uses the entry's words in the register, adds a held Second Reading, and nothing for something that is not canon", () => {
    expect(narrationText("obj.doorkeepers-nail", "plain", new Set())).toMatch(/always warm/);
    expect(narrationText("obj.doorkeepers-nail", "plain", new Set())).not.toMatch(/another, given to a man/);
    expect(narrationText("obj.doorkeepers-nail", "plain", new Set(["relic.harbor-nail"]))).toMatch(/another, given to a man/);
    expect(narrationText("obj.kiths-drawing", "grave", new Set())).toMatch(/gone through the paper/);
    expect(narrationText("obj.not-in-canon", "plain", new Set())).toBeNull();
    expect(narrationText("companion.dock-1", "warm", new Set(), "weight")).toMatch(/^A child with a flask sat with you/);
  });
});

describe("the shared cache", () => {
  it("voices a line once, then replays it for free — across callers", async () => {
    const f = fakeFetch();
    const n = createNarrator({ env: ENV, fetchImpl: f.impl, dir });
    const a = await n.narrate("Hello there.", "plain");
    const b = await n.narrate("Hello there.", "plain");
    expect(a?.audio.byteLength).toBe(4);
    expect(b?.key).toBe(a?.key);
    expect(f.calls).toHaveLength(1);
    expect(readdirSync(dir).filter((x) => x.endsWith(".mp3"))).toHaveLength(1);
    // a fresh narrator (a restart) still finds it on disk: zero provider calls
    const again = createNarrator({ env: ENV, fetchImpl: f.impl, dir });
    expect((await again.narrate("Hello there.", "plain"))?.key).toBe(a?.key);
    expect(f.calls).toHaveLength(1);
  });

  it("a different register is a different clip with different delivery settings; the key never leaves the server request", async () => {
    const f = fakeFetch();
    const n = createNarrator({ env: ENV, fetchImpl: f.impl, dir });
    await n.narrate("Hello there.", "plain");
    await n.narrate("Hello there.", "grave");
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.body.voice_settings.speed).toBeLessThan(f.calls[0]!.body.voice_settings.speed!);
    expect(f.calls.every((c) => c.key === "k-test" && c.url.includes("voice-n"))).toBe(true);
  });

  it("concurrent first listeners share ONE synthesis", async () => {
    const f = fakeFetch({ delay: 30 });
    const n = createNarrator({ env: ENV, fetchImpl: f.impl, dir });
    const all = await Promise.all([n.narrate("Once.", "plain"), n.narrate("Once.", "plain"), n.narrate("Once.", "plain")]);
    expect(all.every((x) => x?.audio.byteLength === 4)).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
});

describe("it never breaks the Book", () => {
  it("returns null with no key, on a provider error, and when the monthly cap would be passed", async () => {
    const f = fakeFetch();
    expect(await createNarrator({ env: {}, fetchImpl: f.impl, dir }).narrate("x", "plain")).toBeNull();
    expect(f.calls).toHaveLength(0);
    const bad = fakeFetch({ status: 402 });
    expect(await createNarrator({ env: ENV, fetchImpl: bad.impl, dir }).narrate("x", "plain")).toBeNull();
    const capped = fakeFetch();
    const n = createNarrator({ env: { ...ENV, LORE_TTS_MONTHLY_CHARS: "30" }, fetchImpl: capped.impl, dir });
    expect(await n.narrate("a".repeat(20), "plain")).not.toBeNull();
    expect(await n.narrate("b".repeat(20), "plain")).toBeNull(); // 20 + 20 > 30
    expect(capped.calls).toHaveLength(1);
    expect(await n.narrate("a".repeat(20), "plain")).not.toBeNull(); // but a cached replay is always free
  });
});

describe("each speaking role has its own voice, falling back to the narrator's", () => {
  it("uses LORE_TTS_VOICE_<ROLE> when set and the narrator otherwise; a different voice is a different clip", async () => {
    const env = { ...ENV, LORE_TTS_VOICE_CALEND: "voice-calend" };
    const cfg = narrationConfig(env)!;
    expect(cfg.voiceFor("calend")).toBe("voice-calend");
    expect(cfg.voiceFor("dorrow")).toBe("voice-n"); // no voice set for Dorrow: the narrator reads her... his lines
    expect(cfg.voiceFor("narrator")).toBe("voice-n");
    const f = fakeFetch();
    const n = createNarrator({ env, fetchImpl: f.impl, dir });
    await n.narrate("It's warm.", "plain", "calend");
    await n.narrate("It's warm.", "plain", "narrator");
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.url).toContain("voice-calend");
    expect(f.calls[1]!.url).toContain("voice-n");
  });
});

describe("telling the owner why the studio voice is not in use", () => {
  it("names the missing secret, never a value", () => {
    expect(narrationIssue({})).toMatch(/LORE_TTS_API_KEY/);
    expect(narrationIssue({ LORE_TTS_API_KEY: "k" })).toMatch(/LORE_TTS_VOICE_NARRATOR/);
    expect(narrationIssue({ LORE_TTS_ENABLED: "0" })).toMatch(/switched off/);
    expect(narrationIssue(ENV)).toBeNull();
    expect(JSON.stringify([narrationIssue({}), narrationIssue({ LORE_TTS_API_KEY: "secret-key" })])).not.toContain("secret-key");
  });
  it("remembers the last provider problem (status code, cap) until a clip succeeds", async () => {
    const bad = fakeFetch({ status: 401 });
    const n = createNarrator({ env: ENV, fetchImpl: bad.impl, dir });
    expect(n.status()).toEqual({ on: true, issue: null });
    await n.narrate("x", "plain");
    expect(n.status().on).toBe(false);
    expect(n.status().issue).toMatch(/HTTP 401.*API key/);
    expect(n.status().issue).not.toContain("k-test");
  });
});
