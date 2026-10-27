import { NPC_GATE_KEY_RELIC, NPC_GATE_OTHER_RELICS_NEEDED } from "@brain/shared";

/**
 * The NPC side of B-01 (design note §5): the gate rule applies to NPCs
 * too. The key is the same as for players — the Witness Without a Name
 * plus any two other relics — and once opened for that NPC it stays
 * open. NPC holdings come from the NPC's OWN separate pool (never the
 * player scarce pool), so this check reads only what the NPC itself
 * holds.
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
