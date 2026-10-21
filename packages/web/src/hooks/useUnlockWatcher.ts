import { useEffect, useRef, useState } from "react";
import { unlockedItems, type UnlockStats, type UnlockableItem } from "@brain/shared";
import { loadSeenUnlockIds, saveSeenUnlockIds } from "../components/unlockables.js";

/**
 * useUnlockWatcher — the "🔓 Unlocked!" detection plumbing (IM-133).
 *
 * Feed it the brain's current UnlockStats (see buildUnlockStats in
 * components/unlockables.ts) and it fires `onUnlock` exactly once per
 * catalog item that newly unlocks, ever, per brain on this device:
 *
 *  - Detection is the shared system's: an item counts as new when it is
 *    unlocked under the current stats but is not in the persisted
 *    celebrated set (`brain.unlocksSeen.<spaceId>`, mirroring the
 *    achievements `brain.achv.*` pattern). Once celebrated an item is in
 *    that set forever, so a stats dip and recovery never re-fires it.
 *    (The pure prev-vs-next diff the shared package exposes for tests and
 *    other consumers is `newlyUnlocked(prevStats, nextStats)`.)
 *  - The FIRST evaluation for a brain whose celebrated set is empty seeds
 *    that set silently with everything already unlocked — a returning
 *    pilot is never spammed with a backlog of celebrations (the same
 *    first-pass rule the achievements effect in App uses).
 *  - With devUnlockAll on, everything reads unlocked from the start, so
 *    the seed pass absorbs the whole catalog and nothing ever fires.
 *
 * Returns the most recent batch of newly unlocked items (for rendering
 * via UnlockCelebration) and a clearer for it.
 */
export function useUnlockWatcher(args: {
  stats: UnlockStats | null;
  spaceId: string | null;
  devUnlockAll?: boolean;
  onUnlock?: (item: UnlockableItem) => void;
}): { newlyUnlockedItems: UnlockableItem[]; clearNewlyUnlocked: () => void } {
  const { stats, spaceId, devUnlockAll } = args;
  const [newlyUnlockedItems, setNewlyUnlockedItems] = useState<UnlockableItem[]>([]);
  const onUnlockRef = useRef(args.onUnlock);
  onUnlockRef.current = args.onUnlock;
  const seenRef = useRef<Set<string>>(new Set());
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!stats || !spaceId) return;
    const opts = { devUnlockAll };
    const nowUnlocked = unlockedItems(stats, opts);
    const nowIds = new Set(nowUnlocked.map((i) => i.id));

    if (seededForRef.current !== spaceId) {
      // First evaluation for this brain on this device: load the celebrated
      // set; an empty set means "never evaluated here" → seed silently.
      seenRef.current = loadSeenUnlockIds(spaceId);
      seededForRef.current = spaceId;
      if (seenRef.current.size === 0) {
        seenRef.current = new Set(nowIds);
        saveSeenUnlockIds(spaceId, seenRef.current);
        return;
      }
    }

    // New = unlocked now and never celebrated before.
    const fresh = nowUnlocked.filter((i) => !seenRef.current.has(i.id));
    if (fresh.length === 0) return;
    for (const i of fresh) seenRef.current.add(i.id);
    saveSeenUnlockIds(spaceId, seenRef.current);
    setNewlyUnlockedItems(fresh);
    for (const item of fresh) onUnlockRef.current?.(item);
  }, [stats, spaceId, devUnlockAll]);

  return {
    newlyUnlockedItems,
    clearNewlyUnlocked: () => setNewlyUnlockedItems([]),
  };
}
