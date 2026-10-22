# Station Phone-Run Sheet — the §11 Evidence Session

**Purpose:** produce every piece of evidence the Station mockup is graded on, in one guided sitting (plus the soak when time allows). **Scene under test:** `docs/worlds/mockups/station/` — the file is identical at Revisions 31–32 (blob `26ab22c`); record the commit you served from. **Rule:** numbers without an environment record don't count (§11). Nothing here changes any threshold.

---

## 0 · Setup (≈2 min)

1. Serve the folder on any computer on the same Wi-Fi: `npx serve .` inside `mockups/station/` — or any static server. Open the address on the phone.
2. Fill in before you start:
   - Phone model: ______________ · OS + version: ______________
   - Browser / runtime + version: ______________
   - Commit served: ______________ · Network (Wi-Fi / data): ______________
3. Read the HUD's **cold-load** figure (navigation → first frame, shown in the HUD and repeated in every measurement block). Bar: **≤ 5 s**.

## 1 · Behavior checks (≈3 min) — read each verdict off the on-page log

1. **Load cargo** → log should show the fixture memory aboard (A1).
2. **Warp to the Station** (starts the 1.2 s countdown) → **Cancel departure** inside the window → log verdict (camera, fuel, cargo, state unchanged?).
3. **Warp to the Station** again, let it fly → mid-flight, **Turn back** → log verdict (origin pose + cargo identity/home restored?).
4. **Warp** once more and let it arrive (you're testing the approach too — watch the handoff).
5. **Drain fuel (test)** → **Warp** → log should show the refusal and its reason.
6. **Return home** → should fly home free; log verdict (fuel unchanged).
   *Optional:* during step 2's countdown, try pressing other buttons — they should refuse and say why (armed-departure policy).

## 2 · Performance — the 300 s session (≈5 min)

1. Press **Measure 300 s (§11 session)**.
2. While it runs, fly the script: Far → Handoff → Near stages · one warp · one drift · ~30 s idle · free flying.
3. At the end, copy the printed block. The graded figures: **avg FPS** (bar ≥ 50) · **1% low** (≥ 30) · **longest frame** (≤ 100 ms — a stall stretches animations by design; the stall itself is what's graded) · **PEAK draw calls** (≤ 200; hard fail > 500) · **PEAK visible triangles** (≤ 750,000 — a rejection boundary, not a target).

## 3 · Soak — 900 s (when time allows)

Press **Measure 900 s (soak)** and leave the scene flying/idling ~15 min. Record the end block **and**: any crash? visible slowdown as the phone warms? Note both plainly — "no crash, no slowdown noticed" is a valid record.

## 4 · Reduced motion (≈5 min)

Toggle **Reduced motion** ON. Repeat §1 quickly (flights become instant cuts; the ring holds still; traffic freezes — all expected) and, if time allows, one **Measure 300 s** run. Record the block. Same bars.

## 5 · Visual evidence (D-13 + V3)

1. **Stills:** at each stage — **Far**, **Handoff**, **Near** — with sun *and* Station in frame, press **Capture still** (saves a PNG). Three files.
2. **Approach recording:** start the phone's screen recorder, go **Far**, then fly the approach to **Near** in one continuous take (a warp arrival is fine). Stop. This recording is the V3 evidence — watch it once yourself for popping/flicker at the handoff and say honestly what you saw.

## 6 · Send back

- The filled environment line (§0) · cold-load figure
- The behavior log verdicts (copy the log text or screenshot it)
- The 300 s block · the soak block (or "not run yet") · the RM block
- The three stills + the approach recording
- Your own plain-words impression: did it feel like one universe? Did the Station read as a place? (That feeds V1/V2/V6 — your call alone.)

Grading then happens criterion by criterion against §11.2–11.3, per the review standard: a criterion without evidence stays UNRESOLVED, any failure blocks advancement, and the bar is never lowered after results.

*Run sheet v1 — accompanies `mockup-result-station.md`; the acceptance checklist framing is Review 15's.*
