# Soumaya V1 — Implementation Gate Evidence Checklist
## Prepared 2026-10-23 (design phase). **Updated 2026-10-23: the owner authorized the build (Gate 0, below) on the ask package's framing — the pre-implementation evidence that could exist was produced (Gate 2 inventory; design §23), and the remaining Gate 1/3 verification boxes are BUILD EXIT GATES: they can only be proven by a built V1 under test, and all must pass before a merge is requested. Nothing here is a build instruction.**

## Gate 0 — Owner decisions on record
- [x] Owner approves Rev 1–3 as the V1 design of record (Track A only) — **DONE 2026-10-23, 11:54 AM ET, owner's explicit word in the recall chat (design note §22)**
- [x] Owner separately authorizes implementation — **DONE 2026-10-23, 2:26 PM ET, owner's explicit word in the recall chat (design note §26)**: scope = ask package §1, exit gates = ask package §2 (Gates 1/3 below), queue discipline binding (Gate 4), merge + deploy NOT authorized

## Gate 1 — Capture fidelity (design §§12A, 18.2; criteria §14.1, §18.5.12)
- [ ] Byte contract proven per kind: typed / Telegram / chat / file — whitespace, emoji, Unicode preserved; hash = SHA-256 over exact received bytes
- [ ] Invalid UTF-8 file imports as `binary`, hash valid, no fabricated text
- [ ] Idempotency replay (incl. crash mid-extraction): exactly one source per capture
- [ ] Persist → ack → extract order proven: forced extraction failure leaves source exact + `preserved_unprocessed`

## Gate 2 — Erasure completeness (design §§12D, 18.1; criterion §18.5.11)
- [x] Derived-representation inventory built from the ACTUAL repo and diffed against §18.1's list — **DONE 2026-10-23 (`v1-gate-evidence-preimplementation-2026-10-23.md` E2): §18.1 list confirmed + extended (episode_enrichments, working_memory, agent_logs, telegram_note_drafts, attachments.data, timeline_chapters, inquiries, consolidation/contradictions, user_model/persona, instruction_profiles, journeys); refinements recorded in design §23, no material contradiction**
- [ ] Unique-string sweep: zero hits across the full inventory after source forgetting
- [ ] Multi-source node rule proven: survives scrub-verified when another origin remains; erased when sole origin forgotten
- [ ] Forgetting rides the existing forget_requests / INV-DEL-1 path only

## Gate 3 — Schema & isolation (design §§12B, 15, 18.3, 18.4; criteria §14.6, §18.5.13–15)
- [ ] Bootstrap vs migration schema-diff test: identical for all four new tables, fresh + legacy DBs
- [ ] All four new tables in SPACE_SCOPED_TABLES; space erasure removes dependent FTS/vec rows (tested)
- [ ] Adversarial two-space test: planted near-neighbor chunk never surfaces across spaces (search, links, embeddings, jobs)
- [ ] Processing state machine: single-winner claim, lease expiry + boot recovery, extraction_hash reuse, zero duplicate nodes/links under retries and mid-run kill
- [ ] Correction determinism: seq-ordered replay, overlap conflict marker, original untouched
- [ ] Export (version-bumped, sources included) → restore round-trip with hash verification; pre-V1 exports still restore — **BUILD DELIVERABLE (evidence E3, 2026-10-23: export exists today, NO restore facility exists — V1 must ship the restore path or return to the design gate to rescope; design §23)**
- [ ] Timezone suite: America/New_York + Pacific/Kiritimati; no UTC in user-facing strings

## Gate 4 — Scheduling & rollout (design §§16, 18.4, 19)
- [x] Repo-chat queue reconciliation recorded — **DONE 2026-10-23 (design note §27): repo chat slotted V1 after Batch B (GH-19, in flight) as the next and only schema-touching build, ahead of ADR-021 implementation; register's lost-words item moved blocked → authorized-and-queued**
- [ ] Knowledge documents: confirmed untouched by V1 (no migration, no double-count in search)
- [ ] Deploy checklist updated: pre-deploy export + brain.db backup; owner acknowledgment of downgrade-invisibility (§18.4) before any V1 deploy
- [ ] Build gate green (tests / typecheck / tree-verify) — mandatory in both lanes

*Source of record: `verbatim-recall-and-shared-worlds-design-note-2026-10-23.md` Rev 1–3.*
