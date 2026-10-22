# ChatGPT Review 2 — §13 (Information Model) & §14 (Animation Gate)

**Date:** 2026-10-22 · **Reviewed:** Exploration 1, Revision 6 (§13–§14) · **Relayed by:** the owner · **Absorbed into:** Exploration 1, Revision 7
**Verdicts:** §13 — strong proposal; resolve three semantic boundaries before ratifying. §14 — **keep the gate**; add safeguards before individual scenes pass it. Roster is closed; nothing here reopens it. No implementation authorized.

## §13 findings
1. **Home vs. appearances** — distinguish three operations: **Visit/surface** (home unchanged), **Relocate** (deliberate primary-home change), **Archive/retrieve** (intentional, stricter). Each with its own state transition and animation semantics; a visit must never silently become a relocation. → *Absorbed: §13 "Operations".*
2. **Archive rule = system-wide invariant** — archived memory must vanish from derived clusters, connections, route suggestions, tours, search/resurfacing, cached scenes, and queued animations. Retrieval: only a deliberate in-Archive action; an in-progress animation must not carry an archived memory elsewhere. Archive ≠ deletion; restore must not silently overwrite the prior primary-home choice. → *Absorbed: P4 strengthened.*
3. **Derived ≠ confirmed** — tiers: confirmed user relationship (authoritative) / system-suggested connection (hypothesis) / inferred emotion (most uncertain, correctable). Rendering must reflect confidence; a suggestion must not become a fact by being rendered beautifully. → *Absorbed: P7 tiers.*

## §14 findings
- **A1–A3** must represent the actual operation (visit/relocate/archive); canonical identity survives the journey; cancel/interruption must never leave a contradictory state. → *Absorbed: operation fidelity + atomicity.*
- **A5/A10** stricter: archiving mid-animation enforces visibility immediately; retrieval only via deliberate in-Archive action; reverse travel must not imply retrieval from anywhere.
- **Reduced motion & control:** reduced form must preserve *meaning* (e.g., a clear origin→destination transition), not just remove movement; skip/cancel/interruption/repeat behavior is part of each animation's spec. → *Absorbed: §14.1 required fields.*
- **Performance:** cheap/moderate/heavy is planning, not proof — mockups must state combined animation load, fallback behavior, and §11 evidence.
- **A4** non-blocking (saving never waits on the animation). **A8** — explain + allow correction of inferred emotion. **A13/A17** — station traffic is atmosphere; implies no real users or brain activity unless a mapping rule is designed. **A20** — feedback immediate and stable, no added navigation delay.
- **Structural:** the A1–A20 list is a *seed inventory*, not passed animations; keep that distinction visible. → *Absorbed: "Seed ≠ passed", §14.1.*

## Governing principle (review's close, adopted into §14.2)
> Every visible object, connection, journey, and animation should be a truthful representation of the brain's underlying state — or be unmistakably presented as atmosphere rather than fact.

## Recommendations on §13's three queued questions (proposals — owner settles)
| Question | ChatGPT recommends |
|---|---|
| Deep Past: threshold or brain-judged? | Explainable rule combining age + meaningful resurfacing context, with user controls; never silently classify as forgotten for age alone. |
| Anchor keeps primary home elsewhere? | Yes — an anchor is a confirmed cross-space appearance, not a forced relocation. |
| People clusters for all linked people? | Only user-confirmed significant people (or explicitly chosen); ordinary mentions don't create prominent presence. |

*Review 2 record. The design gate remains open; nothing in this review authorizes code, merge, or deployment.*
