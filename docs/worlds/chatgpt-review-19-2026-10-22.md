# ChatGPT Review 19 — P2-1 Post-Merge Audit (PR #94 @ `0d95fda`)

**Date:** 2026-10-22 · **Reviewed:** PR #94, its full nine-file diff, and the merged implementation at merge commit `0d95fda` · **Relayed by:** the owner · **Verdict: P2-1 correctly scoped; no confirmed blocker. One economy-design item carried to P2-4; journey-atomicity requirements carried into P2-2 as acceptance criteria.** (A code review — not an independent test-suite rerun; the reviewer says so plainly.)

## Checklist results
- **Fuel safety — PASS** for the tested refusal and balance-boundary cases.
- **Contract scope — PASS:** shared `warpCost` added; journey crediting remains types only.
- **Nine-file regression scope — PASS:** the diff contains exactly the economy changes, the shared contract, the new tests, and the five updated web fixtures.
- **web-push typecheck caveat — plausible environment gap:** the server package declares both `web-push` and `@types/web-push`; the sandbox's missing-module error cannot be reproduced from repository contents alone. (Consistent with the builder's finding: the package is in the lockfile, absent from this sandbox's installed modules.)

Pricing confirmed sound: warp 10 against a memory's 15; the 5-point warp-arrival bonus cannot make a warp net-positive; tests cover exact debit, refusal without debit, repeated spending, cap behavior, and the shared contract.

## Finding carried forward — P2-4 design gate (recorded in `phase-2-planning.md` §6)
**Free drift rewards need anti-farming rules.** Drift costs zero fuel while `EARN_JOURNEY_DRIFT` pays 3 — the "a warp cannot net positive" rule does **not** establish that the journey economy as a whole cannot be farmed: indefinitely repeated eligible drift arrivals would generate fuel for free. **Required before P2-4:** define what makes a drift journey *eligible* for its bonus, and how retries, repeated routes, and duplicate arrivals are prevented from paying repeatedly — **preserving the invariant that drift and memory access remain free** (D-1).

## Requirements carried into P2-2 — acceptance criteria (recorded in §6)
1. **Server-authoritative cancellation:** only the server decides when the cancel window closes and whether a warp is chargeable.
2. **Atomic fuel + journey state:** a departure's charge and its ledger entry commit together or not at all.
3. **Idempotency:** retried departure / cancellation / turn-back / arrival requests never cause duplicate charges or rewards.
4. **Failure safety:** no arrival without a valid departure; no partially applied journey if persistence fails.
The reviewer notes `spendWarp()` delegates to the existing `spend()` and does not itself implement these journey-level guarantees — **consistent with P2-1's scope, provided P2-2 closes them.**

## Decision (reviewer's, adopted into the record)
P2-1 audit closed with no confirmed blocker. The drift-reward exploit question is a **required P2-4 design item**; the atomicity requirements are **P2-2 acceptance criteria**. The merge authorizes nothing further: deployment, flag activation, and P2-2 remain the owner's decisions.

*Review 19 record — the default lane's post-merge audit for P2-1, complete.*
