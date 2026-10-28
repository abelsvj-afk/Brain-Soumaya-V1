import { useCallback, useState } from "react";
import type { UnlockableItem } from "@brain/shared";

/**
 * useCelebrationQueue — the "🔓 Unlocked!" card queue (REG-178/HN-04).
 *
 * The watcher fires `onUnlock` once per fresh item, and several items
 * routinely unlock in one evaluation (crossing 100 memories unlocks
 * Interstellar + the Star Center figurine together). A single state slot
 * collapsed those to the last item's card — every item got its toast,
 * but only the last got its full-screen moment. The queue gives every
 * item its moment in unlock order: the head renders until dismissed
 * (auto-dismiss after ~4.6s, or a tap), then the next one shows.
 * Enqueueing while one shows never overwrites the current card.
 */
export function useCelebrationQueue(): {
  /** The item whose card renders now (the queue head), or null. */
  current: UnlockableItem | null;
  /** The whole queue, head first (for tests / debugging). */
  queue: UnlockableItem[];
  /** Append an item to the queue (functional update — safe to call
   *  once per item inside the watcher's synchronous loop). */
  enqueue: (item: UnlockableItem) => void;
  /** Dismiss the current card, revealing the next queued item. */
  dismissCurrent: () => void;
} {
  const [queue, setQueue] = useState<UnlockableItem[]>([]);
  const enqueue = useCallback((item: UnlockableItem) => {
    setQueue((q) => [...q, item]);
  }, []);
  const dismissCurrent = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);
  return { current: queue[0] ?? null, queue, enqueue, dismissCurrent };
}
