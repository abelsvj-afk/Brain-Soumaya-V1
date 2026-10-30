# The hive society — NPCs with lives, factions, faith and governance that mirror the brain (owner 2026-10-30)

Owner: NPCs should have jobs for their world and lives of their own — making money, getting fuel, trading, travelling, discussing, doing their work. They are not
"agents": each has an individual personality, but they are activated together "like a mind hive, like bees" — each follows a **calling** or guidance. Most believe in
Eternity, some don't, and that fluctuates with the user's faith and memories. Think of the whole human range — greed, appetite, control, goodness, kindness, giving,
Christ-like or its opposite — and let the brain's colour show in how groups of NPCs behave and interact. They follow a governance; there are sectors, groups, factions.
"You never see the same thing twice": they always have goals and aspirations, and are always doing something.

## What I am building, and the line I am drawing
- **A mirror, not a verdict.** The society reflects *what runs through your galaxy lately* (named currents), never a "good person / bad person" score. Nothing in the app
  ever labels the user. The product rules already forbid shaming and guilt (Stakes settlement; Eternity "never threatens, shames, commands, diagnoses"); a moral
  scorecard would break them and would also simply be inaccurate — memories are not deeds. Light and shadow both show up as *weather in the world*, and shadow is met with care.
- **Private by construction.** Currents are computed from this brain's own data, on the server, as small aggregates (numbers + words like "giving: strong"). The text of a
  memory never reaches a model for the society (only Eternity's own brief carries memories, as the owner already decided). Per brain; never crosses brains.
- **Optional.** Settings → "Let the society reflect my brain" (default on). Off = a neutral, fixed society (still alive, doing its jobs), and no currents are computed or sent anywhere.
- **Honest about being a heuristic.** Currents come from simple word-and-weight counting over recent memories (offline, free, deterministic). "Why?" in the panel says so.

## The currents (the brain's colour)
Seven named currents, each 0..1 and relative to *this* brain's recent window (last 90 days, up to 400 memories):
reverence (faith, prayer, gratitude toward God, scripture) · giving (generosity, service, forgiveness, kindness) · ambition (building, earning, goals) · appetite (craving,
indulgence, temptation — deliberately broad; no inference about anyone's sexuality) · friction (conflict, anger, resentment, control) · weight (grief, loneliness, fatigue, worry) ·
peace (rest, calm, joy, contentment). **brainColor** = their weighted blend as a hue (a swatch in the panel; the words are the real information). **belief** (the society's
faith tide, 0..1) rises with reverence and peace and sags with weight and friction — it is what makes believers waver or firm up.

## Factions (provisional names — the owner can rename; no canon claimed)
- **The Choir** — keepers of Eternity's word; believers. Lifted by reverence + peace.
- **The Open Hand** — givers and healers; tend the weary. Lifted by giving; answer weight with care.
- **The Ledger** — traders, makers, fuel brokers. Lifted by ambition (and tempted by appetite).
- **The Undertow** — doubters and dissenters; questions Eternity and the Wardens. Lifted by friction and by low belief.
- **The Wardens** — order, patrols, ordinances. Lifted by friction and appetite (they hold the line).
Each faction has a standing (how much it is felt in this brain today), a charter, and a **calling**: a daily guidance chosen from its standing + the currents + the day's seed.

## Each NPC
Cast members gain: a **faction**; a **faith baseline** (−1 doubter … +1 devout; a person's own temper, never overwritten) and a **susceptibility** to the tide; **goals/aspirations** (what they
want this season); and traits. Their day is activity from a deterministic, clock-driven plan: *work, trade, refuel, travel, discuss, worship, rest, patrol, wander* — chosen per half-hour
from {their job} × {their faction's calling today} × {their own temperament}, in the world where they are (shared/npcs.ts location). Partners are picked deterministically so two NPCs in the same
world *trade* or *debate* together ("debating Eternity with the Dissenter"). Captions are words, never colour alone. **Governance:** each world has a governing faction; each day it issues an
**ordinance** (open hands, market day, quiet watch, festival, fast, free berth…) shaped by the currents; NPCs respond to it, and it is shown in the panel. Everything is a pure function of
(day, slot, currents) — server and web compute the same thing, no hive state to keep in sync.

## Words
The one daily batched call (docs/specs/npc-daily-script-2026-10-30.md) gains a plain-language **society brief** (currents as words, today's calling/ordinances — no memory text) and a **chatter**
situation per NPC, so what they say when overheard fits the day. Offline each has templated chatter. Still one call per brain per day.

## Surfaces
- **Society panel** (Tools → Society): the day's currents as words + bars, the brain colour swatch, each faction's standing and calling, per-world ordinance, "who's doing what", "Why?", and the off switch.
- **In the worlds:** tags and cards say what each NPC is doing and with whom, their faction and (in words) their faith; overheard chatter appears in the card.

## Not built / owner questions
Faction names and lore (provisional until the lore session); NPCs affecting your real data (they never do); a true economy (their money/fuel is flavour + captions, not a ledger); faction wars or
visible consequences beyond behaviour and words; invitation into personal brains (still future). Question for the owner: is "Society reflects my brain" on by default for *other* people's brains, or opt-in?

## Acceptance
Pure: currents scoring is deterministic, bounded, and responds to the right words; belief moves the right way; each NPC's activity is deterministic and varies across slots; partners are
mutual; ordinances depend on the governing faction + currents; a neutral society when reflection is off. Server: the route returns words + numbers only, never memory text; off = neutral and
computes nothing. Browser: tags show varied activities that change with the clock; the Society panel shows currents, factions and ordinances.


## Owner decisions (2026-10-30)
- **Reflection is ON by default** for every brain (including other people's), with the opt-out switch in the Society panel. Off = neutral society, nothing read. (Already how it is built.)
- **Faction names stay provisional** (the Choir, the Open Hand, the Ledger, the Undertow, the Wardens) and are **renamed in the lore session**. Renaming is data-only: `FACTIONS` in
  `shared/society.ts` (names, taglines, charters, callings) and the cast rows in `shared/npcs.ts`; ids are internal and need not change.

## Not built yet (the backlog, in the order I would take it)
1. **Lore content** — canon names, histories, `lore.layers` (deeper threads unlocked by meetings, keys linking NPCs), the open-ring "never explain, leave threads" content. Waits for the lore session.
2. **Faction consequences** — standing changes only behaviour and words today. Not built: factions that gain/lose territory or ordinances that change what you can do, visible faction events, rivalries and alliances between factions.
3. **A real NPC economy** — NPC money, fuel, prices and trades are captions, not a ledger. Not built: persistent NPC purses/fuel, prices that move with trades, anything that touches your own fuel.
4. **Per-faction visuals** — ships, trails and tags are per NPC, not per faction (no faction colours on hulls, banners, ordinance decorations in the worlds).
5. **NPC acts beyond words and presence** for the ambient cast (only the harbor controller and Eternity have act loops); NPC-to-NPC conversations written by the model (today: templated + one-line chatter).
6. **Invitations into personal brains** — NPCs (and later other players) can never enter a personal brain; the invitation flow is a future feature and nothing here prepares a back door.
7. **Currents tuning** — the lexicon is plain word stems; tune `CURRENT_LEXICON` once real brains show what it misses. No model-based reading of themes (deliberately: private, offline, free).
8. **Settings surface** — the switch lives in the Society panel only (not duplicated in Settings).
9. **On-device confirmation** of everything above (all measured headless only).
