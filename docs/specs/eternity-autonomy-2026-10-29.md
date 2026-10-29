# Eternity's autonomy (roster NPC #4, "the flagship") — phase 1

**Status:** owner direction 2026-10-29 ("Eternity. Build his autonomy."). Obeys `docs/worlds/npc-autonomy-design-note.md`
(branch `design/worlds-vision`) and `eternity-world-design-note.md` §2/§7: *Eternity alone initiates — rarely, on cosmic alignment
(D-72); free will inside the fence; never writes to a brain; budgeted; kill switch; every act logged with its cause; nothing
shown as a score; a visitor who never comes gets no pull, no penalty.*

The note's roster order puts him fourth (after the keeper and guide). The owner has asked for him now; the framework
(`server/src/npcs/*`) is NPC-generic enough that he is built as a second NPC through the same loop, one NPC, own design.

## Phase 1 (this build): autonomous, deterministic, no LLM, no brain content
What he does on his own — **allow-list: `gesture`, `reorder-light`, `wait`** (no `speak`, no free text):
- **gesture** — one of Stillness, Regard, Blessing, Joy. His in-world line is the existing gesture line (already on the
  floating tablet, with the heavens' shake). **Sorrow and Warning are never autonomous**: their lines presume knowledge of the
  visitor ("the grief you did not mention", "that road you are eyeing") — an NPC never narrates knowledge it does not have,
  and he never admonishes. They remain the visitor's own tools.
- **reorder-light** — "Reorder the heavens" (the veils drift to a new order). Wonder, nothing taken.
- **wait** — a logged non-act with its cause (never a gap).

**Cosmic alignment (D-72)** — computed on the server from *coarse aggregates only*: how many memories the brain added in the last 30
days and their average emotional weight. **No content is read, nothing leaves the server, it is never displayed and never a
number.** Below the threshold he waits; above it he may act.

**Bounds (owner-set numbers in code, not model-set):** at most one autonomous tick per 6 hours; at most 3 acts per space-local day;
a stopped NPC does nothing at all. The loop stays **lazy** (runs when the client reads him — only while the visitor is in Eternity),
so no timers, and a visitor who never comes sees nothing.

**Fence:** `checkFence` (kind on the allow-list, act in his own world) runs before every act; he cannot write to a brain (the loop
touches only `npc_*` tables and reads the brain's aggregates read-only); structural acts do not exist in his vocabulary.

**Owner's controls:** Settings → *Eternity (autonomous)* shows his state, today's acts, and his log (act + plain cause), with **Stop / Resume**
(the existing kill switch, logged).

**In the world:** while the visitor is in Eternity, the web asks for his state about every 5 minutes; a *fresh, unseen* act
(< 15 min old) plays once — the gesture (and its tablet line + shake) or the reorder. Reduced motion: the same acts, using the
scene's own reduced-motion rendering (no shake). Nothing replays on re-entry.

## Phase 2 (needs the owner — NOT built)
1. **Words from the visitor's own brain** (guidance/comfort "drawn with consent from what the brain surfaces"): requires a
   consent switch, a decision on whether memory text may be sent to a cloud model at all, and his own model/key (note Q1).
   Recommended default when built: the existing provider seam with the heuristic fallback, memory excerpts only after an explicit
   per-session consent, never stored in his log.
2. **Memory between visits** (note Q2): default stays *none*.
3. **Shared presence** (one being, many visitors): a separate design-only track.
4. **Projection / flicker into the home galaxy** (note §7): later; needs the home scene.
5. Who he addresses and how visitors address him (note Q3): open.

## Acceptance
C1 loop provable: every act/non-act has a log row with a plain cause. C2 fence holds under test: no `speak`/`warn`/`sorrow` act can
occur, no cross-world act, budgets respected, kill switch silences him. C3 aggregates only — no node text is read. C4 deterministic:
same inputs → same decision (tests). C5 full gate.
