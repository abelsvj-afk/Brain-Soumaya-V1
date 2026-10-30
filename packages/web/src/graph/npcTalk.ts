/**
 * What you have heard from a person, remembered on this device per brain (docs/specs/living-worlds-dialogue-2026-10-31.md, S3). It only decides which step of a thread is offered
 * NEXT — nothing is gated on it, nothing is scored, and clearing it loses nothing but the order the person tells it in.
 */
const key = (spaceId: string | null, npc: string) => `npc.heard.${spaceId ?? "local"}.${npc}`;

export function readHeard(spaceId: string | null, npc: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(spaceId, npc));
    const j: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function markHeard(spaceId: string | null, npc: string, step: string): Set<string> {
  const next = readHeard(spaceId, npc);
  next.add(step);
  try {
    localStorage.setItem(key(spaceId, npc), JSON.stringify([...next]));
  } catch {
    /* blocked storage: the thread simply starts over next time */
  }
  return next;
}
