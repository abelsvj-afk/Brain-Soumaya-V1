# Lore narration — ElevenLabs voice + music for the Book (design, 2026-10-30)

*Owner: "we're going to use the ElevenLabs API key to narrate all the text for the lore, so when people get to it and it pops up … it plays with some nice good music, and the reading for this mythic lore in the right tone and style." Spec before code (Rule #1). Builds on the Book (`docs/specs/lore-storage-2026-10-30.md`), Flavour (`story-flavor-engine-2026-10-30.md`) and the existing ElevenLabs seam (`server/src/telegram/tts.ts`, `ttsCache.ts`).*

## 1. The key insight: the lore text is public canon, so narration is shared
Unlike a Telegram reply, lore text is **identical for every player and contains nothing private**. So narration is generated **once per (entry, register, voice, text-hash)** and the audio is **shared across all brains** — a one-time cost, not per-player spend. A brain's *notes* and *memories* are never narrated by this path.

## 2. Architecture
```
Book card ─► play(entryId, register) ─► GET /api/story/narration/:entryId?register=plain|warm|grave
                                          │  server looks up the entry's text in CANON (never accepts text from the client)
                                          │  key = sha256(voiceId|modelId|settings|register|text)
                                          ├─ cache hit  → stream mp3 from the persistent volume (/data/lore-audio/<key>.mp3)
                                          ├─ miss + key → ElevenLabs once → write to volume → stream
                                          └─ no key / error → 204 → client falls back to browser speech (voice.ts) + captions
```
- **The endpoint takes an id, not text.** That closes the abuse hole (nobody can make the server speak arbitrary text on our key) and bounds spend to the size of the canon × 3 registers.
- **Key stays server-side** (a Fly secret, never committed, never sent to the client). Env: `LORE_TTS_API_KEY` (falls back to `TELEGRAM_TTS_API_KEY` so the existing secret works), `LORE_TTS_VOICE_NARRATOR`, optional per-role voices `LORE_TTS_VOICE_ETERNITY`, `…_VESH`, etc.; `LORE_TTS_MODEL_ID` (default a higher-quality model than the Telegram turbo one — the narration is long-lived and cached, so quality beats latency).
- **Pre-warm script** `scripts/lore-narrate.mjs` (owner runs once or after a canon edit): walks the canon, generates every missing clip, prints a cost estimate first (characters × rate) and asks to proceed. A canon text edit changes the hash, so only changed lines re-generate.
- **Offline / no key**: nothing breaks. The card shows its text with captions; "Listen" uses the browser's own speech (already shipped, `voice.ts`), tuned slow and low.
- **Cost guard**: a hard monthly cap on characters synthesized for lore (env), counted in the existing usage ledger; at the cap the endpoint returns 204 and the fallback speaks. Lore audio is **never** generated on a path a client can loop (cache-miss synthesis is single-flight per key and rate-limited).

## 3. Voice casting (tone: mythic, universal, never liturgical-of-a-real-religion)
| Role | Who | Delivery |
|---|---|---|
| **The Narrator** | all object-text, accounts, sights | low, unhurried, a little weathered; pauses at commas; no drama — the open ring is *implied*, never performed |
| **Eternity** | his lines (wake-ups, visitations) | warm, spare, very slow; breath audible; a trace of grief |
| **Vesh** | her lines | soft, tired, kind; the end of lines falls away |
| **Cast voices** (optional, later) | Calend, Oru, Sethane, Ysmerel, Dorrow, Hesk, Tamsin, Ossian, Kith (a child) | one distinct voice each, chosen in the ElevenLabs library by the owner; Kith must sound like a child, never imitated from a real person |
Registers (Flavour) map to **delivery settings**, not different words: `plain` = baseline, `warm` = more stability + slightly faster, `grave` = slower, more style. Settings live in one table (`NARRATION_SETTINGS`) so the owner can tune them by ear.
**Never**: an AI voice imitating a real person; a voice that "performs" the Hush's face; narrating her name (there is none to narrate).

## 4. Music (the "nice good music")
- **Reuse the existing ambient bed** (`graph/audio.ts`): on narration start, **duck it to ~20 %** over 600 ms, restore over 1.2 s on end. If the user has music off, a quiet **lore bed** may fade in only for the duration of the narration (opt-in setting; default: no new music is forced on anyone).
- **Lore beds**: 3–4 short looping stems — *Morning* (First Light/Deep Past), *Hearth* (People/Growing), *Hush* (Quiet/Archive, the Hush's faces), *Standing* (Eternity). Sourced by the owner/Muse (same pipeline as the other audio); until they exist, ducking the current ambient track is the whole behaviour.
- **Hours Clock** (lore Draft 4 §9) can pick the bed; **Flavour tint** may shift the bed's filter (brighter/darker), never the notes.
- The Eighth Bell and the Laugh are **silences by design**: narration never speaks over them, and the Laugh is never rendered as audio.

## 5. The reveal ("when it pops up")
A first-time find opens the Book's **reveal card**: the object glows in, the text appears **a sentence at a time in sync with the voice** (captions are the same text; sync uses sentence boundaries, not per-word timing), the bed ducks/fades in, then it settles into the normal card. Rules:
- **Autoplay needs a gesture.** The very first narration of a session starts only after a tap (a quiet "Listen" chip is shown, and the app's first interaction already satisfies the browser policy on most paths); otherwise the card shows the chip and never errors.
- **Skippable and silent-by-default for people who want it**: one setting, "Narrate the lore" (on / ask each time / off), per device. Muting the app's audio mutes narration.
- **Accessibility**: captions always on-screen; full transcript is the card text; the audio is never the only carrier of meaning; `prefers-reduced-motion` removes the glow/sync animation (the text simply appears) but the audio still plays if enabled.
- **Data Saver / 2G**: no preloading; a clip streams on demand only.
- **Weight**: ~40–90 words ≈ 20–40 s ≈ 150–350 KB per clip at 64 kbps mono; nothing downloads until played; the service worker caches played clips (extend the persistent assets cache to `/api/story/narration/`, GET-only, immutable by hash).

## 6. What it must never do
Block the Book when audio fails · call ElevenLabs with player-written text · expose the key · play without the user having enabled narration or tapped Listen · narrate a note · change what the words say (a register changes *delivery*, never claims) · become a timer.

## 7. Build order (each shippable)
1. **Web player + fallback** (`useNarration`: audio element with ducking event, browser-speech fallback, captions) — works with no server support.
2. **Server endpoint + cache + single-flight + char cap** (`story/narration.ts`, `GET /api/story/narration/:id`), tests with a fake synthesizer (no network in tests).
3. **Pre-warm script** + cost estimate.
4. **Reveal card sync**, then lore beds when the stems exist.
Red-Zone: the endpoint contract and the spend guard stay with Claude.
