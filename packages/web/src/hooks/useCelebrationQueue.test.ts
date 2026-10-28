import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { UnlockableItem } from "@brain/shared";
import { useCelebrationQueue } from "./useCelebrationQueue.js";

/**
 * Batch O — REG-178 (HN-04): simultaneous unlocks queue their
 * celebration cards instead of collapsing to the last item. Fails on
 * the pre-change code, which has no queue (a single `unlockMoment` slot
 * that each onUnlock overwrites).
 */
const item = (id: string): UnlockableItem => ({
  id,
  category: "music",
  label: id,
  description: id,
  equipValue: id,
  condition: { kind: "always" },
  requirementText: "",
});

describe("useCelebrationQueue (REG-178)", () => {
  it("queues a simultaneous batch: every item gets its moment in order", () => {
    const { result } = renderHook(() => useCelebrationQueue());
    expect(result.current.current).toBeNull();
    act(() => {
      result.current.enqueue(item("a"));
      result.current.enqueue(item("b"));
      result.current.enqueue(item("c"));
    });
    expect(result.current.current?.id).toBe("a");
    expect(result.current.queue.map((i) => i.id)).toEqual(["a", "b", "c"]);
    act(() => result.current.dismissCurrent());
    expect(result.current.current?.id).toBe("b");
    act(() => result.current.dismissCurrent());
    expect(result.current.current?.id).toBe("c");
    act(() => result.current.dismissCurrent());
    expect(result.current.current).toBeNull();
    expect(result.current.queue).toEqual([]);
  });

  it("enqueueing while one shows does not overwrite the current card", () => {
    const { result } = renderHook(() => useCelebrationQueue());
    act(() => result.current.enqueue(item("a")));
    act(() => result.current.enqueue(item("b")));
    expect(result.current.current?.id).toBe("a");
  });

  it("dismissing an empty queue is a no-op", () => {
    const { result } = renderHook(() => useCelebrationQueue());
    act(() => result.current.dismissCurrent());
    expect(result.current.current).toBeNull();
  });
});
