# Story roads — a tracker for the side quests (2026-10-31)

Draft 8 holds 36 **roads** (side quests). Rule #1 spec; owner direction: "side quests are possible", no score, no timer, no loss, nothing required, roads **rest**.

## Principle
A road is not a new input surface. Every step is already something the app can see: a **find** (an entry reached by stillness/relic/NPC) or a **meeting** with a cast member. The road only **names** the order and says it in words. So:
- Progress is **derived** from `story_finds` + NPC meetings; the server stores only whether *this brain took the road, rested it, or finished it* — never a step counter that could drift.
- Steps are ordered: a step counts once every earlier step does. Reaching a later find first simply leaves the road waiting at the earlier line (never an error, never lost).
- No "N of M", no percentage, no "locked". The road card shows the **one current line**, earlier lines as quiet past text, and, when finished, a gift line.

## Data (shared/storyRoads.ts, pure, tested)
`StoryRoad { id, world, giver (cast id), title, offer (giver's words), steps[{ id, line, signal }], gift }`, `signal = { find: entryId } | { meet: npcId, min }`.
Tests pin: every `find` is a real entry; every giver is a real cast member who visits the road's world; ids unique; no digits or banned words in any text; no road requires a mutually exclusive pair.

## Server (later slice)
Table `story_roads(space_id, road_id, taken_at, rested_at, completed_at)` (additive, schemaSql + migrateSchema). `GET /api/story/roads` → each road the brain can see (a road is offered only after the giver has been met once) with `state: offered|walking|resting|done` and the current line. `POST /roads/:id/take|rest` (idempotent). Completion is stamped on read when the last signal is true. All space-scoped.

## Web (later slice)
Talk panel: when the giver has a road to offer, an extra choice "Is there something I can do for you?" → the offer + Take / Not now. The Book gets a quiet "Roads" tab: walking roads show the current line, resting roads sit lower, done roads show their gift. Reduced-motion and colour-not-alone apply as everywhere.

## First roads (this slice, all signals already exist)
2 A Door Closed (Hesk) · 3 The Seventh Berth (Wim) · 4 What the Wayfarer Left in the Coat (Calend) · 5 The Tall Tale's Second Verse (Ossian) · 6 The Cartographer's Margin (Ilsabet) · 11 The Open Alcove (Archivist) · 13 The Hymn That Rests (Ysmerel) · 14 The Penitent's Shelf (Archivist). Roads whose steps need new scene interaction (carry a patch, float a boat, count layers) wait for their own scene work.
