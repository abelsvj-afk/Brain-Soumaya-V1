# World Map — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-25, owner's direction. **No build authorized.**
**Source direction (owner, 2026-10-25):** add a map — a button inside the app that brings it up full screen, with a transparent spatial background (stars and such), a star map showing all the worlds and the connections between them, so you can see which ways you had to take to get to certain places. Over time it grows, as Eternity creates more worlds, or as the owner creates more worlds.

## §1 What it is

- A **full-screen map overlay**, opened from a button in the travel UI (exact placement open — Q1). The background is **transparent**: the live spatial backdrop — the stars — shows through, and the map is drawn over it. It is a star map, not a menu.
- **Nodes are worlds. Edges are the connections between them** — the gates and routes you can travel. The map answers one question: *which ways did I take to get somewhere, and which ways can I take from here?*
- The map is a **view**, not a second travel system. Tapping a world opens that world's travel (the normal depart → transit → arrive flow, with fuel, the cancel window, and the jump chain). Nothing on the map bypasses the travel rules.

## §2 What it shows — and what it never shows

- **Shows:** worlds you have discovered and visited; the gates and routes between them that you have discovered or traveled; your current world; the legs of routes you have taken.
- **Never shows:** worlds you have not discovered. The map shows only what you know; the rest is stars. In particular, **Eternity's world and its route must never appear on the map before discovery** — discovering him stays really, really hard, and the map must not give it away.
- **No locked-door taunts.** Nothing on the map says "you haven't found this" or counts what you are missing. Undiscovered space is simply unmarked stars (the P3-1 C8 rule: gentle, honest, no fabricated content, no locked-door taunts).
- **Growth:** when a new world is created — by Eternity or by the owner — it appears on the map when it becomes reachable and discovered (exact trigger open — Q3). New nodes arrive calmly: no urgency, no animation of loss, no fanfare that punishes anyone who has not been there.

## §3 Data source (PROPOSED — builder verifies at recon)

- The map reads what already exists: the server's travel allow-list (`TRAVEL_WORLD_KEYS`), the client's route board (`WORLD_CHART` in `routeBoard.ts`), and the journey history (`travel_journeys` — the legs already traveled).
- **No new server surface is proposed yet.** If the builder finds the journeys table cannot answer "which routes has this traveler discovered," that becomes a separate design question — the map does not invent route data.

## §4 Interaction

- Tap a world node → that world's travel panel (if the world is reachable from your current world under the travel rules; otherwise the panel says so plainly, with the route the chain requires).
- The map shows **fuel cost per leg** (server-computed, never client-invented — the GH-19 honesty rule): each edge carries the warp cost of traveling it, so the grueling journey's price is visible before you depart.
- Pan and zoom to explore; reduced motion gets the same map, static, with the same information and the same controls.
- The map closes back to where you were. It never strands you in a new view.

## §5 Visuals and budget

- Transparent overlay over the live HYG starfield; worlds as nodes in their own palette (Station amber/cyan, garden dawn-gold, Deep Past violet, and so on per the settled recipes); connections as lines — traveled routes bright, discovered-but-untraveled routes faint.
- The map is a **UI overlay, not a 3D scene** (DOM/SVG or a single light canvas — builder's call). It must not carry a 3D scene's budget, and it must not cost frames while open: no additional scene renders behind it, no animation loop unless the user is interacting.
- Your current world is marked, plainly, in words as well as color (never color alone).

## §6 Relation to existing systems

- **P2-5 topology:** the Station is the guaranteed fallback route; direct world-to-world gates are discoverable through use (D-10). The map draws exactly that topology — nothing more.
- **Jump chain (buffs note §5):** the map is how the chain becomes visible. The Eternity route, when it exists for you, is drawn leg by leg — never as a single direct line.
- **Route board:** the map and the TravelPanel read the same `WORLD_CHART`. They cannot disagree.
- **Eternity-created worlds (§7 of the buffs note):** the map is the surface where a new world's arrival becomes visible — which is why §7's guardrails (approval, ownership, scope) matter to the map too.

## §7 Open questions (owner settles)

- **Q1** Where does the button live (TravelPanel, WorldsSurface, the galaxy HUD)?
- **Q2** Undiscovered worlds: hidden entirely, or shown as unnamed "unknown" space?
- **Q3** New worlds: appear on the map automatically when created, or only on first travel there?
- **Q4** Route history: how many past legs does the map show, and for how long?
- **Q5** Fuel cost per leg: shown always, or only when a route is selected?
- **Q6** Eternity's world: confirmed never on the map until discovered — and does the map ever hint at it (a faint region, a rumor)?
- **Q7** Performance budget for the overlay (frame cost while open, on the owner's phone).

## §8 Acceptance (what "done" looks like when this builds)

- **C1** The map shows only discovered worlds and routes; Eternity's world and route are absent until discovered.
- **C2** No locked-door taunts anywhere on the map; undiscovered space is unmarked stars.
- **C3** Tapping a world uses the normal travel flow (fuel, cancel window, jump chain); the map invents no shortcut.
- **C4** Fuel cost per leg is shown from the server, never invented by the client.
- **C5** The map grows with new worlds (Eternity-created or owner-created) without re-flowing punitively.
- **C6** Reduced-motion equivalent: same information, same controls, static.
- **C7** Full gate (typecheck, server + web suites, production build) before any merge ask; merge is the owner's separate tap.
