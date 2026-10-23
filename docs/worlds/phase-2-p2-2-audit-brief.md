# P2-2 Post-Merge Audit Brief (2026-10-23)

**For:** the post-merge audit of P2-2, per the default lane (merge → audit → findings become the fix list).
**Subject:** PR #95, merged as **`94f2817`** into `claude/soumaya-second-brain-v1-m4z4hc` (base before merge: `0d95fda`). Accepted head before merge: `519b740` — merged files verified byte-identical to the accepted build.

## What to audit

The merged increment is the server journey ledger exactly as designed in `phase-2-p2-2-design-note.md` (Rev 51 form) and corrected through reviews 22–24. Audit the merged state on the deploy branch, not the PR branch:

1. **Design conformance** — ledger schema (`travel_journeys`, `travel_journey_events`), state machine, lazy settlement, derived current world, five routes, allow-list (`home`, `great-station`), error grammar (400/404/409 split) — against the design note.
2. **The four acceptance criteria** — C1 server-authoritative cancellation · C2 atomic fuel+ledger · C3 idempotency across retries (sequential *and* concurrent, per the review-22 correction) · C4 failure safety (no arrival without a valid departure; no partially applied journey).
3. **Upgrade safety** — both DDL paths present and equivalent (BOOTSTRAP_SQL for fresh DBs; the mirrored block in `migrateSchema` for existing volumes); the partial unique index created on existing databases; no destructive migration.
4. **Scope discipline** — no bonus crediting anywhere (arrivals record facts only), no frontend changes, no feature flag, no deployment artifacts, no changes outside the increment's 11 files.
5. **Regressions surface** — shared contract changes (`TRAVEL_CANCEL_WINDOW_SECONDS`, travel types, the `JourneyKind`→`TravelKind` alias) and their blast radius on existing consumers.

## Builder-reported evidence (not independently rerun)

Travel tests 18/18 (incl. the two-process race tests) · economyWarp 9/9 · codexClaim 6/6 · server/shared/web typechecks clean — all run in the builder's sandbox against the pushed files. One environment caveat from the final gate: the sandbox clone carried stale pre-#94 web fixture files; the web typecheck failure that produced was verified as a clone artifact against the deploy branch on GitHub (which carries the correct fixtures) — worth a spot-check in the audit if the auditor's environment shows anything similar.

## Boundaries

An audit authorizes nothing by itself. Findings return to the worlds chat and become the fix list; any fix is a new, separately authorized increment. Deployment, flag activation, P2-3, and P2-4 remain unauthorized regardless of the audit's outcome.
