# Owner feedback 2026-10-30 — exits, warping home, distance fuel, Growing Place to 100 %

Owner: "I love it. A few things: (1) returning after travelling, Soumaya should warp back too, not pop up instantly in the home
galaxy; (2) opening the world map and Soumaya chat there is no way to exit — chat has no ✕, the map doesn't work; (3) 10 fuel to
everywhere, no — it needs to correspond to distance; (4) the Growing Place loop is fun but needs better ways to understand what to
do and when you hold something or an activity is under way — it is a 75 %, make it 100 %."

## 1. Exits (measured, 412×915 and 360×640, home and in a world)
- **Chat:** has a "Close", but it is a small ✕ above a faint word in the header, Escape does nothing, tapping outside does nothing.
- **Map:** the button says **"Back to your galaxy"** though it only closes the map; Escape does nothing; the map is *see-through*, so a
  world's own header ("← Galaxy") and gesture buttons show underneath — two "back" buttons; the title/fuel/back row is cramped and sits on
  the HUD's top row; it opens on "Checking the chart…"; it shows only *discovered* worlds, so an early brain sees two dots.
- **Rule (every overlay):** a visible **✕ Close** (44 px, same top-right slot, word + glyph), **Escape closes**, **tapping the dimmed outside
  closes** (chat), and the thing never shows what is underneath.
- **Map specifically:** opaque backdrop, its bar under the HUD top row, button reads **"✕ Close map"**, an honest empty state ("Worlds appear
  here as you reach them"), nodes ≥ 44 px, the price of each leg shown on the map from the new distance rule.

## 2. Warping home
- **Today:** "← Galaxy" just hides the worlds layer; the ship is still "in" the world on the server and the galaxy appears with a hard cut.
- **Design:** "← Galaxy" departs to **home as a warp** — the same align → spool → warp → arrive cinematic, home gate at the end — through the
  server's own journey (it stays the authority; a reload resumes). Going home is **always free** (D-1: home is always free; the server
  currently charges 10 for it though the board says "free" — a bug, fixed here) and uses a **3 s** align (not 10 s): leaving should not be a
  chore. **Cancel** stays for those 3 s. On arrival the galaxy fades in with "Arrived · Home". If the journey call fails the old instant
  return remains as the fallback, so you are never stuck.
- Reduced motion: same sequence, no sweep/flash (already true of the cinematic).

## 3. Fuel by distance
- **Chart:** the worlds' map positions (already the map's layout) become shared data; **cost = ⌈distance / 45⌉ + 1** fuel, per leg, minimum 2.
  Examples: Home → Station 8, → Growing Place 7, → Quiet 11, Station → Quiet 18, Quiet ↔ Eternity 19. **Home-bound warps are free.** Drift is
  still free. Eternity's three-leg chain sums its legs.
- **Server is the authority:** `settle()` charges the price for *this journey's* origin → destination (it read a flat 10); an unaffordable
  window-close still cancels free. The board, the map's edge labels and chain totals, the Tours panel and the harbor controller all use the
  one shared function — no second copy of the number.
- Economy sanity: capacity 200, regen 3.5/h, earn +5 per completed warp, +15 per memory — the worst single leg (19) is still < 10 % of the tank.

## 4. Growing Place → 100 %
**What exists:** walk by tapping, tend a plot, groves with missions/memories, carry a wildflower to a grove, seed-pod recall, Groves list,
a one-time purpose line. **What is missing** (owner: understanding *what to do*, *what I hold*, *what is happening*):
1. **Objective strip** — one line under the dock that always says the next useful thing, in order of priority: *carrying* → "Carrying
   '<memory>' — tap a grove to place it" (+ **Drop**); *pods due* → "N seed pods are ready — tap one to recall it"; *plots cold* → "Tap a
   glowing plot to tend it"; *nothing to do* → "The garden is tended — walk to a grove or rest."
2. **Carrying is unmissable** — a chip in the strip with the memory's name, the groves that can take it **pulse** (ring + "place here"), the
   ship's glow stays, and tapping the chip drops it. Never colour alone: ring + word.
3. **Activity feedback** — *walking* shows a ground marker at the destination and "Walking to <place> …" with tap-to-cancel; *tending /
   planting / placing / recalling* show a working state on the sheet's button and a one-line result ("Placed '<memory>' in <grove> ✓ — it
   shows as a stone there").
4. **First-visit guide** — a 3-step checklist (Walk → Tend a plot → Carry a memory to a grove), each with ✓, dismissible, remembered per
   brain; it is the objective strip's teaching mode, not a modal.
5. **Closure** — a **garden day** of three beats (tend 3 plots · place 1 memory · recall 1 pod) shown as a small ring; completing it plays
   a bloom and says what grew. **No fuel reward** (the world's rule: looking is never farmed); the reward is the visible bloom.
- Pure logic (`gardenGuide.ts`): the objective/priority, the carrying and day-progress state, unit-tested; the scene only draws it.

## Order
(1) exits → (3) fuel → (2) warp home → (4) garden. Each: spec above, build, real-browser measurement, ship.

## Acceptance
Exits: every overlay closes by ✕, Escape and (chat) outside-tap, in home and in a world, measured. Fuel: a table of all 8×8 prices from the
function; the server charges the leg's price and a home warp 0; board/map/tours agree. Warp home: from each world the cinematic plays
and ends at home with the galaxy resumed and no hard cut, measured. Garden: with no memory carried, carrying one, and with pods due, the strip says
the right thing; the guide advances as steps are done.
