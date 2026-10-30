# NPC daily script — one batched model call per brain per day (owner 2026-10-30)

Owner: "give NPCs the API key … one dump per day for all the NPCs, however many … know what everything is going to be for the 24-hour set, get that done
in one call (or two), and batch everything they're going to say, every encounter, everything that needs the key."

## Design
- **One call, all NPCs.** For a brain's local day the server builds ONE prompt holding every NPC's persona + the situations it needs lines for + a small,
  per-NPC brief, and asks for JSON `entries: [{npc, situation, lines[]}]`. A roster of 3 or 30 is still one call (the prompt grows, the call count doesn't).
- **What is in the script (per NPC, per situation, 3–4 variants each):** the harbor controller — `encounter_patrolling`, `encounter_docked`,
  `encounter_first`; Eternity — `encounter_arrival`, `encounter_first`, `wake`, `visitation`. Adding an NPC = rows in `NPC_SCRIPT_SPECS`.
- **Lazy, so a quiet brain costs nothing:** generated the first time the day's lines are needed — the web asks when you enter a world with NPCs; Eternity's
  contact scheduler asks when his wake-up/visit is due. Cached in `npc_day_script` (additive table) keyed by space + local day: every later need that day is a
  free read. A failed call retries at +3 / +6 / +12 minutes (stored, so a restart keeps the schedule), then the day uses the offline lines — never an error.
- **Which key:** the same line Eternity already has — the free Gemini key first (own provider, metered in the usage ledger, stopped by the spend budget),
  else the shared provider, else no model (offline lines). Never a hard dependency.
- **Privacy (owner allowed memory text for Eternity only):** Eternity's brief carries the same ≤5 recent weighty memories as his current voice; the harbor
  controller's brief is travel facts only (where the ship is, fuel, last journey) — no memory text.
- **Fence kept:** the controller still only answers. Her encounter lines are third-person DESCRIPTION of what she is doing (the prompt forbids quoting her and
  any question/instruction to the visitor); Eternity's are his own atmosphere/wake words as today. Every line is length-capped and cleaned (`cleanLine`); a
  situation the model under-delivers is topped up from the offline lines. Facts that must be exact (routes, prices, the controller's answers/welcome) stay
  deterministic code, not model text.
- **Eternity's contact** (`wake`, `visitation`) now takes its line from the day's script when present (one of the variants, chosen by the day's seed), and
  only falls back to the existing per-occasion call + retries when the script has none — so the calls collapse from up to 2–3 a day to 1.
- **Web:** `GET /api/npcs/script` returns today's lines (never another brain's); the encounter note picks a variant by meeting count; offline lines otherwise.

## Cost
One request ≈ 1.5–2.5 k tokens in, ~1 k out per brain-day, regardless of roster size up to ~30 NPCs.

## Acceptance
Unit: one model call per day however many reads; failure → retry schedule → offline lines; under-delivery topped up; lines cleaned/capped; Eternity wake uses a
scripted line with no extra call; script route scoped to the space. Browser: entering the Station shows a scripted (model) encounter line when a voice is set,
the offline line otherwise.
