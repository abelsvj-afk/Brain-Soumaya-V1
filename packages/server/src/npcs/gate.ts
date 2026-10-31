import { NPC_GATE_KEY_RELIC, NPC_GATE_OTHER_RELICS_NEEDED } from "@brain/shared";

/**
 * The NPC side of B-01 (design note §5): the gate rule applies to NPCs
 * too. The key is the same as for players — the Witness Without a Name
 * plus any two other relics — and once opened for that NPC it stays
 * open. NPC holdings come from the NPC's OWN separate pool (never the
 * player scarce pool), so this check reads only what the NPC itself
 * holds.
 *
 * What this gate is FOR: the NPC's own B-01 journey — a per-NPC
 * record (npc_gate) that drives the NPC's state and its answers about
 * the way onward. It opens Eternity for no one else; a player's gate
 * is the player's own found set and record, untouched by anything an
 * NPC holds.
 *
 * Seed parity (tier implementation, 2026-10-30 — resolving the
 * residuals sweep's note): for LIVE claims the parity is exact — a
 * consumed Seed can never advance this gate, because a Seed claim
 * writes no npc_relic_holdings row; and the player's gate likewise
 * reads the found/owned set (relic_holdings), which a consumed Seed
 * never enters either. On both sides a Seed's consumption is a
 * permanent effect, never a gate credential. There is no NPC
 * discovery record to read instead (NPC claims write no Codex
 * claims), and inventing one to count consumptions here would make
 * the NPC gate EASIER than the player's — the opposite of the
 * parity the design's one-rule-for-both-sides shape intends. Pinned
 * by test on both sides (relicTiers.test.ts, gate-parity case).
 *
 * One scoped exception, recorded honestly (review F-2): the
 * one-time tier MIGRATION preserves a Seed-completed PLAYER gate
 * (permanence is recorded from the found set before the Seed
 * holding converts), but does not mark npc_gate for an NPC in the
 * mirror state. That state is unreachable in production today —
 * NPC claims are world-confined and no world holds both the
 * Witness key and a Seed — so the asymmetry is a latent
 * inconsistency in an unreachable state, not a live one; if a
 * future world makes it reachable, the conversion should record
 * NPC gate permanence the same way before that world ships.
 *
 * Pure: no database, no clock. The caller supplies the NPC's held
 * relic ids (distinct) and whether the gate is already open for it.
 */
export interface NpcGateCheck {
  open: boolean;
  hasKey: boolean;
  othersHeld: number;
  othersNeeded: number;
  /** Plain-language line for the NPC's own answer about the gate —
   *  honest about what it holds and what it still needs. It never
   *  claims to know the way when it doesn't. */
  missingPlain: string;
}

export function checkNpcEternityGate(heldRelicIds: readonly string[], alreadyOpen: boolean): NpcGateCheck {
  const distinct = new Set(heldRelicIds);
  const hasKey = distinct.has(NPC_GATE_KEY_RELIC);
  const othersHeld = [...distinct].filter((id) => id !== NPC_GATE_KEY_RELIC).length;
  const othersNeeded = Math.max(0, NPC_GATE_OTHER_RELICS_NEEDED - othersHeld);
  const open = alreadyOpen || (hasKey && othersHeld >= NPC_GATE_OTHER_RELICS_NEEDED);
  let missingPlain: string;
  if (open) {
    missingPlain = alreadyOpen
      ? "The way is open for me — it opened once, and it stays open."
      : "The way is open for me — I hold the Witness and two others.";
  } else if (!hasKey && othersHeld === 0) {
    missingPlain =
      "I can't find the way yet — I hold no relics at all, and the way needs the Witness Without a Name plus two others.";
  } else if (!hasKey) {
    missingPlain = `I hold ${othersHeld} relic${othersHeld === 1 ? "" : "s"} but not the Witness Without a Name — without the key, I can't find the way.`;
  } else if (othersNeeded === 1) {
    missingPlain = "I hold the Witness, but I still need one more relic before the way opens for me.";
  } else {
    missingPlain = `I hold the Witness, but I still need ${othersNeeded} more relics before the way opens for me.`;
  }
  return { open, hasKey, othersHeld, othersNeeded, missingPlain };
}
