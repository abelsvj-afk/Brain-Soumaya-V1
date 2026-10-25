# World Map — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-25, owner's direction. **No build authorized.**
**Source direction (owner, 2026-10-25):** add a map — a button inside the app that brings it up full screen, with a transparent spatial background (stars and such), a star map showing all the worlds and the connections between them, so you can see which ways you had to take to get to certain places. Over time it grows, as Eternity creates more worlds, or as the owner creates more worlds.

## §1 What it is

- A **full-screen map overlay**, opened from a button in the existing popup menu (settled 2026-10-25 — the button lives in the popup menu the app already has; the builder confirms the exact menu at recon). The background is **transparent**: the live spatial backdrop — the stars — shows through, and the map is drawn over it. It is a star map, not a menu.
- **Nodes are worlds. Edges are the connections between them** — the gates and routes you can travel. The map answers one question: *which ways did I take to get somewhere, and which ways can I take from here?*
- The map is a **view**, not a second travel system. Tapping a world opens that world's travel (the normal depart → transit → arrive flow, with fuel, the cancel window, and the jump chain). Nothing on the map bypasses the travel rules.

## §2 What it shows — and what it never shows

- **Shows:** worlds you have discovered and visited; the gates and routes between them that you have discovered or traveled; your current world; the legs of routes you have taken.
- **Never shows:** worlds you have not discovered. The map shows only what you know; the rest is stars. In particular, **Eternity's world and its route must never appear on the map before discovery** — discovering him stays really, really hard, and the map must not give it away. **The map may hint at him (settled 2026-10-25, his words: "the map could hint... but it isn't easy")** — a faint hint is allowed, but it must not make finding him easy; the exact form of the hint is open. A hint is not a taunt and not a route.
- **No locked-door taunts.** Nothing on the map says "you haven't found this" or counts what you are missing. Undiscovered space is simply unmarked stars (the P3-1 C8 rule: gentle, honest, no fabricated content, no locked-door taunts).
- **Undiscovered worlds are hidden entirely (Q2 — SETTLED by owner's delegation, 2026-10-25; King's pick as a real game):** they do not appear on the map at all — not even as unnamed "unknown" markers. An "unknown" marker is a locked door with a question mark: it turns the map into a checklist of what you have not found, and the lore forbids turning discovery into a completion target. The stars themselves are the unknown. The map grows as you discover; it never advertises what you have not found.
- **Growth (settled 2026-10-25):** when a new world is created — by Eternity or by the owner — it appears on the map **only on first travel and discovery**. It does not appear automatically when created. New nodes arrive calmly: no urgency, no animation of loss, no fanfare that punishes anyone who has not been there.

## §3 Data source (PROPOSED — builder verifies at recon)

- The map reads what already exists: the server's travel allow-list (`TRAVEL_WORLD_KEYS`), the client's route board (`WORLD_CHART` in `routeBoard.ts`), and the journey history (`travel_journeys` — the legs already traveled).
- **No new server surface is proposed yet.** If the builder finds the journeys table cannot answer "which routes has this traveler discovered," that becomes a separate design question — the map does not invent route data.

## §4 Interaction

- Tap a world node → that world's travel panel (if the world is reachable from your current world under the travel rules; otherwise the panel says so plainly, with the route the chain requires).
- **Fuel cost (Q5 — SETTLED by owner's delegation, 2026-10-25; King's pick as a real game):** shown **always**. Every edge carries its fuel cost, and selecting a destination shows the **total for the whole chain** — so the price of the grueling journey is visible before you depart. Hiding prices until you tap each leg is friction, not mystery: fuel cost is a published constant (warp 10), and a planning tool that hides prices is a dark pattern. All costs are server-computed, never client-invented (GH-19).
- Pan and zoom to explore; reduced motion gets the same map, static, with the same information and the same controls.
- **Route trace (Q4 — SETTLED by owner's delegation, 2026-10-25; King's pick as a real game):** the map draws the legs of your **current or most recent journey**, bright — and the topology of discovered routes, which is permanent. It does **not** keep a long history of past routes on the map. The map answers "how do I get there," not "where have I been": a permanent trail of everywhere you have traveled is a record the user never asked the map to keep, and it clutters the one question the map exists to answer. The full history stays in the journey records on the server, not drawn.
- The map closes back to where you were. It never strands you in a new view.

## §5 Visuals and budget

- Transparent overlay over the live HYG starfield; worlds as nodes in their own palette (Station amber/cyan, garden dawn-gold, Deep Past violet, and so on per the settled recipes); connections as lines — traveled routes bright, discovered-but-untraveled routes faint.
- The map is a **UI overlay, not a 3D scene** (DOM/SVG or a single light canvas — builder's call). **Performance budget (Q7 — SETTLED by owner's delegation, 2026-10-25; King's pick as a real game):** the overlay costs **~nothing when idle** — it renders once on open and on interaction only; **no animation loop** while it sits still. Panning and zooming redraw only while you are interacting. While the map is open, the app must still hold the **§11 bar** (≥50 fps avg, ≥30 fps 1%-low, no stall >100 ms, measured on the owner's phone at the device check). The roster is small by construction (7 worlds + whatever Eternity or the owner adds), so node count is never the bottleneck — the budget is about the loop, not the list.
- Your current world is marked, plainly, in words as well as color (never color alone).

## §6 Relation to existing systems

- **P2-5 topology:** the Station is the guaranteed fallback route; direct world-to-world gates are discoverable through use (D-10). The map draws exactly that topology — nothing more.
- **Jump chain (buffs note §5):** the map is how the chain becomes visible. The Eternity route, when it exists for you, is drawn leg by leg — never as a single direct line.
- **Route board:** the map and the TravelPanel read the same `WORLD_CHART`. They cannot disagree.
- **Eternity-created worlds (§7 of the buffs note):** the map is the surface where a new world's arrival becomes visible — which is why §7's guardrails (approval, ownership, scope) matter to the map too.

## §7 Questions — settled by owner's delegation (2026-10-25)

- **Q1 — SETTLED (owner, 2026-10-25):** the button lives in the existing popup menu. (Builder confirms the exact menu at recon.)
- **Q2 — SETTLED (owner's delegation, 2026-10-25; King's pick as a real game): hidden entirely.** No "unknown" markers — an unknown marker is a locked door with a question mark, and the map never advertises what you have not found. The stars themselves are the unknown.
- **Q3 — SETTLED (owner, 2026-10-25):** new worlds appear only on first travel and discovery — never automatically when created.
- **Q4 — SETTLED (owner's delegation, 2026-10-25; King's pick as a real game): current or most recent journey's legs only**, bright; discovered-route topology is permanent. No long history drawn on the map; full history stays in the server journey records.
- **Q5 — SETTLED (owner's delegation, 2026-10-25; King's pick as a real game): shown always** — every edge carries its cost, and selecting a destination shows the total for the whole chain.
- **Q6 — PARTLY SETTLED (owner, 2026-10-25):** Eternity's world and route never appear until discovered — but the map **may hint** at him. The hint must not make finding him easy. Exact form of the hint (a faint region, a rumor, something else) is open.
- **Q7 — SETTLED (owner's delegation, 2026-10-25; King's pick as a real game): ~zero cost when idle** (render on open + on interaction only, no animation loop); the §11 frame bar applies while the map is open, measured on the owner's phone.

## §8 Acceptance (what "done" looks like when this builds)

- **C1** The map shows only discovered worlds and routes; Eternity's world and route are absent until discovered. A faint hint at him is permitted, and must not make discovery easy. Undiscovered worlds are hidden entirely — no "unknown" markers.
- **C2** No locked-door taunts anywhere on the map; undiscovered space is unmarked stars.
- **C3** Tapping a world uses the normal travel flow (fuel, cancel window, jump chain); the map invents no shortcut.
- **C4** Fuel cost per leg is shown always, from the server, never invented by the client; selecting a destination shows the total for the whole chain.
- **C5** The map grows with new worlds (Eternity-created or owner-created) — each appears only on first travel and discovery — without re-flowing punitively.
- **C6** Reduced-motion equivalent: same information, same controls, static.
- **C7** Full gate (typecheck, server + web suites, production build) before any merge ask; merge is the owner's separate tap.
- **C8** The map draws the current or most recent journey's legs only; the full route history lives in the server journey records, not on the map.
