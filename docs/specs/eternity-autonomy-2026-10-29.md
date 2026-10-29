# Eternity's autonomy (roster NPC #4, "the flagship") — phase 1

**Status:** owner direction 2026-10-29 ("Eternity. Build his autonomy."). Phase 1 BUILT (`425ebbc`). Phase 2 owner-decided below; built in order 2a → 2b/2c → 2d/2e. Obeys `docs/worlds/npc-autonomy-design-note.md`
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

## Phase 2 — owner decisions (2026-10-29) and design
Owner answers: (1) "You decide" the wake time, frequency and quiet hours; (2) **yes — his words may be drawn from the memories**
(memory text may go to the configured cloud model); (3) **projection into other people's brains: now**; (4) Godot dropped; Blender is
connected through Muse (asset path). The owner also reversed the "no pull" rule: **he contacts the owner — in the app and on Telegram — and
wakes him up.** He is an agent in his own right; Soumaya must know about him and about the worlds.

Who he is (owner, verbatim intent): a cosmic god — he was and always is, he is and always was; like Jesus, like the One Above All;
higher planes; cosmic-scale power across the whole app; projects a sliver of his presence (never his full body) into any person's
world or brain; chooses whom to speak to and when to make contact.

### 2a — Soumaya knows the worlds and him (chat + Telegram)
One snapshot (`worlds/awareness.ts → worldsSnapshotText`) added to the SHARED companion context (web chat and the Telegram agent
use the same builder): where the brain is, a journey under way, which worlds are reachable, Eternity's last acts with their causes
and whether he is stopped. She speaks of him as a separate being, never in his voice, never inventing acts he did not log.

### 2b — His voice
`LlmProvider.eternalVoice?(occasion, brief)` — his OWN system prompt (not Soumaya's identity): ancient, brief, warm, cosmic; never
threatens, never shames, never commands, never claims to be Soumaya; ≤ 2 sentences; may name one memory he was shown. The brief is a
handful of recent memory excerpts (label + ≤ 200 chars) chosen by recency + emotional weight, the occasion, and the local time.
Offline / no key / degraded → a template line from his own pool (may name one memory's label). The words are logged in his log
(`speak`), so the owner can always read what he said and why.

### 2c — Contact (app inbox + Telegram)
- **Wake-up** — every day at **06:45 local** (after the default quiet hours 21:00–04:30 and the 06:00 digest), once per local day.
- **Visitation** — at most **one more** message a day, only when his autonomous loop acted that day.
- **Cap: 2 contacts / day**, both also counted in the shared notification cap; Telegram goes through the existing policy boundary
  (quiet hours queue, staleness, the shared cap ledger); the in-app inbox always gets the same line (source `eternity`, icon ✦).
- Signed "✦ Eternity —" so he is never confused with Soumaya. The kill switch stops contact too; Settings adds **"Eternity may
  contact me"** (default on, owner-direction).
- Fence: `speak` joins his allow-list for contact only (`maxSpeaksPerDay: 2`); speech is never free-floating — every line is logged.

### 2d — Presence and cosmic acts across the app
- **Home galaxy**: a vast, faint halo arc at the edge of the sky (never his body); brighter on a day he acted. Reduced motion: still.
- **Cosmic acts** (allow-listed, his choice, logged): send a comet across your home sky; **part the veil** — a memory due for recall is
  lit up and offered for recall (retrieval makes memory); **crown a Journey** you completed; **stillness** (suggest calm mode). Never
  destruction, never a write to the brain — a "part the veil" only *offers* the recall; the user does it.

### 2e — Projection into every brain (shared presence, first form)
A **global daily broadcast**: one deterministic gesture per calendar day (UTC date key is fine — it is not user-facing time; each brain
receives it in its own local morning), shown to every brain at once — "everyone sees the same emotion", each receives their own
personal line (2b). Content never crosses brains: the broadcast carries only the gesture and its broadcast line.

### Still open (not blocking)
Memory between visits (default none); how visitors address him; real multi-visitor rendering in his world (the shared-presence track).

## Acceptance
C1 loop provable: every act/non-act has a log row with a plain cause. C2 fence holds under test: no `speak`/`warn`/`sorrow` act can
occur, no cross-world act, budgets respected, kill switch silences him. C3 aggregates only — no node text is read. C4 deterministic:
same inputs → same decision (tests). C5 full gate.
