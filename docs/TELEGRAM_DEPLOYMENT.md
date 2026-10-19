# Telegram Deployment Guide — Phase 1 Agent Loop

> **Status: DOCUMENTED, NOT CONFIGURED.** Telegram is not live on Fly. Do not
> claim it works until the smoke test below passes against production.

## What exists in code (branch `phase-1-agent-loop`)

- `POST /api/telegram/webhook/:secret` — webhook receiver (`api/routes/telegram.ts`).
  Verifies the secret twice (URL path + `X-Telegram-Bot-Api-Secret-Token` header).
  Acks immediately, processes in background.
- `telegram/bot.ts` — `handleTelegramUpdate`: `/link`, `/unlink`, `/log`,
  `/digest`, `/help`, and free-text → **agent loop** (Phase 1) with `chat()`
  fallback on error.
- `telegram/links.ts` — `telegram_links` table: `chat_id` → `space_id` mapping.
- Daily digest push exists (`sendDailyDigests`); the agent loop's proactive
  sends use the same `send` path.

## Required environment variables (exact names from the repo)

| Variable | Source | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather | Authenticates all Bot API calls |
| `TELEGRAM_WEBHOOK_SECRET` | You generate (random 32+ chars) | Proves webhook calls are really from Telegram |

Neither is optional. The webhook route returns 403 when either is unset.

## Setup procedure

1. **Create the bot:** message @BotFather on Telegram → `/newbot` → name it
   (e.g. `SoumayaSecondBrainBot`) → copy the token.
2. **Generate the webhook secret:** `openssl rand -hex 32` (any CSPRNG).
3. **Set Fly secrets** (never in source, never in chat):
   ```
   fly secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret> -a brain-soumaya-v1
   ```
4. **Deploy** the branch (after merge approval — NOT YET AUTHORIZED).
5. **Register the webhook.** On boot, `setTelegramWebhook(token, url, secret)`
   runs when both vars are configured. The URL is:
   ```
   https://brain-soumaya-v1.fly.dev/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
   ```
   Verify registration: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
   → `url` must match, `pending_update_count` should be 0.
   > Mount path `/api/telegram` — VERIFY against `api/server.ts` during
   > deployment; the route file mounts at `/webhook/:secret` under whatever
   > prefix `server.ts` gives the telegram router.
6. **Link a chat:** message the bot → `/link <brain-name> <passcode>`
   (same name + passcode as the web app).

## Smoke test (production)

1. `/help` → expect the HELP text.
2. Free-text message → expect an agent-loop answer (not the old GraphRAG-only reply).
3. `/log test from telegram` → expect "Logged … link … formed".
4. Trigger a write tool via chat ("remind me to …") → expect a confirmation
   question → reply "yes" → expect execution.
5. Check Fly logs for `[telegram]` errors.

## What "not configured" means

- Local `npm test` covers handler logic (`send` is injected; no network).
- Real webhook delivery, `setWebhook` on boot, and the BotFather token are
  **production-only** and unverified until the smoke test passes.
- The agent loop works on web (`POST /api/chat/agent`) with zero Telegram
  configuration. Telegram is a channel, not a dependency.

## Quiet hours / rate limits (Phase 2)

Not yet implemented. Before enabling proactive Telegram sends beyond the
daily digest, define: allowed send windows, per-day cap, and what "urgent
enough to break quiet hours" means. The deterministic router's `notify`
has no such policy today.
