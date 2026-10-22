# Soumaya Task Board

Last audited: 2026-06-20. Tracks all open work, each item tagged with its zone and current state.

> **⚠️ STALE (flagged 2026-08-25):** this board hasn't been re-audited since 2026-06-20, predating
> roughly two months of active commits. Items below may already be done, superseded, or no longer
> relevant. For current state, see **[CLAUDE.md](./CLAUDE.md)**'s top-of-file STATUS line and
> **[GEMINI_CHANGES.md](./GEMINI_CHANGES.md)** (newest-first change log, both kept live).

**Zone key:**
- 🟢 Green — `agy` can build freely
- 🔴 Red — Claude only (shared types, DB schema, provider seams, route contracts, multi-tenancy)
- 🟡 Both — split across the boundary; coordinate before starting

**Status key:** `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Autonomy & Agent Hardening

- [x] 🔴 **Performance fix: `/next-job` full scan** — ✅ mitigated. The O(n) knn-per-node merge scan is now
  bounded to the most-recent `MERGE_SCAN_LIMIT` (50) memories in `selectJob` (duplicates arrive with new
  input). Full `last_maintained_at` cursor still possible later, but the per-tick cost is no longer O(n).
- [x] 🔴 **Job claiming / idempotency** — ✅ done (in-memory). `withClaim` in `maintenance/agent.ts` records
  each issued job's signature for 20s; a concurrent poller (server loop + browser tab on the one Fly
  process) gets a harmless patrol instead of re-running it. (A DB `claimed_at` lock would be needed only
  for a multi-instance deploy — noted in code.) +1 test.
- [x] 🔴 **LLM planning agent** — ✅ done (planner hook). Optional `planJob?` on the LlmProvider seam (openai +
  gemini impl; heuristic omits; resilient forwards). `selectJob` is now async: when a cloud planner is
  available it chooses between the deterministic ladder's pick and a strategic research-gap alternative —
  the ladder stays the always-available fallback (absent/erroring planner → unchanged behavior, 97 tests).
- [x] 🟡 **Sub-agents running real maintenance jobs** — ✅ done (Red half). Additive `nodes.agent` column
  (bootstrap + migration) + `GraphNode.agent` + `NodesRepo.setAgent`; research deep-dives stamp
  `agent='soumaya'`. The visual Scout-loop attribution in `graph/subAgents` (Green) can read it next.
- [x] 🟡 **Request-Maintenance high-priority queue** — ✅ done. `POST /api/nodes/:id/request-maintenance`
  enqueues a node into an in-memory per-space queue that `selectJob` drains first (research → connect →
  recalibrate by availability); NodeInspector has an "🛰️ Ask Soumaya to tend this" button. +1 test.
- [x] 🟡 **Surface `remind_at` reminders in daily digest** — ✅ done (digest). `buildDailyDigest` adds a
  `reminders` field (memories whose `remind_at` ≤ now), rendered as an "⏰ Reminders due" section in the
  Insights panel + folded into her closing line. (Telegram formatting of the same still pending.)

---

## Fleet & Visitor Visuals

- [ ] 🟡 **Defender sub-agent 3D model (`defense-ship.glb`)** — logic exists, no visual. Asset must be provided by user; wiring into `graph/subAgents` procedural fallback → GLB swap is Green.
- [ ] 🟡 **Visitor craft models (`visitor-traveler.glb` / `visitor-wanderer.glb`)** — procedural saucers are placeholders. Asset = user provides; GLB loader swap = Green.
- [x] 🟢 **Literal beacon dispatch animation** — Soumaya flies to position and releases a beacon visually. Pure `graph/soumaya.ts` animation work, no backend touch.
- [x] 🟢 **Defender live drifter intercept** — wire real visitor positions from `visitors.ts` into `subAgents.update` so the Defender actually flies to intercept drifters. `graph/subAgents` only.
- [x] 🟡 **Formalize alien attraction scoring function** — ✅ done (in `graph/visitors.ts`): a weighted score over
  emotional intensity, emotional rarity vs the brain average, mass, link density, recency decay, and a revisit
  penalty, with a geometric pick over the top candidates. Visitor activity surfaced in the List (👽 counts).

---

## Memory & UX

- [x] 🟢 **"Writing..." latency feedback on nodes during LLM processing** — show a pulsing state on a node's orb while its job is in flight. Frontend component state only.
- [x] 🟢 **Brain-like filaments at macro zoom** — neuron-like connecting filaments visible when zoomed far out. three.js / `Graph3D.tsx`, no backend.
- [x] 🟢 **Neural recall-signal animation** — fire synapse-style pulses along the path from seed node to each cited node during a chat response (`fireRecall(citationIds)` in `Graph3D.tsx`).
- [x] 🟢 **Per-memory story arcs in object lore** — space station + ship lore tied to specific memory relationships (`graph/objectLore.ts`). Explicitly Green Zone file.
- [x] 🟢 **In-app PWA Install button** — capture `beforeinstallprompt` event and show an "Install" button in the UI. Frontend only.
- [x] 🟡 **Daily Log Onboarding / Genesis Log** — ✅ done (log). A brand-new brain gets its first Captain's Log
  offline as soon as it has a memory (`selectJob` genesis branch). New-brain UI hero already lives in the Observatory.
- [x] 🟢 **Make link curvature/opacity zoom-bias live** — `linkColor`/`linkCurvature` read `camera.position.length()`, but react-force-graph only re-evaluates link accessors on `refresh()`/data change, so the "curve more when zoomed out" bias is currently inert during a pinch/scroll. Drive it from the tick (or periodic `refresh()`) if we want it continuous. (Claude review note, 2026-06-20.)
- [x] 🟢 **Cap idle-pulse density for very large brains** — `idlePulse` scales links/frequency by node count (`floor(numNodes/10)` links, down to every 1s). Fine now; add an upper clamp before brains hit thousands of nodes so it can't flood `emitParticle`. (Claude review note, 2026-06-20.)

---

## AI Companion & Persona

- [x] 🟡 **Behavioral "Knows Me" persona deepening** — ✅ done. `persona/derive.ts` now folds capture cadence
  (memories/week), recent focus (themes from the freshest memories), and link-density connectivity into the
  auto-derived persona.
- [x] 🔴 **LLM-authored lore prose** — ✅ done. Optional `chronicle?` on the LlmProvider seam (openai + gemini
  impl; heuristic omits it; resilient forwards). The lore evolve route best-effort upgrades the heuristic
  chapter to richer LLM prose when a cloud key is present — offline chronicler stays the always-on base.

---

## Telegram

- [x] 🔴 **Phase D: Voice notes via cloud TTS** — ✅ built behind the gate, **disabled by default** (owner Q3 → env switch OFF). `server/src/telegram/tts.ts`: `ttsConfig()` gate (`TELEGRAM_TTS_ENABLED` + `TELEGRAM_TTS_API_KEY` + `TELEGRAM_TTS_VOICE_ID`; provider `elevenlabs`), `SpeechSynthesizer` seam requesting OGG/Opus for `sendVoice`, `dramatize.ts` prosody → ElevenLabs `voice_settings` (rate→speed, intensity→stability). `bot.ts` `deliverReply` speaks conversational replies only; text is default + fallback (gate off, >1000-char cap, provider/sendVoice failure, quota HTTP 402 fail-soft). **Selective by default** (`TELEGRAM_TTS_MODE=selective`): spoken only for `/voice on` chats or replies to user voice messages; `=all` opts into every reply. Synthesized audio is cached in `tts_audio_cache` (hash of voice+model+prosody+text) — unchanged replies replay free while cached, not forever (an evicted entry, a concurrent miss, or a failed cache write re-synthesizes and re-bills). Secrets documented in `plans/telegram-and-autonomy.md`; NOT set — enabling is the owner's separate call.
- [x] 🔴 **ADR-018: global notification cap + per-space TTS cache ownership** — ✅ implemented on branch `adr018-impl` (Phases B–D; NOT merged, NOT deployed, features remain unarmed). One shared `notification_cap_claims` ledger is now the sole cap-counting authority across Telegram + push (space-local day; atomic claim+outbox-flip in one transaction; Option A fresh-urgent exemption recorded as `cap_exempt`); every retry reclassifies urgency/staleness from persisted due-time columns (`remind_at`/`bill_due_at`) instead of `created_at` or the persisted urgent bit; legacy reminders without a due time drop as unverifiable. `tts_audio_cache` rebuilt space-owned (legacy rows purged), `DbSpeechCache` space-scoped, deletion census covers cache + claims transactionally. Gate: typecheck 0 · server 1857/1858 (sole failure = pre-existing date-rotted `parityPhase4` fixture, proven on base) · web 1314/1314 both TZs · build 0 · falsification (cap bypass / cache unscope / census removal) each caught by its tests. Design contract: `docs/ADR-018-…` on the design branch; architecture summary in `docs/architecture.md`.

---

## Infrastructure

- [ ] 🟢 **Restore CI (`ci.yml`)** — typecheck → test → build, no deploy step. Template documented in `DEPLOYMENT.md`. Green Zone infra/YAML work; only unblock when GitHub Actions runners are available on this account.
- [x] 🟡 **Richer offline ingestion queue** — ✅ done (client). `ingestText` queues to localStorage when offline
  (or on a network blip), throws a friendly `OfflineQueuedError`; `flushIngestQueue` drains on reconnect
  (`online` event) + on sign-in, re-queueing failures, and dispatches `brain-ingest-synced` → App refreshes
  + toasts what synced. Uses the existing /ingest endpoint (no new server contract needed).
- [x] 🟡 **PDF/DOCX parsing for knowledge docs** — ✅ done (client-side). `lib/extractFileText.ts` extracts
  text in the browser: PDF via pdf.js, DOCX via mammoth (both dynamically imported → code-split, lazy),
  .txt/.md as before. Keeps the server dependency-free (sends extracted text through the existing
  /documents endpoint). CompanionPanel accepts .pdf/.docx and shows char count.

---

## Beta polish — "living neural web" feel (new, 2026-06-20, from user session)

> **Design:** [`plans/living-brain.md`](./plans/living-brain.md) — phased plan agreed with the user.
> Phase 1 (visual web, 🟢) delegated to agy; Phases 2–4 (placement/decay/fuel) led by Claude.

- [x] 🔴 **Phase 0 — slow, earned celestial growth** (Claude) — memories born as asteroids, grow
  via connections/insights/age (not instant importance); rings gas-giant-only; tiers stay distinct.
  Fixes "everything's a ringed planet in 24h." See design doc Phase 0.
- [x] 🟢 **Phase 1 — persistent glowing web + ambient firing** (agy) — legible links at distance
  (cures "connections gone = faint"), neuron-style ambient firing/cluster lights, marquee `dt`
  fix, link flicker-when-close fix, `NodeList` `demo` prop. Pure `Graph3D.tsx`/CSS. See design doc.
- [x] 🔴 **Phase 2a — Soumaya ferries & places new memories** (Claude) — new memories park at the
  waystation dock; she flies out, tows each into its live orbit slot, drops it (orbit system resumes),
  blooms it. Additive `hold/release/slotOf` seam in `orbits.ts`; `placePickup/placeCarry` modes in
  `soumaya.ts`; new-node detection in `Graph3D.tsx`. Safe fallback (releases → normal placement).
- [x] 🔴 **Phase 2b — deletion into the Sun** (Claude) — on delete, Soumaya flies to the memory's
  spot, drags a cargo replica into the Sun (clamped so she never enters), and it's consumed in a
  fiery burst + corona flare. `effects.ts` (consume pool) + `sun.ts` (flare/getRadius) +
  `soumaya.ts` (removeTravel/removeCarry + cargo) + `Graph3D.tsx` (deletion detection).
- [x] 🟡 **Phase 3 — links decay & she repairs them** (Claude) — link freshness decays with neglect
  (folded into `getLinkActivity`, so stale links fade), and a throttled scan hands the most-degraded
  visible links to Soumaya to re-forge (refreshing them via `fireLink`). Client-only (no schema);
  `Graph3D.tsx` only.
- [x] 🟡 **Phase 4 — fuel legible + slow regen** (Claude) — ⛽ fuel gauge on the main HUD with an
  earn/spend tooltip (`App.tsx`/`index.css`); lazy passive regen (~2/hr, on read) in `economy.ts`
  (RED). Visual growth (placement/web/firing/repair/deletion) stays fully ungated.
- [x] 🟢 **Confirm edges persist + return on reload** — verified: edges persist (weight ≥0.6) and
  the graph route returns them space-scoped; "gone" was faint rendering (→ Phase 1), not data loss.
- [x] 🟢 **Differentiate ＋ icons (add vs zoom)** — delegated to agy as issue #6.
- [x] 🟢 **Restore dock tab names on mobile** — delegated to agy as issue #6 (regressed by #4's wide-screen-only labels).

---

## 🎮 Gamification / Immersion (make the brain-galaxy *fun*, not just useful)

> Goal: reward returning + exploring, give Soumaya real warmth, and make growth feel earned and
> celebrated — without breaking the Obsidian-grade utility or the offline path. Sequenced quick-wins →
> deeper. Builds on systems we already have: **Fuel/economy**, **entropy** (cooling), **insights**
> (latent links), **constellations**, **daily_logs**, the **lore engine**, and **Soumaya** herself.
> Rewards are always ADDITIVE — they must never gate core utility. Keep the gate green + offline-safe.

### Wave 1 — quick wins (cheap, high delight; mostly 🟢 frontend)
- [x] 🟢 **Return greeting** — on open, Soumaya greets you by space name + references the last daily log /
  what changed while away ("Welcome back — 3 memories cooled, I found 1 new connection"). Uses
  `daily_logs` + `getGraph`. UI in `App`/`SoumayaPanel`.
- [~] 🟢 **Discovery toasts** — transient celebratory banner on notable events: "✦ New constellation: <name>",
  "Soumaya linked '<a>' ↔ '<b>'", "'<label>' grew into a planet". Diff `insights`/`constellations`/mass-tier
  on refresh; pure client.
- [x] 🟢 **Milestone bodies** — your Nth memory (10/50/100/365) gets a one-time celebration + a permanent
  badge/glow. Client-side from node count + creation order.
- [ ] 🟢 **First-run / genesis moment** — empty brain shows a warm "drop your first thought" prompt; first
  memory gets a big bloom + Soumaya's first words. (Pairs with the Daily-Log onboarding item above.)
- [ ] 🟢 **Fuel feedback** — the ⛽ HUD chip shows progress to the next "tank" + a tiny "+N" pop when you
  log/link/clear an action. (Fuel is already surfaced; add the juice.)

### Wave 2 — engagement loop (🟡 light server)
- [x] 🟡 **Streaks** — ✅ done (Wave 2). Consecutive days you fed the brain a memory. Server-authoritative
  (`streak.ts` `StreakRepo` over additive `space_meta` columns streak/streak_best/last_active_date —
  bootstrap + idempotent migration), advanced on ingest with a once-per-day +2 fuel bonus
  (`STREAK_DAY_BONUS`), exposed at `GET /api/maintenance/streak`. UI: 🔥 HUD chip + a banner atop the
  Awards tab; lapses to 0 (shown honestly) but keeps your best. Space-scoped, offline-safe, 4 tests.
- [x] 🟡 **Daily quests / tend list** — ✅ done (Wave 2, v1). `components/quests.ts` derives 1–3 live
  click-through nudges (feed today / warm a cooling memory / revisit a drifting one) from graph state,
  shown as a "Today's tending" card in the Observatory. (Deferred: per-day fuel reward on completion —
  needs server-side daily counters.) Completed as a client-only system in Immersion Round 3 (owner
  decision Q1): honest per-day completion with stable daily targets in `quests.ts`; the server Quest
  Board in `plans/streaks-and-quests-spec.md` was NOT built, and the per-day fuel reward remains
  unshipped — quests promise no fuel.
- [x] 🟢 **Achievements** — ✅ done (Wave 2). 7 qualitative feats (First Light, Synapse, Connector, Nexus,
  Star Born, Gardener, Fully Fueled) in `components/achievements.ts`; unlock-detect effect in `App.tsx`
  persists per-brain in localStorage (`brain.achv.${space.id}`), seeds silently on first eval, toasts new
  unlocks. **Awards tab (🏆)** in the dock (`components/AchievementsPanel.tsx`) is the persistent trophy
  case: unlocked + locked cards with progress hints, an X/7 bar, and a memory-count milestone tracker.
  Offline-safe, no migration. (localStorage v1; `space_meta` JSON sync is a future 🔴 upgrade.)

### Wave 3 — companion warmth + progression (🟡/🔴)
- [ ] 🔴 **Behavioral persona deepening** — Soumaya's tone adapts to your patterns/history (also under AI
  Companion). Makes her feel like she *knows* you. `persona/derive.ts`.
- [x] 🟢 **Soumaya reactions** — ✅ done (v1). She reacts in her own voice to new connections on ingest
  (1 / 2 / 3+ links get distinct lines) via a toast; tier-up + rank toasts cover the celebratory side.
  (Deferred: in-world speech bubble + a concerned reaction to mass cooling.)
- [x] 🟢 **Galaxy "rank" / level-up** — ✅ done (Wave 3). Pilot rank (`components/rank.ts`): 8 named tiers
  (Cadet → … → Voyager) by memory count, shown as a banner atop the Awards tab with a progress bar, plus a
  per-brain level-up toast. Same progression that speeds Soumaya up. (Deferred polish: sun grows at rank-ups.)
- [ ] 🟢 **Cinematic intro** — on load, a brief camera flythrough that settles into the framed galaxy (now
  that framing is fixed), so opening *feels* like arriving somewhere.

### Guardrails
Offline-safe (no reward hard-requires the LLM), bounded, gate stays green. Server bits (streak/achievement
persistence) are 🔴 additive `space_meta`/migration; all the feedback/visual juice is 🟢.

---

## Finance — Bill Lifecycle Repair (ADR-019; design settled 2026-10-22, implementation NOT authorized)

Design of record: `docs/ADR-019-bill-lifecycle.md` (decisions: `docs/financial-os/decisions.md` D8).
Sequencing: this repair lands before any new Money-tab features. Gate: PROJECT_STATE.md
"2026-10-22 — ADR-019 bill lifecycle" checklist must be owner-confirmed first.

- [x] **Design:** four lifecycle decisions settled (Paid/Remove/Edit/Skip) + corrections
      D4–D11 + transaction boundaries/invariants + acceptance tests T1–T20 (branch
      `design/money-bill-lifecycle`, docs only). Includes design-review revision R1
      (settlement marker, eligibility rule, claim-first Paid, I2a/I2b split).
- [ ] **Migration:** additive `balance_applied_at` on `fin_income`/`fin_expense`
      (migrateSchema-only, PRAGMA-guarded, legacy rows backfilled as applied) —
      ADR-019 §8 as revised by R1.
- [ ] **Paid (atomic, claim-first):** guarded claim flip first, then expense + balance
      deduction + `paid_expense_id` link in the same transaction; a losing claim
      writes nothing; match-existing-expense path; failure leaves occurrence
      unpaid. (T1–T3, T15, T20)
- [ ] **Remove:** stop recurrence + cancel future occurrences atomically; paid history
      preserved; past-due unpaid stay visible until resolved. (T4)
- [ ] **Edit:** rewrite eligible future unpaid occurrences (amount + schedule, no
      duplicates); past-due unpaid and paid untouched. (T5–T6)
- [ ] **Skip:** per-occurrence action; stops reserving, leaves Upcoming, history shows
      skipped, bill unaffected. (T7)
- [ ] **Corrections:** bill-risk due-date passthrough (T8); bounded repeatable backfill
      (T9); Money Sky space-tz day (T10); `moneyDates` space-tz (T11); pay-stub delete
      safety + re-confirm duplicate check (T12); scheduled-vs-settled entries via the
      durable marker — create/settle/edit/un-settle/delete keyed to it (T13, T18);
      visible Upcoming truncation + stable scope (T14).
- [ ] **Invariant tests:** concurrent mark-paid (T15), concurrent edit + pay (T16),
      double-submit/retry idempotence (T17), settlement idempotency + boundary edits
      (T18), inactive-bill eligibility across Reserved/Upcoming/Sky (T19), losing
      concurrent Paid claim leaves no orphan expense or balance change (T20);
      full gate (typecheck + both-TZ suites + build).

## Deferred / Parked

- [x] 🟢 **Audit follow-ups from agy's clumping batch (minor, non-blocking)** — (1) `Graph3D` does a
  per-frame `O(n)` `.find()` to position each mesh; reuse the existing `nodeByIdRef` map. (2) repeated
  `fg.graphData()` calls per frame — cache once per tick. (3) `SoumayaPanel.moveTask()` should null-guard
  `tasks[index]`. All cosmetic/defensive; verified not to cause current bugs (2026-06-21 audit).

- [x] 🟢 **Fix UI layout overlaps** — ✅ done. Positioned the previously-unplaced 🔭 Observatory FAB into the
  free right-column slot (was overlapping the header), and added `env(safe-area-inset-bottom)` to every
  bottom FAB row so they clear the mobile home indicator.
- [ ] **`InstancedMesh` renderer rewrite (phase-1-density-core.md)** — full spec committed and ready but hold until real devices drop below ~50fps. Not blocking anything.

---

## Done (for reference)

All Phase 1–4 milestones, Celestial Economy, Telegram A/B/C, lore engine, Fleet v1, AI Companion, visitor tracking, constellation membership, PWA, MCP bridge. See `GEMINI_CHANGES.md` for the full log.

- [x] 🟢 **Perf: O(1) id→node map for link accessors** — `getLinkActivity` was O(links×nodes) per refresh (mobile jank); now a Map rebuilt on data change. (Claude, 2026-06-20, from review of agy's P2 link-activity feature.)
