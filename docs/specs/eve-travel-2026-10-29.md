# EVE-style travel: align → spool → warp → arrive, in place

**Status:** BUILT 2026-10-29 (steps 1–3 below), measured at 412×915; the owner confirms the feel on the phone. Deviation from
the sketch: the SKY turns round the holding ship (not the ship against a fixed sky), so the gate is visible on a portrait screen.

> "When you walk somewhere, it should be just like on EVE Online, where you see the ship turn towards the direction slowly
> that it's about to warp to, and it just counts down, the engines get real red, and then boom, it takes off real fast,
> and everything around is blurry and rushing by, and then when you get where you're going, you stop there, and you
> don't have to load into a new screen … when you travel somewhere from your world, you actually see the gate."

## What exists today (measured in code)

| Moment | Today |
|---|---|
| Depart | A 10 s cancel window is shown **only in the Travel sheet** (text countdown). The world layer is hidden (`journey.state` is not `in_transit`, so `mode === null`). |
| Flight | `transitScene.ts`: a separate scene — ship holds still, gates slide past, 120 fixed-length streak bars. 12 s warp / 45 s drift (`TRANSIT_MS`). |
| Arrive | The scene swaps to the destination world (a hard cut, plus the world's own load). |

So there is no alignment, no spool, no ramp, no deceleration — and the arrival is a screen change. That is what the owner is
describing.

## The sequence (the 10 s cancel window becomes the cinematic)

The server timeline is unchanged (it is the authority): cancel window → `in_transit` → arrival. The client draws it:

1. **ALIGN** (0 → 6 s of the cancel window). Chase camera on her ship in open space, the **origin gate behind her**. The
   ship yaws slowly (eased, ~0.35 rad/s peak) from facing the gate to facing the **destination beacon** — a distant, named
   marker ahead. HUD: `Aligning to <World> · 6`. Cancel stays one tap away (on screen, not in a sheet).
2. **SPOOL** (6 → 10 s). Countdown `3 · 2 · 1`. Engine glow ramps white → amber → **deep red**; a faint camera shudder
   and a slow FOV narrowing (the "gathering" feel). Reduced motion: no shudder, no FOV change, the glow ramp is kept
   (it is information).
3. **JUMP** (the instant the server flips to `in_transit`). A short, hard acceleration: FOV widens, a white-blue flash
   frame, the ship **leaves** — gone ahead of the camera in < 0.5 s.
4. **CRUISE** (warp 12 s / drift 45 s). The warp tunnel: stars stretch into streaks whose **length and speed ramp up**
   (0 → max over ~1.5 s), edge blur / vignette (CSS radial mask — no post-processing pass), engine trail. Drift stays calm
   (slow streaks, no blur) per D-1: both are dignified.
5. **ARRIVE** (last 1.5 s). Streaks collapse back to stars (deceleration), the **destination's gate** grows ahead, the
   ship settles, and the destination world **fades in underneath in place** — no loading screen: its models were
   prefetched during the cancel window + flight (`worldPrefetch.ts`), and the world's first frame is a camera glide
   settling from where the ship stopped (the Station's arrival glide, generalised to every world).

## Rules
- The cancel window stays free and always reachable; **Turn back** plays the reverse align (ship turns home), no penalty.
- `prefers-reduced-motion`: the sequence still happens in the same time, with the motion removed (no yaw sweep — an
  instant facing; no shake; no streak stretch; a cross-fade instead of a flash). The countdown text carries the meaning.
- Never colour alone: the engine ramp is paired with the countdown numerals and a "SPOOLING" label.
- No new dependency; no post-processing composer (draw-call and phone budgets): blur/flash are CSS overlays.
- Offline/heuristic paths unaffected; server contracts unchanged (journey states already exist).

## Build plan (each step shipped with phone-size screenshots)
1. `departureScene` (align + spool) wired to the cancel window: new `mode = "departure"`, HUD countdown + cancel button.
2. Warp ramp: streak length/speed easing, flash, edge blur, FOV kick (`transitScene` + host).
3. Arrival: deceleration, destination gate, in-place cross-fade into the world, generalised arrival glide.
4. Prefetch the destination during the cancel window (already there) and assert it is ready before arrival.
