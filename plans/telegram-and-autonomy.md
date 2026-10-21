# Telegram + Server-Side Autonomy

How to talk to your Soumaya brain from Telegram, and the roadmap from "answers when
you message her" to "thinks and reaches out on her own."

This deployment hosts **many private brains** (anyone can open one), so Telegram is
multi-brain: a chat first **links** to a brain by name + passcode, then everything
routes to that brain.

## Phase A — Chat + Log (SHIPPED)

Message the bot → she answers from your memories (GraphRAG, with what she drew on);
`/log <thought>` → ingests a memory and reports what landed + fuel earned.

- `server/src/telegram/bot.ts` — `handleTelegramUpdate` (send injected, unit-tested),
  `tgSend`, `setTelegramWebhook`, `formatDigest`, `sendDailyDigests`.
- `server/src/api/routes/telegram.ts` — `POST /api/telegram/webhook/:secret`
  (open route; verifies the secret in the path AND the
  `X-Telegram-Bot-Api-Secret-Token` header; acks immediately, processes async).
- Webhook auto-registers on boot when the secrets + `PUBLIC_URL` are set.

## Phase B — Proactive nudges (SHIPPED)

Soumaya reaches out, not just responds.

- `sendDailyDigests` (bot.ts) sweeps every linked chat and pushes that brain's
  **daily digest** — fresh memories with her take, latent connections she surfaced,
  and **"going cold" beacon nudges** (cooling memories to revisit) + expired actions.
- Driven by an hourly `setInterval` in `index.ts` (gated on `TELEGRAM_BOT_TOKEN`).
  Idempotent within a UTC day via `telegram_links.last_digest_date`, so the hourly
  tick simply fires the digest on the first run after midnight UTC.
- **Free:** `buildDailyDigest` never calls the LLM, so — like the heartbeat — it can
  never drain the API budget. `/digest` lets a user pull the same digest on demand.

## Multi-brain linking (SHIPPED — was Phase D "multi-user")

- `telegram_links(chat_id PRIMARY KEY, space_id, space_name, last_digest_date,
  created_at)` (`db/client.ts` bootstrap + idempotent migration; `telegram/links.ts`
  owns the SQL via `TelegramLinksRepo`).
- `/link <name> <passcode>` authenticates via the existing `SpacesRepo.authOrCreate`
  (creates the brain if the name is new, rejects a wrong passcode) and binds the chat.
  `/unlink` disconnects. Until a chat links, `/log` and questions are refused with help.
- Two chats linked to two brains stay fully isolated (covered by `telegram.test.ts`).

> Passcode hygiene: `/link` puts the passcode in the chat history, so the success
> reply tells the user to delete that message. (Same lightweight auth as the web app.)

## Phase C — Full server-side autonomy (SHIPPED)

The *thinking* agent (synthesis/research/merging/daily-log) was **browser-driven**
(`web/src/graph/soumaya.ts` polls `/maintenance/next-job`). It now also runs
**server-side 24/7** so she evolves with no tab open.

- Job logic extracted to `server/src/maintenance/agent.ts` (`selectJob` +
  `executeJob`) — the single source of truth shared by the HTTP route and a server
  loop in `index.ts` (opt-in `AUTONOMY=on`, every `AUTONOMY_MS`≈5 min, re-entrancy
  guarded, skips no-op patrol). Gated by Research Mode + USD budget + **fuel** (all
  server-side already). `fly.toml` sets `auto_stop_machines='off'` for true 24/7.
- Still open: **job claiming/idempotency** (a `claimed_at`/lock so the server loop and
  an open browser tab can't double-execute the same job). Low-risk today (jobs are
  tend-guarded + mostly idempotent), but worth adding.
- Optional next: replace the fixed if/else ladder with an LLM "pick the next action"
  step over the maintenance ops exposed as **tools** — a real planning agent — keeping
  the deterministic ladder as the offline fallback.

## Phase D — Voice notes (BUILT — behind the `TELEGRAM_TTS_*` gate, OFF by default)

- **Voice replies:** browser TTS can't run server-side, so spoken Telegram replies
  need a cloud TTS service (e.g. an API that returns an OGG/MP3). Reuse the
  `shared/dramatize.ts` tone to pick prosody, send as a Telegram voice note, and
  keep text as the default/fallback. Gate behind a `TELEGRAM_TTS_*` key so the
  offline path is never broken.
- **Implementation:** `server/src/telegram/tts.ts` — `ttsConfig()` is the single
  gate truth source; the provider seam (`SpeechSynthesizer`) has one
  implementation, ElevenLabs, requesting `opus_48000_64` (OGG/Opus, which
  Telegram `sendVoice` accepts). `bot.ts`'s `deliverReply` speaks only
  *conversational* replies (agent-loop / GraphRAG answers); command replies and
  digests stay text. Prosody: `dramatize.ts` `toneFrom` + `prosodyFor` map onto
  ElevenLabs `voice_settings` (rate → `speed`, intensity → `stability`).
- **Fallbacks (text is the default AND the fallback):** gate off/incomplete,
  reply over the length cap (`TELEGRAM_TTS_MAX_CHARS` = 1000 chars, ~1–1.5 min
  of speech — also bounds per-reply TTS spend), provider error, or a failed
  `sendVoice` all deliver the plain text reply. With the gate off it is
  impossible to spend: no code path calls the provider or `sendVoice`.
- **Quota fail-soft (owner requirement):** ElevenLabs HTTP 402 (credits
  exhausted) is just another fallback — the text reply goes out, the fallback
  is logged, and the conversation continues. Voice credits running out can
  never break chat.
- **Audio cache (owner requirement):** synthesized audio is cached in the
  `tts_audio_cache` table under a hash of (voice, model, prosody, normalized
  text) — `server/src/telegram/ttsCache.ts`. An unchanged reply synthesizes
  exactly once, ever; replays make zero provider calls, survive restarts, and
  keep playing after the quota is gone. Bounded to the newest 500 entries.
- **Selective by default (owner requirement):** the quota is small (Starter
  plan ≈ 40k chars/month ≈ under an hour of speech), so `TELEGRAM_TTS_MODE`
  defaults to `selective`: a conversational reply is spoken ONLY when the
  chat opted in with `/voice on` (per-chat, `/voice off` to stop), or when the
  reply answers a voice message the user sent. `TELEGRAM_TTS_MODE=all`
  speaks every (speakable) reply — opt-in only, never the default.
- **To enable (owner's call — costs money per character):** set the
  `TELEGRAM_TTS_*` Fly secrets below and redeploy. Nothing is configured by
  default; no secrets were set as part of the build.

## Setup (one time)
1. In Telegram, message **@BotFather** → `/newbot` → copy the bot token.
2. Pick a long random webhook secret (any opaque string).
3. Set Fly secrets and redeploy:
   ```
   fly secrets set \
     TELEGRAM_BOT_TOKEN=123456:ABC... \
     TELEGRAM_WEBHOOK_SECRET=<random-string> \
     PUBLIC_URL=https://brain-soumaya-v1.fly.dev
   ```
4. On boot the server registers the webhook. Message the bot `/start`, then
   `/link <name> <passcode>` with the same credentials you use on the web app.

> Feature is fully opt-in: with no `TELEGRAM_BOT_TOKEN` nothing changes.
> Network note: the deployment must allow outbound HTTPS to `api.telegram.org`.

5. *(Optional, Phase D voice notes — PAID per character, off by default.)* To
   also hear conversational replies as voice notes, add the TTS secrets and
   redeploy:
   ```
   fly secrets set \
     TELEGRAM_TTS_ENABLED=1 \
     TELEGRAM_TTS_API_KEY=<redacted> \
     TELEGRAM_TTS_VOICE_ID=<elevenlabs voice id>
   ```
   With any of these missing the bot stays text-only and spends nothing.
   Enabling also needs outbound HTTPS to `api.elevenlabs.io`. Replies are
   spoken selectively by default (see Phase D) — add
   `TELEGRAM_TTS_MODE=all` only if you want every reply spoken.

## Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | to enable | BotFather token. Also enables the daily digest sweep. |
| `TELEGRAM_WEBHOOK_SECRET` | to enable | Verifies inbound webhooks (path + header). |
| `PUBLIC_URL` | for auto-register | Public base URL of the deployment. |
| `TELEGRAM_DIGEST_SWEEP_MS` | optional | How often to check for due digests (default hourly). |
| `TELEGRAM_TTS_ENABLED` | for voice notes | Phase D master switch: `1`/`true` enables voice replies. Unset/anything else = OFF (default). |
| `TELEGRAM_TTS_API_KEY` | for voice notes | ElevenLabs API key (Fly secret — never commit). |
| `TELEGRAM_TTS_VOICE_ID` | for voice notes | ElevenLabs voice id to speak replies in. |
| `TELEGRAM_TTS_PROVIDER` | optional | Provider selector; only `elevenlabs` is implemented (default). Any other value = feature off. |
| `TELEGRAM_TTS_MODEL_ID` | optional | ElevenLabs model (default `eleven_turbo_v2_5`). |
| `TELEGRAM_TTS_MODE` | optional | `selective` (default — speak only for `/voice on` chats and voice-message replies) or `all` (speak every reply). Any other value = selective. |
