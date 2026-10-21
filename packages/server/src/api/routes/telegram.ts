import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { AppContext } from "../../context.js";
import { handleTelegramUpdate, tgSend, tgSendVoice } from "../../telegram/bot.js";

/** Constant-time string compare (length-safe) — avoids leaking the secret via timing. */
function secretEq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Telegram webhook (open route — auth is the secret, not an x-space-id). Telegram
 * POSTs updates here; we verify the secret two ways (URL path + the
 * X-Telegram-Bot-Api-Secret-Token header Telegram echoes from setWebhook), ack
 * immediately so Telegram doesn't retry, then process in the background.
 */
export function telegramRoutes(ctx: AppContext): Router {
  const r = Router();

  r.post("/webhook/:secret", (req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (
      !token ||
      !secret ||
      !secretEq(req.params.secret, secret) ||
      !secretEq(req.get("x-telegram-bot-api-secret-token"), secret)
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    // Ack right away (Telegram retries on any non-200), then handle off the response.
    res.json({ ok: true });
    // Voice replies (Phase D) ride along as an injected sender; the
    // TELEGRAM_TTS_* gate in telegram/tts.ts decides whether they're ever
    // used — with the gate off this sender is never called.
    void handleTelegramUpdate(ctx, req.body, (chatId, text) => tgSend(token, chatId, text), {
      sendVoice: (chatId, speech) => tgSendVoice(token, chatId, speech),
    }).catch((err) => console.error("[telegram] handler error:", err));
  });

  return r;
}
