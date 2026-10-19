import type { DailyDigest } from "@brain/shared";
import type { AppContext } from "../context.js";
import { chat } from "../chat/graphrag.js";
import { ingest, ingestWithContext } from "../ingestion/pipeline.js";
import { buildDailyDigest } from "../synthesis/dailyDigest.js";
import { getDailyContact } from "../analysis/dailyContact.js";
import { EconomyRepo, EARN_MEMORY, EARN_LINK } from "../economy.js";
import { StreakRepo, STREAK_DAY_BONUS } from "../streak.js";
import { SpacesRepo } from "../auth/spaces.js";
import { TelegramLinksRepo } from "./links.js";
import { getPreferences, setPreference, localDay, localTime } from "../agent/notify/policy.js";

/**
 * Talk to your Soumaya brain from Telegram. This deployment hosts many private
 * brains (anyone can open one), so a chat must first /link to a brain by name +
 * passcode; after that, messages route to that brain and Soumaya pushes a daily
 * digest there on her own (Phase B proactive nudges). The webhook route
 * (api/routes/telegram.ts) verifies the secret and hands raw updates here; the
 * actual send is injected so this is unit-testable without the network. See
 * plans/telegram-and-autonomy.md for the evolution path (voice notes, autonomy).
 */

const TG_API = "https://api.telegram.org";

export interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
    from?: { first_name?: string };
  };
}

/** Injected sender so tests run with no network. */
export type Send = (chatId: number, text: string) => Promise<void>;

/** Send a text message to a chat (real network). Best-effort — never throws. */
export async function tgSend(token: string, chatId: number, text: string): Promise<void> {
  try {
    await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.error("[telegram] send failed:", err);
  }
}

/** Point Telegram at our webhook (called on boot when fully configured). */
export async function setTelegramWebhook(
  token: string,
  url: string,
  secret: string,
): Promise<void> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"] }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    console.log(`[telegram] setWebhook ok=${j.ok} ${j.description ?? ""}`.trim());
  } catch (err) {
    console.error("[telegram] setWebhook failed:", err);
  }
}

const HELP =
  "🛰️ I'm Soumaya, your second brain.\n\n" +
  "First, link this chat to your brain:\n" +
  "• /link <name> <passcode> — opens that brain here (creates it if the name is new). " +
  "Use the same name + passcode as the web app.\n\n" +
  "Then, any time:\n" +
  "• Send me anything and I'll answer from your memories (with what I drew on).\n" +
  "• /log <thought> — save a new memory; I'll tell you what landed.\n" +
  "• /digest — get today's digest now (I also send it once a day on my own).\n" +
  "• /digest 07:00 — change when the daily digest arrives.\n" +
  "• /quiet 21:00 04:30 — set quiet hours (I won't ping you then unless it's urgent).\n" +
  "• /cap 5 — max proactive pings per day (urgent ones don't count).\n" +
  "• /tz America/Chicago — set your timezone for quiet hours + digest.\n" +
  "• /settings — show your current notification settings.\n" +
  "• /unlink — disconnect this chat.\n" +
  "• /help — show this again.";

const LINK_RE = /^\/link\s+(\S+)\s+(\S.*)$/;

/** Render a daily digest as a compact Telegram message in Soumaya's voice. */
export function formatDigest(digest: DailyDigest, spaceName: string): string {
  const lines: string[] = [`🌌 ${spaceName} · ${digest.date}`, "", digest.greeting];

  if (digest.fresh.length > 0) {
    lines.push("", `✦ Fresh today (${digest.fresh.length}):`);
    for (const f of digest.fresh.slice(0, 5)) lines.push(`• ${f.node.label} — ${f.take}`);
  }

  if (digest.connections.length > 0) {
    lines.push("", "🔗 Connections I noticed:");
    for (const c of digest.connections.slice(0, 3)) lines.push(`• ${c.text}`);
  }

  if (digest.cooling.length > 0) {
    lines.push("", "❄️ Cooling from neglect — revisit to warm them:");
    for (const c of digest.cooling.slice(0, 5)) lines.push(`• ${c.node.label}`);
  }

  if (digest.reminders && digest.reminders.length > 0) {
    lines.push("", "⏰ Reminders due:");
    for (const r of digest.reminders.slice(0, 5)) lines.push(`• ${r.node.label}`);
  }

  if (digest.expiredActions.length > 0) {
    lines.push("", "⌛ Action items that timed out:");
    for (const a of digest.expiredActions.slice(0, 5)) lines.push(`• ${a.label}`);
  }

  lines.push("", digest.closing);
  return lines.join("\n");
}

/**
 * Core update handler. `send` is injected so tests run with no network.
 *
 * Multi-brain: a chat must /link to a brain before it can log or ask anything.
 */
export async function handleTelegramUpdate(
  ctx: AppContext,
  update: TelegramUpdate,
  send: Send,
): Promise<void> {
  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = (msg?.text ?? "").trim();
  if (chatId == null || !text) return;

  const links = new TelegramLinksRepo(ctx.handle);

  if (text === "/start" || text === "/help") {
    await send(chatId, HELP);
    return;
  }

  // /link <name> <passcode> — bind this chat to a brain (creating it if new).
  if (text.startsWith("/link")) {
    const m = LINK_RE.exec(text);
    if (!m) {
      await send(chatId, "Usage: /link <name> <passcode> — e.g. /link soumaya hunter2");
      return;
    }
    const [, name, passcode] = m;
    let result;
    try {
      result = new SpacesRepo(ctx.handle).authOrCreate(name!.trim(), passcode!.trim());
    } catch (err) {
      // e.g. passcode too short for a NEW brain, or a reserved name — authOrCreate throws
      // for registration-only validation failures; surface it instead of a silent/generic
      // failure (this path isn't behind the HTTP route's zod validation).
      await send(chatId, (err as Error).message);
      return;
    }
    if (!result) {
      await send(chatId, `A brain named "${name}" exists but that passcode is wrong.`);
      return;
    }
    links.link(chatId, result.space.id, result.space.name);
    const verb = result.created ? "Created and linked" : "Linked";
    await send(
      chatId,
      `🔗 ${verb} this chat to "${result.space.name}". ` +
        "Send me anything, or /log a memory. I'll also bring you a daily digest.\n\n" +
        "(For privacy, delete the message above so your passcode isn't left in the chat.)",
    );
    return;
  }

  if (text === "/unlink") {
    const had = links.unlink(chatId);
    await send(chatId, had ? "Unlinked. /link <name> <passcode> to reconnect." : "This chat wasn't linked.");
    return;
  }

  // Everything below needs a linked brain.
  const link = links.get(chatId);
  if (!link) {
    await send(chatId, "This chat isn't linked to a brain yet.\n\n" + HELP);
    return;
  }
  const spaceId = link.spaceId;

  // /digest — send now; /digest HH:MM — set the daily digest time.
  if (text === "/digest" || text.startsWith("/digest ")) {
    const arg = text.slice("/digest".length).trim();
    if (arg) {
      const r = setPreference(ctx.handle.sqlite, spaceId, "digestTime", arg);
      await send(chatId, r.ok ? `Digest time set to ${arg}.` : `Couldn't set that: ${r.error}`);
      return;
    }
    const digest = buildDailyDigest(ctx.handle, spaceId);
    await send(chatId, formatDigest(digest, link.spaceName));
    return;
  }

  // Phase 2 notification preferences.
  if (text.startsWith("/quiet")) {
    const m = /^\/quiet\s+(\S+)\s+(\S+)\s*$/.exec(text);
    if (!m) {
      await send(chatId, "Usage: /quiet <start HH:MM> <end HH:MM> — e.g. /quiet 21:00 04:30");
      return;
    }
    // Validate both before writing either (no partial updates).
    // setPreference validates without writing on failure, so check r2's input
    // first via a dry-run on the format, then write both.
    const prefsBefore = getPreferences(ctx.handle.sqlite, spaceId);
    const r1 = setPreference(ctx.handle.sqlite, spaceId, "quietStart", m[1]);
    if (!r1.ok) {
      await send(chatId, `Couldn't set that: ${r1.error}`);
      return;
    }
    const r2 = setPreference(ctx.handle.sqlite, spaceId, "quietEnd", m[2]);
    if (!r2.ok) {
      // Roll back: restore the original start.
      setPreference(ctx.handle.sqlite, spaceId, "quietStart", prefsBefore.quietStart);
      await send(chatId, `Couldn't set that: ${r2.error} (quiet hours unchanged)`);
      return;
    }
    await send(chatId, `Quiet hours set: ${m[1]}–${m[2]}.`);
    return;
  }

  if (text.startsWith("/cap")) {
    const m = /^\/cap\s+(\S+)\s*$/.exec(text);
    if (!m) {
      await send(chatId, "Usage: /cap <number> — e.g. /cap 5 (max proactive pings per day)");
      return;
    }
    const r = setPreference(ctx.handle.sqlite, spaceId, "dailyProactiveCap", m[1]);
    await send(chatId, r.ok ? `Daily cap set to ${m[1]}.` : `Couldn't set that: ${r.error}`);
    return;
  }

  if (text.startsWith("/tz")) {
    const m = /^\/tz\s+(\S+)\s*$/.exec(text);
    if (!m) {
      await send(chatId, "Usage: /tz <IANA timezone> — e.g. /tz America/Chicago");
      return;
    }
    const r = setPreference(ctx.handle.sqlite, spaceId, "timezone", m[1]);
    await send(chatId, r.ok ? `Timezone set to ${m[1]}.` : `Couldn't set that: ${r.error}`);
    return;
  }

  if (text === "/settings") {
    const p = getPreferences(ctx.handle.sqlite, spaceId);
    await send(
      chatId,
      `🔔 Notification settings:\n` +
        `• Timezone: ${p.timezone}\n` +
        `• Quiet hours: ${p.quietStart}–${p.quietEnd}\n` +
        `• Digest time: ${p.digestTime}\n` +
        `• Daily cap: ${p.dailyProactiveCap} proactive pings (urgent bypasses)`
    );
    return;
  }

  if (text.startsWith("/log")) {
    const body = text.slice("/log".length).trim();
    if (!body) {
      await send(chatId, "Add the memory after /log — e.g. /log call mom on Sunday");
      return;
    }
    const result = await ingestWithContext(ctx.handle, { embeddings: ctx.embeddings, llm: ctx.llm }, ctx, body, spaceId);
    const linkCount = result.associativeEdges.length;
    // A /log while her daily question is pending counts as answering it —
    // otherwise the same question rode every digest forever for Telegram-first
    // users. (Best-effort: the reply is very likely responsive to the ask.)
    ctx.handle.sqlite
      .prepare(
        `UPDATE daily_contact SET answered = 1
         WHERE space_id = ? AND date = date('now') AND answered = 0`,
      )
      .run(spaceId);
    // Same reward path as the app's ingest route: fuel + the daily streak
    // (logging from Telegram is tending too — the streak is channel-agnostic).
    const { streak, advanced } = new StreakRepo(ctx.handle, spaceId).touch();
    const fuel = EARN_MEMORY + EARN_LINK * linkCount + (advanced ? STREAK_DAY_BONUS : 0);
    new EconomyRepo(ctx.handle, spaceId).add(fuel);
    const label = result.nodes[0]?.label ?? "a memory";
    const streakNote = advanced ? ` · 🔥 day ${streak.current}` : "";
    await send(
      chatId,
      `✦ Logged "${label}" — ${linkCount} link${linkCount === 1 ? "" : "s"} formed · +${fuel.toFixed(1)} ⛽${streakNote}`,
    );
    return;
  }

  // Anything else = a question for the brain (GraphRAG).
  const answer = await chat(ctx.handle, { embeddings: ctx.embeddings, llm: ctx.llm }, text, undefined, spaceId);
  let reply = answer.answer?.trim() || "I don't have anything on that yet — add a memory with /log.";
  if (answer.citations.length > 0) {
    reply += `\n\n— from: ${answer.citations.map((c) => c.label).join(" · ")}`;
  }
  await send(chatId, reply);
}

/**
 * Proactive daily digest sweep (Phase B). For every linked chat that hasn't
 * received today's digest yet, build that brain's digest and push it. Idempotent
 * within a UTC day (guarded by last_digest_date), so it's safe to call from a
 * frequent scheduler. STRICTLY FREE — buildDailyDigest never calls the LLM, so
 * this can never drain the API budget. Returns how many digests were sent.
 */
export async function sendDailyDigests(ctx: AppContext, send: Send): Promise<number> {
  const now = new Date();
  const links = new TelegramLinksRepo(ctx.handle);
  let sent = 0;
  for (const link of links.all()) {
    // Phase 2: digest fires at the space's digest_time in its timezone, not midnight UTC.
    // lastDigestDate is the LOCAL date.
    const prefs = getPreferences(ctx.handle.sqlite, link.spaceId);
    const today = localDay(now, prefs.timezone);
    if (link.lastDigestDate === today) continue;
    if (localTime(now, prefs.timezone) < prefs.digestTime) continue;
    try {
      const digest = buildDailyDigest(ctx.handle, link.spaceId);
      let msg = formatDigest(digest, link.spaceName);
      // The Daily Contact rides along: her one question is the comeback hook —
      // replying in Telegram (via /log) or in the app both count as answering.
      const contact = getDailyContact(ctx, link.spaceId);
      if (contact.question && !contact.answered) {
        msg += `\n\n🪞 One thing I want to understand better:\n${contact.question.text}\n(Reply with /log — it becomes a memory and answers me.)`;
      }
      await send(link.chatId, msg);
      links.markDigestSent(link.chatId, today);
      sent++;
    } catch (err) {
      console.error(`[telegram] digest push failed for chat ${link.chatId}:`, err);
    }
  }
  return sent;
}
