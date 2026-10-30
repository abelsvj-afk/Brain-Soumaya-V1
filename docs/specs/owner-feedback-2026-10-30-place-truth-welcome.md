# Owner feedback 2026-10-30 — the app must always know where you are; the welcome card must describe the app as it is

Owner: "when you load into the app … you might be in your galaxy, but if you want to travel somewhere it says you're somewhere else … the map or
the travel button section should always know presently where you are." And: "the welcome card with Soumaya, on any world or in your main brain,
should always reflect what's actually there and what the app actually is now — it only reflects the brain."

## 1. Place truth
- **Cause (measured):** the app always OPENS in the home galaxy, but the server's ledger derives "where you are" from the latest journey. If the
  last session ended in a world (app closed there, or the old instant "← Galaxy" which only hid the layer), the ledger still said that world — so the
  travel panel and the world map named a place the screen wasn't showing. Reproduced: server `growing-place`, app open on the galaxy.
- **Rule:** the screen and the ledger never disagree. Opening the app while the ledger says "out in a world" and **no journey is active** settles it
  once: the server writes a free, already-arrived leg home (`POST /api/travel/recall-home`, `TravelRepo.recallHome`). A journey in progress is the truth
  and is left alone. Never charges, never pays a bonus; idempotent; space-scoped. The instant-return fallback of "← Galaxy" calls it too.
- It ends an Eternity chain outing exactly as a real return home would (the chain only counts arrivals since you last left home).

## 2. Welcome card
- The first-run card (`WelcomeIntro`) now also names **Worlds** (places built from your life, reached by ship; Tools → Travel / World map; the HUD stays;
  "← Galaxy" brings you home) and that capturing earns the fuel warps spend. Opened away from home it adds "You are in <world> right now."
- The Observatory (the "welcome back" card, reachable as Briefing in every world) now knows the place: its sub-line says "in <world>", and a **place card**
  states what the world is for (the same one-liner as the first-arrival hint) with **Warp back to your galaxy** (the same warp as ← Galaxy).
- Plumbing: the worlds layer already announced `worlds:surface-visible`; it now carries `world` and `transit`, read by `useWorldPlace()`.

## Acceptance (measured)
Server `growing-place` + app opened → server `home` after load (travel panel + map agree). Observatory inside the Growing Place shows the place card;
its button starts the warp home (free). Unit tests: `recallHome` (once, idempotent, active journey untouched, space-scoped), place hook, card, welcome copy.
