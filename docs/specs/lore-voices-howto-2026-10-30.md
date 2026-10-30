# Getting the narrator (and character voices) working — plain steps

You need ONE thing on Fly and everything else happens inside the app.

## 1. The only Fly secret that matters: your ElevenLabs API key
Fly dashboard → your app → **Secrets** → add `LORE_TTS_API_KEY` = your ElevenLabs key (ElevenLabs → profile → API Keys). If you already set `TELEGRAM_TTS_API_KEY`, that works too. Redeploy/restart.
*(If only a voice id was set before and no key, that is exactly why you heard your phone's voice: the studio voice needs the key AND a voice.)*

## 2. Pick voices inside the app (no more secrets)
Open **Tools → The Book** (your brain must be the owner brain — `OWNER_SPACE_IDS`). Scroll to **Voices (owner)**:
- It shows whether the studio voice is on, and if not, the exact reason.
- Under **Voices on your ElevenLabs account** each voice has **Hear** (a sample), a **Give to…** menu and **Use**.
- Give one voice to **The Narrator**. That is enough — every character without a voice of their own is read in the Narrator's voice.
- Optionally give other voices to **Eternity, Calend, Ysmerel, Dorrow, the Dissenter, the Surveyor, the Archivist, the Keeper**. Press **Test** next to any role to hear it say a line.
- **Clear** sends a role back to the Narrator.
A voice chosen here beats a Fly secret, so you never need to edit secrets to change who speaks.

## 3. If it still uses your phone's voice
Look at the line under the Book's settings: **"Narrator: this device's voice — <reason>"**. The reason is one of:
- *no ElevenLabs API key is set* → step 1.
- *no narrator voice is chosen* → step 2.
- *ElevenLabs refused the request (HTTP 401)* → the key is wrong; *(HTTP 402)* → out of credits; *(HTTP 404/422)* → that voice id is not usable on this account.
- *this month's character cap* → raise `LORE_TTS_MONTHLY_CHARS`.
- *this device would not start the audio* → tap Listen again.

## Cost
Each line is voiced once per voice and shared by everyone afterwards. Roughly 146 lines ≈ 29,000 characters for the Narrator; each character voice only adds its own few lines (11 reaction lines in total).
