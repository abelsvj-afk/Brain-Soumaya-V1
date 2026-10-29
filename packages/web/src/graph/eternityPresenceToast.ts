import type { EternityPresence } from "@brain/shared";
import type { ToastAction } from "../components/Toasts.js";

/**
 * The one daily word of his presence in the home galaxy (spec §2d/§2e), as plain data so it is unit-tested. The broadcast
 * line is the projection every brain shares today; the veil (a memory due for recall) is offered as the toast's tap — it
 * flies you to that star, you recall it; the crown names a Journey you finished this week. Null when he is stopped.
 */
export function presenceToast(p: EternityPresence): { text: string; action?: ToastAction } | null {
  if (p.stopped || !p.broadcast) return null;
  let text = `Eternity — ${p.broadcast.line}`;
  if (p.crown) text += ` He crowned your finished Journey “${p.crown.title}”.`;
  if (p.veil) {
    text += ` He parted the veil on “${p.veil.label}” — tap to go and recall it.`;
    return { text, action: { kind: "focus", value: p.veil.nodeId } };
  }
  return { text };
}

/** Halo brightness: a faint presence every day, brighter on a day he acted in this brain. */
export function presenceIntensity(p: EternityPresence): number {
  return p.actedToday ? 1 : 0.35;
}
