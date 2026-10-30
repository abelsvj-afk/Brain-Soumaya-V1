# Deep Past REWORK — functions & animation addendum (2026-10-29, evening)

**Status:** DESIGN ONLY — companion to `deep-past-rework-design-note.md`.
The build (when the owner taps it) is gated on the note's A1–A12 **and**
this addendum's F/AN criteria. Nothing here authorizes code, a merge, or
a deploy.

**Owner addendum (2026-10-29 ~21:18 EDT):** the world must actually
FUNCTION — do what it's supposed to do, be a usable, playable space as
intended — and all the animations must work like they did in the old
mockups. This document turns that into testable criteria. Every F/AN
item states: the intended behavior (plain), its source, and an
acceptance check that **exercises it end-to-end as a user** — do X,
observe Y. A function that exists in code but cannot be exercised is a
FAIL under these criteria, by design: that is exactly the failure mode
of the build this rework replaces (the layout computed explanations,
a rise, and thread stops that the world never showed).

**Sources read for this addendum** (citations inline):
- Mockup: `~/workspace/worlds-vision/mockups/deep-past/index.html`
  (1094 lines; line numbers are this file's) + its `README.md`.
- Recipe: `~/workspace/worlds-vision/recipe-deep-past.md` (settled
  2026-10-22) — §2 composition, §3 content rules, §5 animation table.
- App `main` @ **`87b9e2e9`** (ls-remote-verified 2026-10-29 evening;
  the Deep Past files are substantively the ones the note read @
  `ad243423`): `deepPastLayout.ts` (375 lines), `deepPastScene.ts`
  (934), `WorldsSurface.tsx` (2565) — cited below as L, S, W + line.
- The rework note (§§5–8) — cited as N§.

**Reading key:** ◆ = a gap or conflict this addendum surfaces (all are
collected in §3). "Today" = the shipped app @ `87b9e2e9`.

---

## 1. Functions — F1–F15

### F1 — Arrival & overview
**Behavior.** Arriving in Deep Past opens on the rim overview: the
whole lit helix in frame, the basin glowing at the bottom, and the
one-line arrival explanation (N§8) shown once per visit in the
look-hint slot. Drag looks, pinch/scroll zooms (the existing grammar).
**Source.** N§7.1, N§8; mockup stage `rim` + STAGES table (~605–635);
recipe §2.1.
**Check.** Arrive → overview frames the full descent with the basin
visible at the bottom; the arrival line appears; move once → the line
does not reappear this visit; leave and return → it shows again, once.

### F2 — Walk the Descent (the primary way down)
**Behavior.** From the dock ("Walk the stair") or by tapping the stair
in overview, the camera rides the walk curve — disc arcs and stair
flights, eye at floor + 3.2 — at a calm capped pace. Tap/hold pauses;
drag looks freely at any time; at each stratum landing the walk offers
the stratum by name and waits.
**Source.** N§7.2 (pace ~14 units/s at ×1); mockup travel chassis
(flyTo 'drift' gait, ~605–635).
**Check.** Start the walk at the rim → it descends flight by flight
without teleport cuts; pause mid-flight → it holds indefinitely;
resume → it continues from the same step; reach the basin landing →
the walk ends facing the orb. Walk the whole way without ever opening
fly-to.

### F3 — Stratum perch & stepping
**Behavior.** Stepping off at a landing puts you on that stratum: a
slow free-orbit perch over its disc, its resting memories beside you.
One tap takes the next flight down or the flight back up; "Rim"
returns to overview. Stepping works at every stratum, both directions.
**Source.** N§7.2–7.3.
**Check.** During the walk, step off at three different strata → each
perch shows that stratum's members resting on the disc; from the
deepest perch, step up flight by flight back to the rim; no step ever
lands you floating, inside a wall, or on the wrong stratum.

### F4 — Chronicle ride: arming a route
**Behavior.** When a saved route exists (the layout's thread: earliest
done Journey with ≥2 member stops, L273–367), the dock offers "Descend
the Chronicle," the surface names the route and its stop count, the
route is visible in the world before it is traveled, and its stops sit
at the memories' chronological alcoves (risen members are visited at
their home alcove, never at the shelf — L103–111, stops built from
homeX/Y/Z).
**Source.** Recipe §2.1, §3 ("routes are real routes"); mockup
Chronicle panel copy (~656–676); today: W~2307–2311 already prints
"Chronicle route: {title} — {n} stops along the descent."
**Check.** With a qualifying done Journey: the dock button and the
route line appear, naming the real route; the thread and its beads are
visible from the rim before starting. Delete/complete-no-route state:
with no qualifying Journey, no button, no thread, no beads — and no
error (see F13).

### F5 — Chronicle ride: travel, stops, resume, completion
**Behavior.** The ride travels stop to stop in route order. At each
stop it **dwells** — it waits, indefinitely, until told to continue;
the stop's memory is approachable with one tap (F9) without losing the
ride. Leaving the ride mid-way parks your place; re-entering resumes
at the parked stop. At the final stop the ride completes: the route
rests, fully lit, and you are free at the basin. No stop is ever
skipped, reordered, or timed out.
**Source.** Mockup: CHRON_STOPS + chronHop dwell 2000 ms then next hop,
but pause/leave keeps place indefinitely (~648–690; `chronLeave`:
"your place is kept at stop N of 5… nothing about any memory
changed"); recipe R-D4 (pause indefinitely, leave without losing
place). N§7.4, N§8 ("the ride waits — indefinitely").
◆ Today the app ride is one continuous 90 s camera glide with **no
stops at all** (S95–103; W~1862–1890) — progress parks and resumes
(W1477–1491), but there is nothing to dwell at, approach, or complete.
F5 is the criterion that closes that.
**Check.** Start the ride → it travels to stop 1 and waits; wait 60 s
touching nothing → still at stop 1; tap the stop's memory → its card
opens (F9); close it → you are still on the ride at stop 1; Continue →
stop 2; leave to overview mid-ride, re-enter → you resume at the
parked stop, not the rim; finish → completion state at the basin,
route fully lit (AN3).

### F6 — The rise: a deep memory comes forward ◆
**Behavior.** When a member's context warms (tended or linked within
30 days — L223–241), it rises to the presentation shelf near the rim
and rests there, visibly a guest: the shelf holds it, and its cause is
stated where it can be read ("risen because you tended it recently…",
the why-line the layout already writes, L245–257). Its stratum, home
alcove, and history do not change; it never appears in two places.
**Source.** Recipe §3 (the rise defined, cause visible, derived
presentation only); mockup A22 (~831–850: cause printed *before* the
motion, shelf named "a VIEW, not a home"); layout L70, L213–221.
◆◆ Today this function is computed and invisible: the layout derives
`risen`, `riseReason`, shelf positions, and the full cause line — and
nothing in the app ever shows any of it. No label, no list, no cause,
no motion (AN10): a risen member simply *is* at the shelf coordinates
in the scene (S~660–676 renders shelf + glow), indistinguishable from
a placement. This is the single largest computed-but-unsurfaced
function in the world.
**Check.** Tend (or link) a memory old enough to rest in Deep Past →
within the same visit its form is at the rim shelf, not its alcove;
approach it (F9) → its card's line begins "risen because…"; its alcove
stands empty; the Chronicle thread (if it is a stop) still points at
its home alcove.

### F7 — The return: settling back by the same rule
**Behavior.** When the warm context cools (the same 30-day rule,
nothing else — never a neglect timer, never a visit counter), the
member returns from the shelf to its own alcove and rests there,
unchanged. While context stays warm it does not return early.
**Source.** Recipe §1/§3 (return by the same rule; monotonicity);
mockup settle flow (~851–865: "Returning by the same rule that raised
it — never a timer, never neglect").
**Check.** With a risen member whose warmth has lapsed (aged fixture /
backdated tend): it rests at its home alcove again; its card's line is
the resting why-line, not a "risen" line; no other member moved.

### F8 — A memory comes to rest (the A1–A3 chain, as the app lives it) ◆
**Behavior.** When a memory becomes Deep Past's — it ages past the
threshold, or is un-archived into eligibility (L178–200) — it comes to
rest at the alcove the rule computes, at its chronological depth,
identity and home intact. Placement is atomic: it is either fully
resting at its alcove or not here at all; it never half-appears, never
duplicates, and an archived memory never appears (the archive wins,
L192–197).
**Source.** Mockup A1–A3 (~792–828: carry 1.2 s → transit down the
helix as visible cargo → placement glide 2.6 s → identity/home CHECK);
recipe §2.3, §8.
◆ Interpretation, flagged: the mockup's chain is a *manual* carry by
the ship; the app has no carry verb and the note adds none — placement
in the app is the eligibility transition itself. This criterion
therefore exercises the transition, and AN11 covers its visible
settle. If the owner wants a literal carry verb, that is new scope —
it is not smuggled into this addendum.
**Check.** Take a memory just under the age threshold; cross it (or
un-archive an eligible one) → it rests at the stratum its date
computes, one instance only; archive it → it is gone from the world
entirely; its card (F9) shows the resting why-line for the right
stratum.

### F9 — Approach & read a memory
**Behavior.** Tapping a resting (or risen) member — its form or its
lantern glow, from a perch or overview — glides the camera to it and
opens its existing memory card: the memory itself, and beneath it the
layout's why-line for that member (resting line, or "risen because…"
when risen). From the card, the memory's anchor lines are followable:
a member anchored elsewhere offers its other appearance, and following
it travels the light line (the anchor *target* is named — "also
appears at…" — not just drawn).
**Source.** N§8; layout why-lines L245–257; anchors L95–101, L323–341;
recipe §3 (the explanation reachable in one line, controls reachable
from it — see F15).
◆ Today: members are not tappable in-world at all (note §2), the
why-lines are rendered nowhere for Deep Past (the only `why` render in
WorldsSurface is the Garden's suggestion panel), and anchor lines are
drawn with their targets unnamed and unfollowable.
**Check.** Tap three members at three depths → each card opens with
that memory and its own correct why-line (years/stratum match the
rule); tap a risen member → "risen because…" line; tap a member with
an anchor → the card names its other appearance and following it
arrives there.

### F10 — Relic glimmers: the find flow in Deep Past
**Behavior.** A landed, visible relic in Deep Past offers its glimmer
in the single prompt region (N§8's re-spec: one container, ≤3 rows,
"+N more," never overlapping). "Look closer" travels you to it; the
find completes through the existing flow and the relic enters the
Codex. The Witness waits at the basin center, in the First Light.
Deep Past's membership never blocks a find, and a found relic's row
leaves the region.
**Source.** N§8; today the flow exists (W~1462–1490 visibility,
~2271 prompt render — stacked, being fixed — and the find handler
W~1470–1475: markRelicFound + Codex toast).
**Check.** With all four Deep Past relics unfound: exactly four rows
(or three + "+1 more") render, none overlapping; Look closer on the
basin relic → you arrive at the basin; complete the find → Codex
toast, the row is gone, the relic reads found in the Codex.

### F11 — Fly-to shortcut
**Behavior.** The dock's fly-to lists only the note's places (Rim ·
First Light · the Anchor Spire · the Supernova · up to three stratum
landings), every label unique, each landing you at the named place.
It is a shortcut layered over the walk, never the only way to move.
**Source.** N§7 (places re-anchored to generated holders; the "First
Light basin"/"First Light orb" duplication ends).
**Check.** Open fly-to → no duplicate labels, no removed-piece places
(no Stair/Terrace/Crystals/Hero lantern); fly to the deepest landing →
you arrive on that stratum's disc; walk one flight from there (F3) →
the modes compose.

### F12 — Leaving: exit, return home, departure grammar
**Behavior.** Leaving Deep Past is always available and always free
from inside the world; the shared travel grammar applies to the
journey out as it does everywhere (a departure can be cancelled
inside its window and nothing changes; a turn-back mid-transit
returns you to the captured pose). In-world modes are never a trap:
exit mid-walk or mid-ride parks state per F2/F5, spends nothing, and
changes no memory.
**Source.** Mockup travel grammar (~700–790: 1.2 s cancel window with
full state check; turn-back to the snapshot pose; "Return is always
free, even at zero fuel"; warp refused at low fuel with drift/home
still offered); N§7 (in-world movement is free, never-punish).
**Check.** Start the walk, exit the world mid-flight → you leave
cleanly; re-enter → the walk is parked where you left it (or at the
rim after a fresh arrival, F5's contract); arm a departure out and
cancel inside the window → you are still in Deep Past, view and state
unchanged.

### F13 — Empty brain, honest world
**Behavior.** With no eligible memories, the world still renders the
helix, the stair, the basin, and the sky (today's scene rule, kept —
S~85), the arrival line adapts (no thread variant), no thread/beads/
stops exist, and nothing pretends to be a memory. With memories but no
qualifying route, everything holds except the Chronicle (F4's absent
state).
**Source.** Layout: empty layout is a first-class output
(eligibleCount 0, thread null, L118–131); note §11.
**Check.** Open Deep Past on an empty brain → the full architecture
and basin render; no Descend-the-Chronicle control; the arrival line
is the no-thread variant; zero glitch placeholders or fixture
memories.

### F14 — Failure honesty
**Behavior.** If Chronicle route data fails to load, the world says so
in one line — "Chronicle routes couldn't load — your past is
unaffected" (today's line, kept verbatim) — and everything else in
the world still works. A kept GLB that fails to load degrades to its
generated understudy (the fixture rule) with the substitution visible
in the scene's own terms, never a hole.
**Source.** W~2313–2317 (today's failure line); mockup loader
fallbacks (basin disc returns, README piece 1; fixture lantern stays,
piece 5).
**Check.** Block the journeys fetch → the failure line appears, the
walk/perch/find flows all still work; block the orb file → the basin
still glows from its generated fallback and the descent still ends
facing the basin's light.

### F15 — The explanation carries its controls ◆
**Behavior.** A member's why-line is not a dead end: from the same
card, the brain's own membership controls are reachable — the D-7
controls (age threshold, manual include/exclude) that the recipe
promises "reachable from that explanation."
**Source.** Recipe §3 ("with the user's controls (thresholds, manual
include/exclude, D-7) reachable from that explanation").
◆ Gap: the note surfaces the why-line (N§8) but never mentions the
controls; this addendum flags it rather than dropping it. The build
must either wire the card to the app's existing D-7 controls (and
name where they live in the build record) or record an explicit owner
waiver. Silence is a FAIL.
**Check.** Open any member's card → the path from its why-line to the
membership controls is at most the taps the build record states;
change an exclude → the member leaves the world on next layout; undo
→ it returns to the same alcove.

---

## 2. Animations — AN1–AN13

General rules for every AN: motion is capped, gentle, and
user-controlled (recipe §4 vertigo care); reduced motion (RM)
substitutes per item and never removes the *outcome*; tab-switch or
jank can never fast-forward a clip (today's scene clamps mixer delta
to 0.1 s — S~920–928 — that clamp is part of every clip criterion).

### AN1 — The orb: 'FirstLight' clip
**Mockup/file.** The orb GLB's own 'FirstLight' clip — per the note,
spin + bob + breathing pulse (N§6); the mockup's basin had no GLB orb
(its motion at the basin was the motes, AN5), so the file is the
source of truth and the prototype crew is verifying the clip in it.
**Required.** The clip plays, looping, on the scene's mixer from the
moment the orb lands; the orb reads as *alive* — turning, breathing —
at its ×1 span (~17 units); it is the last thing the descent settles
facing (kept from today's descent derivation, S195–220).
**Verify.** Frame captures at ~2 s intervals over 10 s at the basin:
orientation/position visibly change between captures, smoothly (no
jumps on tab-refocus — the delta clamp); in-app, ride or walk to the
basin and watch a full cycle. RM: the clip holds still (today's
behavior, S898–903) and the basin still reads lit.

### AN2 — Route beads: 'Flow' clip + the current-stop pulse
**Mockup/file.** 'Flow' is the bead file's clip (note §4 #2); the
mockup had no beads — its stop emphasis was thread brightening +
dwell. The note adds: at a Chronicle stop, "the bead pulses" (N§8).
**Required.** Every bead plays 'Flow' on its mixer (today: yes,
S806–822, all stops uniformly). During the ride, the **current**
stop's bead additionally pulses — a visible scale/brightness swell
that the other beads do not share — so the eye finds the stop the
ride is waiting at.
**Verify.** Start the ride; at stop 1, capture frames ~1 s apart: the
stop-1 bead swells while beads at later stops only flow; Continue →
the pulse moves to stop 2's bead. RM: no swell — the current bead
carries a static brightness offset instead.

### AN3 — The Chronicle thread: kindling ◆ (conflict C1, resolved)
**Mockup.** The gold thread starts unlit (drawRange 0) and **kindles
as you descend**: its lit length grows with ride progress across
~24 s of active descent (tick: `chronicle.k += dtMs/24000`,
drawRange = k × 220); under RM the lit length snaps segment-by-segment
to the current stop. A separate faint route line (cyan, opacity 0.4)
was always visible. (Mockup ~525–530, main-loop Chronicle block.)
**Recipe.** §2.1: the path is "visible as a thread of slightly
brighter light winding down the strata **ahead of the ship: the
route, made visible before it is traveled**"; A19: on route plotting
"the thread kindles along the strata from stop to stop in route
order."
◆ **Conflict.** Mockup code: thread invisible until the ride starts.
Recipe text: route visible before travel. The note (§5.4) says the
app's thread is "kept verbatim" — the app's thread is a static,
fully-drawn line (S787–796): pre-visible ✓, kindling ✗. The note
silently kept the recipe half and dropped the mockup half.
**Resolution specced here (owner-vetoable, §3 C1).** Both halves: the
thread renders at rest as a **dim full route** (visible before
travel, recipe) and **kindles to full brightness progressively**
behind/along the ride (mockup), the lit head reaching the current
stop; at completion the whole thread rests fully lit (mockup's
"A21 complete — the route rests, fully lit"). Kindling is a
brightness/draw-range progression, never a re-route.
**Verify.** Before starting: the dim route is visible rim→basin.
During the ride: frame sequence shows the bright portion extending
stop to stop, never ahead of the current stop by more than the leg
being traveled; at completion: full thread bright. RM: brightness
steps discretely per stop reached.

### AN4 — At a stop: the thread brightens, the alcove answers
**Mockup/recipe.** Recipe §2.2: "at each stop the thread brightens,
the alcove answers, and the memory is visitable"; §5 A20 (focus): on
touch, "the alcove answers with a ring of its own light." (Mockup
implements the dwell + kindle; the alcove ring is recipe-only.)
**Required.** Arriving at a stop: the thread segment at the stop
brightens, the stop memory's alcove emits a light ring (a single
expanding ring in the memory's own warm light, then rest), and the
bead pulses (AN2). Approaching any resting memory (F9) triggers the
same ring on tap.
**Verify.** Ride to a stop: capture the arrival — ring blooms once,
thread at the stop is the brightest thread segment in frame; tap a
resting member from a perch → its alcove rings the same way. RM:
ring becomes a steady halo while the stop/card is active.

### AN5 — Motes rising through the shaft
**Mockup.** 130 gold motes inside the beam rise slowly and wrap:
`y += dtMs × 0.0012` (≈1.2 units/s at mockup scale), respawning at
the basin when they pass the top (~lines 337–352, main-loop motes
block).
◆ Today there are **no motes**: the app's particulate is marine snow
that *sinks* (S905–913), the opposite motion with the opposite
meaning (dust falling into the past vs the basin's warmth rising).
**Required.** Restore the rising motes in the shaft at the mockup's
rate scaled to ×1 (rise ≈ 1.2 units/s, wrap at the shaft top), 130
count per the §9 budget. General marine snow may coexist as
atmosphere (recipe A8) but may not replace the beam's rising motes.
**Verify.** Two frame captures at the basin 5 s apart: mote field has
visibly risen (~6 units) with wrap continuity (no synchronized reset
flash). RM: motes static.

### AN6 — The light shaft: presence, not motion
**Mockup.** The shaft is two static additive cylinders (opacity
0.045 outer / 0.07 core, full 172-unit height); it does not pulse,
rotate, or breathe — the basin's *glow sprite* carries the breathing
(AN7). (Mockup ~325–335.)
**Required.** The shaft stands full height, pool to above stratum 0,
motionless; no invented shimmer on the shaft itself. (Flicker from
rendering is a defect, not motion.)
**Verify.** Entry render sequence over 10 s: shaft edges steady;
brightness change in frame is attributable to the pool glow's
breathing (AN7), not the shaft. RM: identical (it never moved).

### AN7 — The basin breathes
**Mockup/recipe/app.** Recipe §5 A8 (depth weather): "basin shimmer
breathes." The mockup's pool glow is static; the *app* implements the
breath today: glow scale and basin light intensity ride a sine of
period ≈ 12.6 s (`sin(elapsed × 0.0005)`, ±10 scale, ±0.15 intensity
— S915–919).
**Required.** Keep the app's breathing at ×1: the pool glow's span and
the key light's intensity breathe together on a slow ~12 s cycle,
subtle (the destination feels alive, never throbs). Values re-derive
from the §6 light rig; the period and the subtlety are the spec.
**Verify.** Luminance sample of the basin region across 15 s at the
basin: a smooth single sine, no steps; from the rim (entry render
pair 12 s apart) the glow's breathing is just perceptible. RM:
static at mid-breath values.

### AN8 — Alcove light-breathing ◆ (recipe-only, at risk)
**Source.** Recipe §3: "slow light-breathing in alcoves" as ambient
presentation (§5 A8). **Neither the mockup nor the app implements
it** — mockup lanterns are a static InstancedMesh; the app's member
lights are points. The note does not mention it.
**Required (flagged, §3 C4).** Resting members' lantern glows breathe
very slowly and *out of phase* with each other (seeded per member, so
the field shimmers like embers, never pulses in unison), amplitude
small enough that no member ever reads dimmer than another — the
depth rule (recipe §1: equal dignity, nothing dims) bounds this
animation absolutely. If the build cannot do out-of-phase breathing
inside the §9 budget, it must record the omission against this item
with cause — not drop it silently.
**Verify.** Frame pair 20 s apart on a populated stratum: individual
glows differ between frames, no two in lockstep, none dark. RM:
static.

### AN9 — Camera character: walk, ride, and the idle orbit
**Mockup.** Travel legs use the 'drift' gait — 12 s legs, cosine
ease-in-out (`(1−cos(πk))/2`); warp legs 2.6 s cubic ease (~605–635,
main loop). Before the user engages, the camera **idle-orbits the
descent at ≈ 9°/s** (`−0.00016 rad/ms` ≈ 0.16 rad/s), starting 2 s
after load, ending **for good** at the first pointer/wheel/flight
(~590–600, main-loop drift block).
**Required.** (a) Walk/ride camera motion uses cosine-class easing —
no linear glides, no snaps except RM cuts; leg pacing per N§7 (~14
units/s walk). (b) The overview idles with the mockup's slow orbit
(≈9°/s, the note's A1 entry render is a still of this view) until the
traveler's first interaction, then never resumes uninvited. (c)
Today's parked-orbit rate (W: `elapsed × 0.0000045` rad/ms ≈ 0.26°/s)
is ~35× slower than the mockup's — the rework adopts the mockup's
rate for the *arrival* orbit; a parked mid-descent orbit may stay
slow. ◆ The note's §7.1 specced user-orbit only; the idle drift is a
mockup behavior the note forgot — restored here (§3 G5).
**Verify.** Fresh arrival, touch nothing: 10 s of capture shows ~90°
of orbit; first drag → orbit never resumes this visit. Walk a flight:
frame timestamps show eased (slow-fast-slow) progress, no constant-
velocity segment. RM: stage holds / fades per N§7, no orbit.

### AN10 — Rise & return motion ◆ (the note's largest animation gap)
**Mockup.** The rise is a **5.2 s cosine-eased glide** (riseAnim,
dur 5200) from the home alcove to the rim shelf, accompanied by a
**column of light** around the traveling memory: opacity swells
`0.16 × sin(π × k × 1.15)` through the move and settles to a faint
0.1 while it rests on the shelf. The return is the same 5.2 s glide
back; the column hides on arrival home. RM: instant reposition, same
states (~831–865, main-loop rise block).
◆ Today there is **no rise motion at all**: the layout recomputes and
the member is simply elsewhere next render. The note (§5.4) keeps a
hero orb at stratum 7 as "the rise candidate" but specs no rise
motion, no column, no settle — the mockup's signature A22 *animation*
was dropped while its layout fact was kept.
**Required.** When a member's risen state changes while the traveler
is in the world (or on next arrival, if it changed while away — the
glide plays once on arrival, from alcove to shelf, so the change is
*seen*, never silent): 5.2 s-class cosine glide along a gentle arc,
light column swelling and fading per the mockup's curve, cause line
shown (F6) as it lands. Return identical in reverse. The motion is
interruptible by nothing (atomic, per the mockup's busyBlock) and
blocks no other verb for longer than its duration.
**Verify.** Trigger a rise in-world (tend a deep member): the glide +
column play, ~5 s, member lands on the shelf, cause readable. Let
warmth lapse → return glide plays, column gone at home. RM: fade
between positions (recipe §5: "Fade-rise between positions"), states
identical.

### AN11 — Placement settle (A3's visible half) ◆
**Mockup.** Placement is a 2.6 s cosine glide to the shelf/alcove,
ending with the identity CHECK and the alcove's light warming to
receive the memory (recipe §2.3: "the alcove light warms to receive
it"). (Mockup ~806–828.)
**Required.** When a memory newly comes to rest while the traveler is
in the world (F8's transition), its alcove light warms in over ~2–3 s
and the member fades/glides the last short distance into rest — a
visible *arrival*, never a pop-in. If the traveler is elsewhere in
the world, no off-screen theater is required; the member is simply
resting when found.
◆ Interpretation flagged with F8: the app's placement is a data
transition, not a carried cargo; this criterion covers its visible
surface only.
**Verify.** In-world, cross a memory into eligibility → its alcove
warms and it settles within ~3 s; screenshots at t=0 and t=3 s show
resting state, identity unchanged (card check per F8/F9). RM:
appears rested with a fade.

### AN12 — Shelf presentation
**Mockup.** The risen memory rests on the presentation shelf near the
rim "while its context is warm" — the shelf is a place with a
presence (in the mockup, the light column's residue at 0.1 opacity
marks it). The app already builds a shelf platform + glow (S~660–676)
but nothing distinguishes a risen guest or explains it (F6).
**Required.** The shelf reads as a *presentation* place: a risen
member there carries a soft light column remnant (mockup's 0.1) or
equivalent marker, and its cause is one tap away (F9). An empty shelf
is just architecture — no marker, no glow-up.
**Verify.** Shelf with a risen member: marker visible, cause one tap
away; shelf empty: no marker; two members risen: both marked, each
cause its own.

### AN13 — First arrival: the reveal ◆ (divergence, resolved)
**Recipe.** §5 A15: on first ever visit "the rim view opens slowly —
the lit spiral revealed turn by turn."
**Mockup.** No staged reveal exists; the idle orbit (AN9) *is* the
reveal — the spiral comes around turn by turn at 9°/s.
**Resolution.** The mockup's behavior stands as the implementation of
A15: arrival → overview + idle orbit (AN9). No separate reveal
choreography is required; a build that adds one must keep it
skippable by the first touch, like the drift.
**Verify.** First-ever arrival (fresh profile/state): the spiral
reveals by orbit; first touch hands over control instantly. RM: a
single gentle fade-in (recipe §5 A15 RM equivalent).

---

## 3. Conflicts & gaps register

### Conflicts (mockup vs recipe vs note) — resolved or flagged

- **C1 — Thread: pre-visible vs kindles-from-zero.** Recipe §2.1
  (route visible before travel) vs mockup code (gold thread starts at
  drawRange 0; a separate faint line carried pre-visibility). Note
  kept the app's static line and dropped kindling silently.
  **Resolved in AN3** (dim full route at rest + kindling brightness
  with the ride). Owner may veto toward either pure form.
- **C2 — The ride's shape.** Mockup: discrete hops with dwell,
  kindling tied to progress. App today: one continuous 90 s glide, no
  stops. Note: the *walk* is continuous, the *ride* keeps stops
  (N§7.4/§8). **Resolved:** the walk is continuous (F2); the
  Chronicle ride is stop-based with dwell (F5) — two different modes,
  two different motion grammars, do not merge them.
- **C3 — A1–A3: manual carry vs automatic placement.** Mockup's
  signature chain is a ship carrying a memory down. The app places by
  rule; the note adds no carry verb. **Flagged, not resolved** (F8,
  AN11): the criteria cover the placement transition and its visible
  settle. A literal carry verb is owner scope if wanted.
- **C4 — Alcove breathing is recipe-only.** Present in the recipe's
  §3/§5, absent from mockup code, app code, and the note. Carried as
  AN8 with an omission-must-be-recorded clause.
- **C5 — The ship-led descent is not carried over.** In the mockup
  the *ship* descends the spiral (shipK along the curve, cargo
  aboard); the app's ride is camera-only and the note's modes are
  camera modes. **Flagged for the owner:** if he wants her ship
  visibly riding the thread during the Chronicle (as the mockup had
  it), that is an addition to N§7 — this addendum does not silently
  restore it, and does not forbid it.
- **C6 — Fuel/warp grammar scope.** The mockup exercises warp cost,
  zero-fuel refusal, and the cancel window *inside* its stage
  flights. In the app those belong to shared inter-world travel;
  in-world movement is free (N§7). **Scoped in F12:** the grammar
  criteria apply at the world's boundary (departures/arrivals), never
  to in-world modes.

### Gaps — computed but never surfaced (today), closed by criteria

- **G1 — Why-lines.** The layout writes a P6 explanation for every
  member (L245–257); Deep Past renders none of them. → F9.
- **G2 — The rise.** `risen` + `riseReason` + shelf positions are
  derived per layout; no label, list, cause, or motion exists in the
  world. → F6, F7, AN10, AN12.
- **G3 — Thread stops as stops.** Stops are computed with positions
  (L103–111) but surface only as a count in one text line; the ride
  cannot stop at them. → F4, F5, AN2, AN4.
- **G4 — Anchor targets.** Anchor lines are drawn from member to
  non-member (L323–341) with the target unnamed and the line
  unfollowable. → F9.
- **G5 — Mockup behaviors the note forgot.** Thread kindling (→ AN3),
  stop dwell/brightening (→ F5, AN4), rise/return motion + light
  column (→ AN10), idle orbit ≈9°/s (→ AN9), motes rising (→ AN5 —
  the note keeps "motes" in §5.4's vocabulary list but the shipped
  scene it inherits from has sinking snow instead; the criterion
  pins the *rising* direction as the mockup's).
- **G6 — Membership controls reachability.** Recipe promises D-7
  controls reachable from the explanation; the note omits them.
  → F15 (wire them or record an owner waiver — silence fails).

### Deliberately unsurfaced (not gaps)
`eligibleCount` / `excludedCount` / `omittedEdgeCount` (L118–131) are
reconciliation counters for tests, not user facts; no criterion
requires showing them. The layout's determinism (C1/C2 contracts in
its header) is covered by the note's A9 (semantics untouched) and is
not re-criteria'd here.

---

## Appendix — what "done" means for this addendum

The build's gate (note §10) gains: F1–F15 exercised end-to-end in the
built app (each check above is the test script — a function that
cannot be exercised fails, however complete its code), AN1–AN13
verified by the stated frame/render evidence alongside A1's composed
renders, and §3's flagged items (C3, C5, F15/G6) either resolved in
the build record or carrying an explicit owner waiver. A12 still
outranks everything: the owner's phone verdict is the final gate.
