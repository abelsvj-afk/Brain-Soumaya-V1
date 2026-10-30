# Muse task — lore music beds (and ElevenLabs-friendly stems)

*Owner request (2026-10-30): "I'm still gonna want the lore music beds. I'm gonna see if Muse can do that." If Muse cannot produce audio, say so plainly and stop — the owner has other generators. Spec: `docs/specs/lore-narration-2026-10-30.md` §4.*

## What they are
Short, seamless, **looping instrumental beds** that sit under the narrated lore. They play quietly while a voice reads (the narrator is a calm, low, weathered male voice), and fade in only for the duration of the reading. They must **never fight the voice**.

## The four beds
| Bed | Used for | Mood / palette | Instruments to lean on |
|---|---|---|---|
| **Morning** | First Light, the Deep Past, the basin; Oru's lines | awe, first light, remembrance | slow pad, soft bowed strings, a single high bell; very slow swells |
| **Hearth** | People, the Growing Place; Nuaré, Maren, Tamsin, Kith | warmth, patience, tenderness | low warm drone, soft plucked/felt piano, faint wooden flute, breath-like pads |
| **Hush** | the Quiet/Archive, the Hush's faces, Vesh, the Sitters, the Sleepwalker | hollow, hushed, grief held gently | very sparse; distant glass tones, long reverb tails, a ghosted choir with one gap (a held breath) |
| **Standing** | Eternity's world, the Long Room, the Eighth Bell | vast, white, still | wide pad, sub-low drone, tiny bright overtones; an almost-silent heartbeat-length pulse |

## Technical spec
- **Length:** 60–90 s each, **seamless loop** (no click at the seam). Provide the loop point.
- **Level:** mastered quiet (about −24 LUFS integrated, peak ≤ −3 dBFS) so the app can play them at full while the voice stays on top; **little energy between 1–4 kHz** (the voice's intelligibility band).
- **Format:** MP3 128 kbps stereo (plus the WAV if possible). Target ≤ 1.5 MB each.
- **No vocals/words**, no lyrics, no real-world religious chant, no recognisable melodies from existing music. Mythic and universal; Elden-Ring-quiet, not trailer-loud.
- **Names:** `lore-bed-morning.mp3`, `lore-bed-hearth.mp3`, `lore-bed-hush.mp3`, `lore-bed-standing.mp3`.
- The owner uploads binaries to `packages/web/public/audio/` (the connector cannot push binaries).

## Also useful (optional)
- A 6-second **sting** for a new find ("a light is added"): one soft chime, no decay > 2 s. `lore-sting-find.mp3`.
- Silence matters: the **Laugh** and the **Eighth Bell** are *silences by design* — do not write music for them.

## Report back
Which beds you could produce, how, loop points, and the loudness measured. If you cannot generate audio, say so.
