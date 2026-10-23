# Phase 2 Planning — Travel Skeleton + Great Station

**Status: PLANNING OPEN (D-32, owner's word "Ready", 2026-10-22). Implementation NOT authorized — it is this gate's exit decision.**
Governing design: `design-exploration-1.md` (design gate CLOSED, D-31). Decisions continue in its §11 register.

## What Phase 2 is (D-22)
The first real build inside the product: the **travel skeleton** (gates, transit, the three travel acts — cancel / turn back / return home — and the fuel economy) plus the **Great Station** as the first real space (home port: orientation, departure, discovery — it surfaces journeys and routes, not memories, per D-5/P3). Everything else (memory-bearing spaces) is Phase 3+, one at a time, separately authorized.

## Settled at this gate
- **Q27 — fuel earning (D-33): BOTH.** A steady base from ordinary use (generous; no streaks, no productivity thresholds) + bonuses from journeys (travels, Chronicle walks, placements, tours). D-1 invariants bind: warp costs · home free · drift always exists · fuel never gates access · bad-week safe · reward honesty (promised payouts must verifiably pay).

## Reconciliation register — to clear before implementation (§19 A4)
Worlds builds on shared systems only after each item is reconciled with the repo chat's audit program:
- [ ] **Fuel economy mechanics** — rates, caps, the gauge, quest/economy hooks (the D-33 model is settled; the numbers reconcile with the audit program's economy work, incl. its known reward-honesty history).
- [ ] **Notification cap & quiet rules** — D-15 proposal cadence rides the shared cap.
- [ ] **Chronicle data** — guided modes consume chapter data the core owns; no second store.
- [ ] **Approval machinery** — the §17 rail mirrors the A4 `pending_approvals` patterns (ADR-020 line).
- [ ] **Renderer performance** — worlds rendering must not regress the home galaxy's performance; budgets from §11 carry in.
- [ ] **Failure independence** (§19 A1) — the worlds layer stays disposable; the brain stays authoritative if the layer is removed.

## Build-plan questions the plan must answer before the exit decision
1. Where the travel skeleton lives (new module vs. extension of the galaxy renderer) and its failure boundary.
2. The fuel ledger: where balances live, how base accrual is computed (and in whose timezone — the standing rule: the viewer's local time, never UTC), how journey bonuses are evidenced.
3. The Station's first real slice: approach + arrival + route board (undiscovered = unlit, labeled), no interior (later phase, D-2).
4. The test gate for Phase 2: what runs where (the standing environment constraints apply), and what device evidence the owner grades.
5. Rollback shape: how the layer ships dark and comes off cleanly (failure independence, §19 A1).

## Exit
The owner's implementation authorization, given on the finished plan. Nothing in this document authorizes code, merge, or deployment.
