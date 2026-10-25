# Relic Buffs — Review Relay

**To the owner:** paste this to ChatGPT (GitHub-connected) with the design note below, or hand it the branch. The note lives at `docs/worlds/relic-buffs-design-note.md` on branch `design/worlds-vision`.

---

Review the attached design note for the Soumaya Second Brain worlds: **Relic Buffs** — buffs that relics grant once found and inscribed to the codex.

Context you need:
- This is a private second-brain app (single user now, multi-user later). Its worlds are a layer ON the brain, never a second brain. The brain is authoritative; worlds are disposable/recoverable.
- Hard invariants: the app NEVER punishes — no decay, no loss, no shame visuals, no streak logic in disguise. Fuel buys speed/spectacle, never access. Buffs are earned, never bought, never a score. All buff arithmetic is server-side; the client shows only what the server returns.
- Existing mechanics the buffs hook into: fuel (cap 200, regen 3.5/hr, warp cost 10, drift free), journey bonuses (warp +5, drift +3 gated at ≥30 s and ≤2 per local day), review strength, progress signal on goals/skills (0..1), emotionalWeight (-1..1), Deep Past rise window (30 days), codex discovery earnings (4), and Eternity's alignment (earns regular travel to him; never a score, never shame).
- The 15 relics and their lore are in `docs/worlds/eternity-lore.md` (each entry has a lore description and a codex inscription). The buffs in §3 of the note must derive from that lore.
- Eternity is an autonomous agent with his own skills; discovering him is meant to be really, really hard. His world is reached only by a jump chain through intermediate worlds, never directly.

What I need from you:
1. A verdict: READY / READY WITH CHANGES / NOT READY.
2. Findings, each with severity (Blocker / High / Medium / Low), the exact claim in the note it challenges, and what would fix it. Be specific: cite section numbers.
3. Check in particular:
   - Does every §3 buff genuinely follow from its relic's lore, or are any buffs just attached to a name?
   - Do any proposed numbers break the existing economy (fuel cap 200, warp 10, drift +3, regen 3.5/hr)? Run the math where a buff changes an earning or a cost.
   - Does any buff or trade-off create a punishment path (decay, loss, shame, gating by emotional state, streak logic in disguise)? Name it if so.
   - Does the scarcity model (§4) hold together across private worlds (one copy per brain) and public worlds (fixed global copies)? Find the holes: transfers, deleted brains, the creator's unlock consuming scarce copies.
   - Is the Eternity gate (§5) actually hard, or can it be walked through by accident? Check the jump-chain rule and the key set.
   - Are the stats (§2) a clean vocabulary, or do any two stats measure the same thing?
   - Is anything in §6 (emotional balance) or §7 (Eternity-created worlds) smuggling in a design decision that should be an open question instead?
4. Cleared items: say plainly what you checked and found sound, so the author knows what held.
5. Do NOT rewrite the note. Return findings only; the author revises.
