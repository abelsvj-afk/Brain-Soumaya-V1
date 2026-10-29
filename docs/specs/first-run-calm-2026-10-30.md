# First run: one thing at a time (audit X1/X2)

**Status:** owner direction 2026-10-30 ("fix the first-run overlay pile-up next"). Source: `docs/AUDIT_SPEED_UI_UX_2026-10-29.md` X1/X2.

## Measured (412×915, fresh brain)
Welcome card → Observatory (3.4 s after) → the "Reading your galaxy" legend on its OWN 5.2 s timer (no check for the
Observatory) → when the Observatory closes, every buffered toast flushes at once (up to 4 on screen) on top of the legend; Codex
discoveries are posted at HIGH priority, so routine news wears an "URGENT" badge; the "switch to Performance Mode?" prompt can
appear over all of it.

## Rules
1. **One overlay at a time, in order:** Welcome → Observatory → legend. The legend waits until the Observatory has been closed
   (and no panel is open), then 1.5 s.
2. **Toasts wait for the overlays:** held while the Welcome card, the Observatory or the legend is up.
3. **A held queue releases at most 2** (most important, then newest); the rest are already in the Inbox and are summarised by
   one "N more in your Inbox" note that opens it. Live toasts on screen: at most 3.
4. **Urgent means urgent:** routine discoveries are normal priority (no URGENT badge).
5. **The lag prompt** only appears when no first-run surface is open (it already asks once per session).
