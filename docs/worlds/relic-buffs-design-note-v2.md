# Relic Buffs — Design Note v2

**Status:** DESIGN — drafted 2026-10-29 at the owner's word ("Start the buffs design pass now").
This note is the contract a later build is gated against. **It authorizes no build, no merge, no
deployment by itself** — the build is the owner's separate tap, and the gate (typecheck, both test
suites, production build) runs before any merge ask, as always.

**Supersedes:** `relic-buffs-design-note.md` (Rev 122, DRAFT) — which stays on file as the record
of the first design round and Review 30. This v2 is written against the app as it actually stands
after the relics landed (PR #127, merge `f158e05a`, deploy tip `f3fe4aa6`), not against the app
the first note imagined. Where the old note or the old buffs build (Oct 26–27, built and gated,
never landed) disagrees with the landed code, the landed code wins, and the disagreement is named
in §3.

**How to read this note:** every section opens in plain words — what it means for the person
playing. The technical detail follows as supporting material. Numbers are the design's values;
the reasoning for each is stated where it appears.

---

## §1 What this is, in plain words

The fifteen relics are in the app now: they can be found in their worlds, they land in the Codex,
and finding one pays a small one-time fuel reward. But today a found relic does nothing else. It
doesn't change how anything works, the server doesn't actually know you found it (it trusts the
app's word), and the gate to Eternity's world — which the relics are supposed to open — is closed
to everyone, because the part of the travel system that asks "what relics is this traveler
carrying?" was never connected to any answer.

This design is the second half of the relics:

- **Buffs.** A found relic can be *held* — up to three at a time — and while held it gently
  changes things that already exist: a bigger fuel tank, faster fuel recovery, stronger review
  earnings, a longer memory-resurfacing window in the Deep Past, and so on. Every buff is a gift
  with, for some relics, a stated trade-off. Both are shown in plain words before you pick the
  relic up, and the trade-off leaves the moment you set the relic down.
- **Scarcity.** Relics exist in limited copies across everyone who plays — a small fixed number
  of each, tracked on the server. When every copy of a relic is held, nobody else can find that
  relic until a copy comes back. Copies come back only when a holder lets one go on purpose, or
  when a brain is deleted — never because someone went quiet. The owner gets a switch in his dev
  controls that turns scarcity off for his own testing; his test copies never touch the shared
  pool.
- **A gate that works.** The travel system already knows how to check the gate to Eternity's
  world; this design connects it to the real record of what each traveler has found. Carry the
  Witness Without a Name plus any two other relics, travel the three-leg road, and the way opens —
  once, for good. After that, only fuel.
- **Finds the server can trust.** Finding a relic becomes a server-checked event: you must be
  standing in the relic's world, the copy must exist, and the record is written by the server —
  not taken on the app's word.

Nothing here punishes anyone. Nothing decays, nothing is taken for absence, nothing about a hard
week changes what you can reach. Those rules outrank every mechanic in this note.

---

## §2 Settlements baked in (not open for re-litigation in this note)

These were decided by the owner before this draft. The design builds on them; it does not
re-argue them.

1. **The gate set (B-01)** — settled 2026-10-25, re-confirmed by the owner's tap 2026-10-29: the
   Witness Without a Name plus **any two other relics** opens the gate to Eternity's world. The
   opening is permanent for that traveler; relics are not consumed; after opening, the journey is
   fuel-only. The lore was revised to match (the relics form a required set *for this gate only*).
   The Witness's placement is also settled — by the relics landing itself: the Deep Past, lowest
   stratum, at the First Light basin.
2. **Scarcity is built** — settled 2026-10-29: server-side copy counts — **7 copies** of each
   relic whose home is a public world (Great Station, Scale), **3 copies** of each of Eternity's
   two relics, **1 copy per brain** for relics in the private worlds (Growing Place, Deep Past,
   People, Quiet/Archive). **Plus an owner-only switch** in the dev controls: the owner can turn
   scarcity off for his own space to test; anything he holds with the switch off never enters the
   shared pool. His stated reason, recorded for the rationale: with many people playing, scarcity
   is what stops every world from overcrowding at once — and a future in-app economy and trading
   (both **future vision, explicitly out of this design's scope**) need "rare" to actually mean
   rare.
3. **The return rule** — settled 2026-10-25/26: a copy returns only on **willing release** or
   **brain deletion**, never inactivity. It goes back to a **new place, never the same place
   twice**. It is never handed directly to another traveler. The departure is the **comet**: the
   relic flies off into the sky in an animation the player can pause and watch.
4. **Stacking (H-01)** — settled in the first design round: buffs combine **additively**;
   **at most 3 relics held** (buffs active) at once; where two held relics set the same thing to
   different absolute values (the Deep Past window), the **most recently picked-up wins**, and the
   traveler is told — the winner and the overruled are both named.
5. **Existing mechanics only** — every buff must attach to an operation the app already has. If
   the operation doesn't exist, the buff is **cut, with the reason stated** — never replaced by an
   invented mechanic.
6. **The standing invariants** — never-punish (no decay, no loss, no streak logic, no shame);
   the brain is authoritative and the worlds layer is recoverable; fuel buys speed and spectacle,
   never access; no UTC in anything the user sees; plain language in the interface; name-bearing
   screens use the brain's own chosen name, never a hardcoded one.

---

## §3 What exists today — and what this design keeps, adapts, or drops

Everything below was read from the code on the current deploy tip (`f3fe4aa6`) for this draft —
not carried over from the first note or the old build record.

### The ground truth, briefly

- **The registry.** `packages/shared/src/relics.ts` is the single source of truth for the fifteen
  relics: name, world, resting place, lore, the gate-key flag (the Witness only), and whether the
  relic can be found today. Scale's three relics and the Quiet Archive's two are registered but
  marked not-yet-findable — their worlds exist, but the relic placement isn't wired into those
  scenes yet. The registry carries **no buff numbers**, on purpose.
- **A find, today, is client-side only.** When a relic is visible in its world, the app offers a
  "something glimmers — look closer" moment; tapping it writes the relic's Codex key into the
  browser's local storage (`relics.found.<spaceId>`). The server is never told a find happened.
- **The server's half is a trust-me claim.** The app then claims the entry's one-time fuel reward
  (`POST /api/maintenance/codex-claim`, 4 fuel). The server checks only that the key is a real
  Codex entry — for relics, that the slug is in the catalog. It does **not** check that the
  traveler was in the relic's world, or that any find happened. Any client can claim any relic
  key. (This is the known B-03 hole from the relics landing: bounded to a Codex inscription plus
  one-time fuel — it cannot open the gate — and this design closes it for relics.)
- **The gate machinery already exists — and is unplugged.** The travel ledger
  (`TravelRepo.depart()`) already refuses Eternity unless the gate is open *and* the three-leg
  chain is satisfied, checks inside the departure transaction, with plain-language refusals and
  nothing charged. "Opened" is derived from the ledger itself — an arrived journey to Eternity's
  world — so permanence needs no table. But the holdings question ("does this traveler carry the
  Witness plus two?") is answered by a pluggable callback that **no production code supplies** —
  every call site uses the default "holds nothing." Result: the gate is honestly closed to
  everyone today. Connecting that callback to real holdings is the heart of this design.
- **The chain is already specified in landed code:** 3 legs total, at least 2 intermediate worlds,
  distinct, neither home nor Eternity, arrived at during the current outing; turning back or
  cancelling breaks the chain; you must be standing at the far end. This design adopts that
  specification word for word (§9).
- **The economy seams are all real and unchanged since the first recon:** fuel cap 200 and regen
  3.5/hr in `EconomyRepo`; warp cost 10; review earnings `EARN_REVIEW` 3 at one route; link
  earnings `EARN_LINK` 2 at four sites; discovery earnings `EARN_CODEX_DISCOVERY` 4 at the claim;
  drift bonus 3 with a 2-per-day cap and 30-second minimum, enforced server-side in the space's
  own timezone; the Deep Past rise window is 30 days; goal/skill progress is a per-item 0..1 value
  set through one server operation. **No "Alignment" mechanic exists anywhere** — and none is
  invented here.

### Reconciliation — the old buffs build, piece by piece

The Oct 26–27 buffs build is a reference to mine, not a tree to land. Its dispositions:

| Old-build component | Disposition | Why |
|---|---|---|
| Server buff arithmetic as a pure function of holdings, with floors | **KEEP** | Still the right structure: nothing buffed is ever stored, so setting a relic down restores base values exactly. |
| Preview-before-pickup endpoint (`GET /api/relics/buffs?preview=`) | **KEEP, adapted** | Same shape; it now previews *holding* a found relic (§4) and names the overruled window value. |
| Economy seams (cap/regen, review, link ×4 sites, discovery claim, drift cap, growth multiplier, Shard display swing) | **KEEP** | Every site re-verified at the current tip; constants unchanged. |
| Comet component + release endpoint | **KEEP** | Built against the settled comet contract (pausable, watch-again, reduced-motion still). The relic GLBs exist now, so the departure can use the real model scene-side; no stand-in art either way. |
| Creator/test isolation (`test_only` holdings never counted) | **KEEP** | Now driven by the owner's scarcity switch (§6) instead of an unwired predicate. |
| `releaseAllForSpace` contract for brain deletion | **KEEP** | Still no whole-brain deletion flow exists; the contract is declared for it (§6). |
| Server registry (`packages/server/src/relics/registry.ts`, its own relic table) | **ADAPT** | Becomes a holdings store that reads the **landed shared registry** — there is one source of truth for relics, and it already shipped. No second registry. |
| Inscription-at-discovery model (one state: found = claimed = buffed, limit enforced at inscribe) | **ADAPT** | Split into FOUND and HELD (§4): discovery is unlimited (the landed app already works that way); the limit of 3 applies to buffs-active holdings, which is the only reading that makes the stacking rules meaningful. |
| Codex "Relic blessings" panel section | **ADAPT** | Extends the CodexPanel that shipped with the relics (entries already render there) instead of the pre-relics panel the old build targeted. |
| Client found-store (localStorage as the record) | **ADAPT** | Becomes a cache of server state (§7); the server becomes the record. |
| Gate code (`gate.ts`) + `relic_gate` table | **DROP** | Superseded: the landed TravelRepo gate already enforces B-01 and derives permanence from the journey ledger. A second gate and a table would be two truths. |
| Old jump-chain check (`checkJumpChain`, explicit leg continuity) | **DROP** | Superseded: landed code gets continuity structurally (you can only depart from where the ledger says you stand) and counts distinct intermediates over the current outing. |
| §6 threshold/event system, §7 Eternity-created worlds | **DROP from scope** | Stay direction-only, as Review 30 requires; each needs its own design pass (§12). |

---

## §4 Found, held, released — the three states of a relic

**Plain words first.** Finding a relic and benefiting from it are two different things, on
purpose. Finding is forever: it goes in your Codex, it counts toward the gate, and it claims your
copy of the relic. Holding is a choice you can change any time: you carry up to three of your
found relics, and only those lend their buffs. Letting a copy go entirely — releasing it — is a
third, deliberate act: the relic flies back to the worlds as a comet, for someone else (or you,
another day, in another place) to find.

- **FOUND.** The server records the find (§7). The Codex entry becomes discovered; the one-time
  discovery reward is paid; the relic counts toward the gate set; for counted relics, one copy of
  the pool is now yours. There is no limit on how many relics you can have found — only on how
  many copies exist.
- **HELD (buff-active).** From your found relics, you choose up to **3** to hold. Holding is free,
  instant, and reversible; setting one down costs nothing and loses nothing — the relic stays
  found, its copy stays yours, only the buff leaves. Before you pick a relic up, the app shows
  the combined effect of your would-be held set in plain words (gift, trade-off, and any
  overruled value named) — consent is informed or it doesn't happen. A relic whose buff was cut
  (§11) can still be held; the blessings list says plainly that it lends no blessing. Nobody is
  surprised by a silent no-op.
- **RELEASED.** A two-step, plainly-worded act (§6): the copy leaves you, the buff (if held) ends,
  the comet flies. If you have not yet crossed to Eternity's world and the released relic was part
  of your gate set, the confirmation says so in plain words before you confirm — the gate will ask
  for it again. If you have already crossed, release changes nothing about the gate; the ledger
  remembers the crossing, not the current contents of your pack.

**Where the buffs live.** All arithmetic is server-side, computed fresh from the current held set
on every request. No buffed value is ever stored anywhere — which is what makes set-down exact:
remove the relic from the held set and every number it touched is simply the base number again.

---

## §5 The data model

**Plain words first.** Three small additions, all per-brain, all deleted with the brain: a record
of found copies, a record of returns, and the scarcity switch. No gate table — the journey ledger
already remembers crossings. No stored buff values, ever.

- **`relic_holdings`** — one row per found copy:
  `space_id`, `relic_id`, `found_at`, `test_only` (0/1), `held` (0/1), `held_at` (nullable),
  `anchor_key` (the resting place this copy was found at). Primary key `(space_id, relic_id)` —
  which is itself the enforcement of "one copy per brain" for private-world relics.
- **`relic_returns`** — one row per return: `id`, `space_id`, `relic_id`, `reason`
  (`release` | `brain-deleted`), `from_anchor`, `to_anchor`, `created_at`. This is the audit
  trail that makes "never the same place twice" checkable rather than promised.
- **The scarcity switch** — a per-space flag on `space_meta` (`relic_scarcity_off`), following
  the exact pattern of the existing `research_enabled` flag.
- **Copy limits** live beside the registry in shared code (`RELIC_COPY_LIMITS`): each relic's
  class — `public` (7, counted across all spaces), `eternity` (3, counted across all spaces),
  `private` (1 per brain, enforced by the holdings primary key). Classes are listed per relic in
  §11.
- DDL follows the app's established dual pattern (bootstrap SQL + migration mirror). Both new
  tables join `SPACE_SCOPED_TABLES`, so the deletion census covers them: when a brain goes, its
  relic rows go — after `releaseAllForSpace` has returned its counted copies (§6).
- **Owner spaces.** The server gains one small config: the list of owner space ids
  (deployment config, empty by default). It exists for exactly one purpose — deciding who may
  flip the scarcity switch (§6). It grants nothing else.

---

## §6 Scarcity — the full life of a copy

**Plain words first.** A copy is born when the design says the pool has room — copies aren't
pre-made objects sitting in a warehouse; the pool is a limit, checked at the moment of a find.
A copy is claimed by a verified find, kept for as long as its holder wants it — through silence,
through bad weeks, forever — and it leaves only two ways: its holder lets it go, or the brain
that holds it is deleted. Then it rests in a new place, never the place it last rested, waiting
to be found again. Nobody can hand a copy to a friend directly; the worlds give copies, people
don't.

### The lifecycle, step by step

1. **Availability.** For a counted relic (public: 7; Eternity's: 3), copies available =
   limit − live holdings with `test_only = 0`, across **all** spaces in the deployment's
   database. That database is the universe this design governs; test copies never enter the count,
   on either side of the switch, ever.
2. **Claim.** A verified find (§7) checks availability inside the same transaction that writes
   the holding. If a copy is available, it is claimed: one row, one copy. If the pool is empty,
   the find is **refused kindly** (see below) — nothing is recorded against the traveler, and the
   glimmer stays in the world for a later visit.
3. **Holding.** A claimed copy persists through inactivity, forever. No expiry job, no decay, no
   "use it or lose it" — those are forbidden by the never-punish invariant, and this design has no
   mechanism that could produce them.
4. **Willing release.** The holder's deliberate act (§4). In one transaction: the holding row is
   deleted, a `relic_returns` row is written (reason `release`), the copy re-enters its pool, and
   the response carries the comet event. The returned copy is re-placed at the **next anchor** in
   its relic's rotation — never the anchor it was just found at; the returns ledger records both
   anchors so the rule is auditable. (Anchor pools — at least two resting places per findable
   relic in its world — are scene-side build work under this design; the ledger is what makes the
   rotation honest.) For a private-world relic, the same rule applies within the brain: released
   in your garden, it comes back to a different resting place in your garden.
5. **Brain deletion.** `releaseAllForSpace(spaceId)`: every counted copy the brain holds returns
   to its pool with a `relic_returns` row (reason `brain-deleted`); test copies simply vanish
   with the brain (they were never in a pool); private copies vanish too — they were instantiated
   per brain and there is no other brain they could belong to. The rows are written **before** the
   space's data is deleted, and the holdings/returns tables are in the deletion census, so nothing
   leaks and no count is left lying. No comet plays — there is nobody watching — but the record
   exists, and a future deletion flow that wants the ceremony can read the returns first.
6. **No transfers.** There is no give/pass/trade operation in this design. (Trading is future
   vision; when it is designed, it will be its own pass with its own rules. Nothing here pre-builds
   it.)

### The refused find

When the pool is empty, the traveler has still *seen* the glimmer — the design does not pretend
otherwise. The app says, in plain words, that every copy of this relic is held right now, that
theirs will be here to find when one returns, and that nothing is lost by having come. The find is
not recorded as found (no copy, no inscription-against-a-copy), the discovery reward is not paid
(there was no discovery the server can honestly record), and the encounter stays available on a
later visit. This is scarcity being real, stated kindly — not a punishment: no record, no mark, no
shame, and the way back is open.

### The owner's switch — exact semantics

- The switch is **server state** (the `space_meta` flag), not a client flag. The existing
  `brain.devUnlockAll` browser flag is a display-layer unlock and is deliberately **not** used for
  this — scarcity is server truth, so its switch must be too.
- **Who may flip it:** only a space on the server's owner-space list (§5), enforced server-side on
  every read and write of the flag. The dev-controls UI shows the switch only when the server
  says the space may use it; a crafted request from any other space is refused. For every other
  traveler, scarcity is simply how the world works.
- **While off (for that space only):** the space's finds skip the pool check and are written with
  `test_only = 1`. Everything else works identically — buffs apply, the gate counts the finds
  (the owner's test finds are real finds for his own gate; the isolation is about the *pool*, not
  about his progress), release works. Other spaces see no change: the pool they draw from is
  exactly as if the owner's test copies did not exist.
- **Switching back on:** nothing is taken, nothing is converted. `test_only` is **one-way, per
  holding**: copies found while the switch was off stay outside the pool permanently. Finds made
  after the switch is back on are ordinary claims against the pool. Why one-way: converting later
  could seize a copy another traveler claimed in the meantime, or push a relic past its limit —
  the counts must be true at every moment, not just eventually.
- **The honest consequence, stated now:** with the Witness at 3 copies across everyone, at most
  three travelers can hold the key at any one time, until copies return. That is the owner's
  settled design — discovering Eternity is meant to be the hardest reach in the universe — and
  this note records it as a consequence, not a question.

---

## §7 Discovery the server can trust (closing the B-03 hole)

**Plain words first.** Today the app says "found it" and the server believes it. After this
design, the server checks the one thing it can check with its own records: **you are standing in
the relic's world right now** — because your journeys, which the server keeps, say so. The
encounter itself still happens in the world, in the scene; the server's job is to verify presence,
identity, and scarcity, and to keep the only record.

- **The endpoint.** `POST /api/relics/found { relicId }` — one transaction, checks in order:
  1. `relicId` is a real registry id and is findable today (the server reads the same shared
     registry the client does; a not-yet-wired world's relic is refused plainly).
  2. The space's **derived current world** — from the travel ledger, the same derivation travel
     itself uses — equals the relic's world. Home is nobody's relic world, so a crafted claim
     from the couch fails.
  3. The space has not already found this relic (idempotent: a repeat returns the existing state,
     pays nothing twice).
  4. Scarcity (§6): a copy is available, or the space's switch is off (then the holding is
     written `test_only = 1`).
  5. Write the holding; **grant the discovery reward through the existing claim machinery** (the
     same `codex_claims` idempotency row), at the buffed rate if the Unopened Fold is held (§10).
- **The old door closes.** Once this ships, `POST /api/maintenance/codex-claim` **refuses
  `relic-*` keys** and points at the find endpoint. Non-relic Codex claims are unchanged. Leaving
  the old path open beside the new one would leave the hole open beside the door.
- **The client follows.** The glimmer's tap now calls the endpoint; the local found-store becomes
  a cache, refreshed from `GET /api/relics` (found set, held set, effective buffs, gate state).
  A failed call leaves the glimmer in place with a plain retry line — the app never celebrates a
  find the server didn't record (the standing honesty rule).
- **The honest limit, stated plainly.** Presence proves the traveler journeyed to and stands in
  the right world; it does not prove their eyes found the glimmer. A determined crafted client,
  standing in the right world, could inscribe without the encounter. That residual is accepted:
  the harm is bounded (they still had to travel there; the reward is one-time; copy accounting
  stays true), and closing it would take per-glimmer server tokens — machinery out of proportion
  to the hole. If real multiplayer abuse ever shows up, that is the named upgrade path.

---

## §8 Migration — nobody loses a find

**Plain words first.** People — today, the owner — have already found relics under the old,
trusting rules. Those finds are real. When this ships, every existing find becomes a holding, no
questions re-asked, including any find that came through the old hole: the server's records cannot
tell an honest claim from a crafted one, and punishing possibly-honest travelers to catch a
hypothetical one is exactly what the never-punish rule forbids. The hole closes going forward;
the past is grandfathered, and this note says so out loud.

- **Sources.** Server-side, the only trace of discovery today is `codex_claims` rows with
  `relic-*` keys. Browser-side, each client's local found-store may hold finds whose claim never
  landed (offline, a failed call). Migration uses both:
  1. Every `(space, relic-*)` row in `codex_claims` becomes a holding (`test_only = 0`,
     `found_at` = migration time — the claims table keeps no timestamp; this is bookkeeping,
     never shown as a discovery date).
  2. On each space's **first load after ship**, the client offers its local found keys the server
     lacks; the server accepts them as legacy finds — no presence check (they predate
     verification), written the same way. This sync is **one-time per space**; after it, the local
     store is a cache of server state and unclaimed local keys have no path in.
- **Scarcity accounting for legacy finds.** Legacy holdings consume copies like any other. If a
  counted relic's legacy claims ever exceeded its limit (impossible at today's scale — the
  design names the rule anyway), the limit binds **new** verified finds only; counts self-correct
  as copies return. No legacy holding is ever revoked to satisfy a count.
- **Crafted-claim finds.** Grandfathered with the rest (see the plain-words paragraph). Their
  total possible effect is already spent: a Codex inscription and a one-time 4-fuel reward, both
  recorded. From ship day, the verified endpoint is the only door.
- **The gate after migration.** Holdings from migration count toward the gate exactly like new
  finds — a traveler who honestly found the Witness and two others before buffs existed is not
  asked to find them again.

---

## §9 The gate and the road

**Plain words first.** The gate check already lives in the travel system; this design plugs the
relic record into it. The check happens at the moment of departure, on the server, inside the
same transaction that starts the journey. If the gate is closed or the road is short, the journey
simply isn't admitted — nothing is charged, nothing is written, and the server says in plain
words what the way needs. Once a traveler has *arrived* in Eternity's world even once, the gate
is open to them forever, whatever they later hold or release — the ledger remembers the crossing.

- **Where the check lives.** `TravelRepo.depart()` (landed). The buffs build supplies the real
  holdings callback at the travel routes' construction sites: for the requesting space, the
  holdings store reports `witnessWithoutName` (the Witness is among the space's found relics —
  test copies included; the pool is not the gate's business) and `otherRelicCount` (all other
  found relic ids). The board's state read uses the same callback, so what the traveler is shown
  (`eternityReachable`) is the same truth that will be enforced. No other construction site can
  admit an Eternity departure (missions never target Eternity; tours and the harbor controller
  don't depart there) — an acceptance test pins this (§13).
- **What the check writes.** Nothing of its own. Admission writes the ordinary journey row.
  Permanence is derived from the first arrived Eternity journey (`eternityGateOpened()`), so
  there is no gate row to lose, corrupt, or migrate. The old build's `relic_gate` table stays
  dropped (§3).
- **Two predicates, one truth — a warning to the build.** Shared code contains two similarly
  named gate predicates: `eternityGateOpens(holdings)` in `worlds.ts` (the server's, over the
  holdings interface) and `eternityGateOpen(heldIds)` in `relics.ts` (a display helper over a set
  of ids). Enforcement uses the `worlds.ts` one, fed by the server holdings store. The `relics.ts`
  helper stays display-only, fed by the server's found set, for the Codex gate line. Wiring the
  client helper into a server path is the one mistake this design most wants to prevent.
- **NPCs.** Gate state is per brain: the brain's own NPCs travel from the same ledger and the
  same found set, so an NPC's road to Eternity is gated exactly like its traveler's — it needs
  the brain to have found the relics and to walk the chain. There are no per-NPC holdings in this
  design.
- **The chain (adopted verbatim from the landed specification; this closes Review 30's B-02).**
  - **3 legs total; at least 2 intermediate worlds; no direct jump.** Intermediates must be
    **distinct**, and neither home nor Eternity counts as one.
  - **Eligible intermediates:** any world on the travel allow-list except home and Eternity —
    today: Great Station, Growing Place, Deep Past, People, Quiet/Archive, Scale. (A People leg
    must still pass the People gate for that leg, as today; the chain rule adds nothing there.)
  - **Continuity is structural:** you can only depart from the world the ledger says you stand
    in, so legs connect by construction — no separate continuity check exists or is needed.
  - **The count** runs over the current outing: arrived legs since you last left home. Turning
    back or cancelling breaks the chain (only arrived legs count), and you must be standing at
    the far end — not home — when the last leg is attempted.
  - **No route discovery.** The route board states the requirement in plain words (the landed
    refusal messages do this today). There is no hidden-route mechanic to find.
  - **Worked examples (two intermediates, as required):** Home → Great Station → Deep Past →
    Eternity's world. Home → Growing Place → Scale → Eternity's world. Warp costs 10 per leg
    (30 for the road, if every leg is warped); drift legs are free, as everywhere — fuel buys
    speed, never access, and the gate itself never charges anything.

---

## §10 How buffs add up

**Plain words first.** Every number below is computed on the server, fresh, from the three relics
you currently hold. Nothing is stored, so nothing can go stale: set a relic down and its effect is
simply gone from the next calculation. Where a buff could push a number somewhere unkind, a floor
stops it — a trade-off can slow you, never freeze you.

- **Combination.** Deltas add. Where two held relics name different absolute values for the same
  thing (only the Deep Past window does this), the most recently picked-up wins, and the preview
  and the blessings list both name the winner and the overruled. Setting the winner down lets the
  next most recent held value take over — the calculation just runs again on what's held.
- **Fuel capacity.** Base 200. Harbor Nail: **+25 → 225**. (Only one capacity effect exists;
  additive by rule regardless.)
- **Fuel regeneration.** Base 3.5/hr. Stillness Seal sets **5.0/hr**. Guard floor for any future
  negative delta: regen never below **0.5/hr**. No live relic lowers regen (the one that would
  have is cut, §11).
- **Review earnings.** Base `EARN_REVIEW` 3 per completed review grade. Deltas: First Light Shard
  **+1**, Harbor Nail **−1**, Stillness Seal **−1**. **Floor: 1** — the worst live combination
  (Nail + Seal held together) pays 3 − 1 − 1 = 1, never zero. The buff applies to the review
  component only; the app's separate streak-day bonus, where it applies, is added untouched
  afterward, exactly as the route computes it today.
- **Link earnings.** Base rate `EARN_LINK` 2 per link. Thread of Many: **rate ×2 → 4 per link**,
  at all four earning sites, applied to the link component only (the per-memory component and any
  streak bonus are untouched). The earning sites' existing idempotency is unchanged — the buff
  scales a rate, it does not create new earning events.
- **Discovery earnings.** Base `EARN_CODEX_DISCOVERY` 4. Unopened Fold: **+2 → 6**, at the claim
  machinery wherever a discovery is recorded — including relic finds through the new endpoint.
  Edge, stated plainly: a relic's own buff never applies to its own discovery (the Fold is not
  held yet at the moment it is found), and idempotency is the existing claim row — no discovery
  can pay twice.
- **Drift.** Base bonus `EARN_JOURNEY_DRIFT` 3. Mooring Ring: **bonus +1 → 4**, and the daily cap
  **2 → 3**, enforced server-side in the drift decision (the buffed cap is read where the cap is
  enforced — never displayed by the client and refused by the server). The 30-second minimum is
  unchanged; the count is per day in the space's own timezone, as today. The third drift is an
  additional *permitted* reward, never a requirement: drifting itself stays free, an ineligible
  arrival still completes, and the plain reason is still given. Guard floor: a drift bonus never
  below 1 (no live relic lowers it; the floor is for future deltas).
- **The Deep Past rise window.** Base 30 days. Absolute values: Witness Seed **45**, Lantern of
  Keeping **45**, Thread of Many **20**. Seed and Lantern agree; Thread conflicts with either —
  most recently picked-up wins, disclosed (§4). The server owns the effective window and supplies
  it to the layout; the window never goes below the smallest named value by accident of ordering.
- **Growth.** Progress is set per goal/skill through the existing server operation. Each held
  growth-slowing relic (Witness Seed, Lantern of Keeping, Unopened Fold) subtracts 25 points from
  increases: one held → increases ×0.75; two → ×0.50; three → **×0.25, the floor** — progress
  never stops entirely. Decreases a traveler makes themselves are never scaled; the result is
  clamped to the value's existing 0..1 range by the operation itself.
- **Steadiness (display only).** First Light Shard: the mood curve's points are shown ×1.25,
  clamped to [−1, 1]. Stored emotional weights are never written by buff code; the average and
  volatility the app reports stay the server's true values; emotional state never touches access,
  rewards, or the gate. There is no Steadiness stat — only this one presentation effect (§11).
- **The endpoints.** `GET /api/relics` returns the space's found set, held set, effective buffs
  (the computed values above), the gate state (open / what is missing, in plain words), and recent
  departures. `GET /api/relics?preview=<relicId>` returns the would-be buffs if that relic were
  held, with combined effects and any overruled value named. No timestamps are returned in
  user-facing payloads. `POST /api/relics/found`, `POST /api/relics/hold`,
  `POST /api/relics/unhold`, `POST /api/relics/release` are the writes; every one re-checks its
  preconditions server-side (the preview is advice; the write is the verdict).

---

## §11 The fifteen relics — what each one does

**Plain words first.** Eight relics lend a working buff, the Witness is the gate key, and six
relics' proposed buffs are cut — always for the same reason: the thing the buff would change does
not exist in the app, and this design does not invent mechanics. A cut buff never cuts the relic:
all fifteen remain findable, keepable, scarce, and countable toward the gate's "any two." The
Codex says plainly, per relic, what it lends or why it lends nothing yet.

Constants re-verified at the current tip for every row. "Class" is the scarcity class (§5):
**P** = public, 7 copies across everyone · **E** = Eternity's, 3 copies across everyone ·
**Pr** = private, 1 per brain.

| Relic | World (class) | Gift (while held) | Trade-off | Attaches to | Verdict |
|---|---|---|---|---|---|
| Harbor Nail | Great Station (P) | Fuel capacity 200 → 225 | Review earnings −1 | `EconomyRepo` capacity clamp; review route | **LIVE** |
| Mooring Ring | Great Station (P) | Drift bonus 3 → 4; daily drift cap 2 → 3 | — | Travel drift decision (server-enforced cap) | **LIVE** |
| Dawn Leaf | Growing Place (Pr) | *(proposed: partial milestones count toward growth)* | — | Nothing — milestones exist only as sector counts and episodic captures; no operation feeds them into progress | **CUT** — no existing operation |
| Witness Seed | Growing Place (Pr) | Deep Past window 30 → 45 days | Growth increases ×0.75 | Rise-window value; progress-set operation | **LIVE** |
| First Light Shard | Deep Past (Pr) | Review earnings +1 | Mood curve *displayed* ×1.25, clamped | Review route; mood sparkline (presentation only) | **LIVE** |
| Basin Stone | Deep Past (Pr) | *(proposed: soften emotional swings from unreviewed memories)* | Window 30 → 20 | Nothing — no per-source emotional operation exists; a trade-off alone would be a penalty, not a buff | **CUT** — no existing operation |
| Lantern of Keeping | Deep Past (Pr) | Window 30 → 45 days; a risen memory's presentation holds for the visit (display state only — the memory itself is untouched) | Growth increases ×0.75 | Rise-window value + layout; progress-set operation | **LIVE** |
| Witness Without a Name | Deep Past (**E**) | **The gate key** (§9). No stat buff — the "Alignment" it was once assigned does not exist | — | Travel gate (holdings callback) | **LIVE as key** |
| Hearth Ember | People (Pr) | *(proposed: people-tagged progress feeds the growth signal)* | Regen 3.5 → 2.5/hr | Nothing to feed — progress is per-item and already counts; there is no aggregate signal. (The regen trade-off attaches fine, but a cost with no gift is a penalty, not a buff.) | **CUT** — no existing operation |
| Thread of Many | People (Pr) | Link earnings rate 2 → 4 | Window 30 → 20 days | Link rate at its four earning sites; rise-window value | **LIVE** |
| Star Hanger | Scale (P) | *(proposed: Alignment accrues faster)* | Growth ×0.75 | Nothing — no Alignment mechanic exists anywhere in the app | **CUT** — no existing operation |
| Sunward Compass | Scale (P) | *(proposed: emotional balance holds steady while traveling)* | Drift bonus −1 | Nothing to steady — transit never changes emotional weight (zero emotional references in the travel ledger) | **CUT** — no existing operation |
| Stillness Seal | Quiet Archive (Pr) | Fuel regen 3.5 → 5.0/hr | Review earnings −1 | `EconomyRepo` regeneration | **LIVE** |
| Unopened Fold | Quiet Archive (Pr) | Discovery earnings 4 → 6 | Growth increases ×0.75 | Claim machinery (idempotent); progress-set operation | **LIVE** |
| Unnumbered Fragment | Scale (**E**) | *(proposed: Alignment accrues faster)* | Review −1 | Nothing — no Alignment mechanic (the trade-off maps, but stands alone) | **CUT** — no existing operation |

Notes on the table:
- Scale's and the Quiet Archive's relics become findable when their scenes wire relic placement
  (a relics-side change, already noted in those scenes). The find endpoint serves them unchanged
  the day the registry marks them findable — scarcity class and all.
- Every cut is shown in the Codex in plain words when the relic is viewed — never silently, never
  dressed as a live buff. If a future increment builds a real Alignment mechanic or an aggregate
  growth signal, the cut buffs are the first candidates to revisit — under their own design pass,
  not by quietly switching them on.
- Lore honesty (from Review 30): each relic's **gift** is derived from its lore (§3 of the first
  note carries the hook per relic). **Trade-offs are balancing decisions**, stated as such — the
  design does not pretend the lore proves every number.

---

## §12 What this design does not do

- **No threshold or event system.** The first note's §6 (emotional balance and tab thresholds
  feeding the mutating world, Alignment, and summoned events) stays **direction only**. No
  threshold fires in this design; nothing consecutive-day exists anywhere in it. (§6 also stays
  technically safer this way: no event idempotency problem exists until something fires.)
- **No Eternity-created worlds.** §7 of the first note stays direction only. Nothing here lets
  Eternity create worlds, routes, or relics, or spend anything.
- **No economy or trading features.** They are the owner's stated future direction and part of
  scarcity's *rationale* — they are not designed here, and nothing in this note pre-builds them
  (no transfer operation exists in the data model for exactly this reason).
- **No new stats.** Alignment is not invented to rescue cut buffs. Steadiness is not a stat —
  it is one display effect. Review remains two separate server operations (per-grade earnings,
  per-link earnings) under one player-facing word, calculated independently.
- **No changes** to fleet defense, missions, the station interior, the People gate, or the drift
  rules themselves — buffs read and scale existing operations; they do not rewrite them.
- **No deployment, no merge** — this note is the design. The build is a separate authorization.

---

## §13 Acceptance criteria (what the build is gated against)

Discovery and verification
- **A1.** A find posted for a relic whose world differs from the space's derived current world is
  refused; no holding, no reward, no claim row is written.
- **A2.** A find posted with a made-up relic id, or for a relic the registry marks not-yet-findable,
  is refused plainly.
- **A3.** Repeating a successful find returns the existing state and pays nothing twice (the
  claim row is the idempotency key).
- **A4.** After ship, `POST /api/maintenance/codex-claim` refuses every `relic-*` key; non-relic
  keys behave exactly as before.
- **A5.** The client records a find only on a successful server response; a failed call leaves the
  glimmer available with a plain retry line and shows no celebration.

Scarcity
- **A6.** With 7 non-test holdings of a public relic in place, an eighth verified find (different
  space, standing in the right world) is refused with the plain empty-pool message; holdings count
  is unchanged; no partial write occurs.
- **A7.** Releasing a counted relic returns exactly one copy to its pool (a subsequent find by
  another space succeeds) and writes one `relic_returns` row naming both anchors, the new anchor
  different from the vacated one.
- **A8.** A holding survives arbitrary inactivity: no job, sweep, or read path in the build removes
  or expires holdings. (Verified by inspection + a long-idle fixture test.)
- **A9.** `releaseAllForSpace` returns all counted copies, writes their return rows before the
  space's rows are deleted, and removes test/private copies without pool effects; both new tables
  appear in `SPACE_SCOPED_TABLES` and pass the deletion census.

The owner's switch
- **A10.** A non-owner space cannot read or write the scarcity flag (server-refused), and does not
  see the switch in its dev controls.
- **A11.** With the switch off, the owner space's finds succeed past an exhausted pool and are
  written `test_only = 1`; pool counts for all other spaces are identical whether the switch is
  off or on.
- **A12.** Switching back on converts nothing: previously written `test_only` holdings remain
  `test_only`, and new finds claim against the pool normally.

Gate and chain
- **A13.** With the holdings callback wired, a departure to Eternity from a space holding the
  Witness + any two others, standing at the far end of a valid chain, is admitted; the same
  departure without the Witness, or with only one other relic, is refused with the gate message
  and charges nothing.
- **A14.** After one arrived Eternity journey exists, the gate admits the same space even with an
  empty found set (permanence is the ledger's).
- **A15.** A chain with only one distinct intermediate, or with a turn-back since leaving home, is
  refused with the chain message; the two worked examples in §9 are admitted.
- **A16.** No construction site other than the travel routes can admit an Eternity departure
  (pinned by test/inspection of missions, tours, and harbor paths).

Buffs
- **A17.** Holding is capped at 3 server-side; a fourth hold is refused plainly. Set-down is free
  and immediate; every affected number returns to its exact base value on the next read (no stored
  buffed values exist — verified by inspection).
- **A18.** Review earnings floor: with Harbor Nail + Stillness Seal held, a completed grade pays
  exactly 1 (+ any untouched streak bonus); with the Shard also accounted, deltas add per §10.
- **A19.** Drift: with the Mooring Ring held, the third qualifying drift in a space-local day pays
  4, and a fourth pays nothing with the plain reason; without the Ring, the cap stays 2. Arrival
  completion is never blocked by bonus ineligibility.
- **A20.** Window conflicts: holding Seed then Thread yields an effective window of 20 with both
  the winner (Thread) and the overruled (Seed) named in the buffs response and the preview;
  setting Thread down restores 45.
- **A21.** Growth floor: with Seed + Lantern + Fold held, a progress increase is applied at ×0.25;
  a self-made decrease is applied unscaled.
- **A22.** The Shard's swing changes only displayed curve points (clamped to [−1, 1]); stored
  emotional weights and the reported average/volatility are byte-identical with and without it.
- **A23.** Preview (`?preview=`) shows the combined gift, trade-off, and any overruled value for
  the would-be held set before any hold is written; the hold write re-checks and cannot produce a
  state the preview didn't describe.

Migration
- **A24.** Every pre-ship `codex_claims` relic row becomes a holding; a space's one-time local
  sync adds its unclaimed local finds; no pre-ship find is lost, and no legacy holding is ever
  revoked by a scarcity count.
- **A25.** A migrated holding counts toward the gate exactly like a new find (A13 passes on
  migrated state alone).

Honesty and invariants
- **A26.** No user-facing string in the build contains a UTC timestamp; gate, pool, and blessing
  messages are plain language; name-bearing UI uses the brain's chosen name (none is hardcoded).
- **A27.** No decay, expiry, streak, or shame path exists anywhere in the build (inspection
  checklist against §2's invariants), and emotional state is read by no buff, gate, or scarcity
  code path.

---

*End of design note v2. Companion record: `buffs-design-pass-record.md` (workspace) — ground truth,
reconciliation working, and push verification. The first note (Rev 122) and Review 30 remain the
record of round one.*
