import { useEffect, useMemo } from "react";
import type { GraphData, GraphNode } from "@brain/shared";
import { dailyQuests, loadQuestDayState, resolveDailyQuests, saveQuestDayState } from "./quests.js";
import { useSpaceTimeZone } from "../utils/spaceTimezone.js";

/**
 * IM-90: today's tending quests, surfaced in Progress (the "what do I do
 * next to advance" tab) — until now `dailyQuests()` was consumed only by
 * the Observatory arrival screen. Same quests, same wiring as Observatory:
 * a focus quest flies to its memory, the capture quest opens the ingest
 * panel, the insights quest jumps to the Insights tab.
 *
 * REG-045 (PG-01): with `questKey` this tab derives from the SAME persisted
 * dayState the Observatory persists (same quest list, targets, done states)
 * instead of re-deriving a fresh baseline on every render — warming the
 * named memory shows ✓ here and in the Observatory for the rest of the day.
 * Without `questKey` it derives unpersisted, as before (old callers / tests).
 */
export function DailyQuests({
  graph,
  fedToday,
  onFocus,
  onCapture,
  onOpenInsights,
  questKey,
}: {
  graph: GraphData;
  fedToday: boolean;
  onFocus: (id: number) => void;
  onCapture?: () => void;
  onOpenInsights?: () => void;
  /** Persisted day-state key — `questDayStorageKey(spaceId)` — shared with the Observatory. */
  questKey?: string;
}) {
  const memories = (graph.nodes as GraphNode[]).filter((n) => n.kind !== "action");
  const spaceTimeZone = useSpaceTimeZone();
  const questResult = useMemo(
    () =>
      questKey
        ? resolveDailyQuests(memories, fedToday, {
            dayState: loadQuestDayState(questKey),
            timeZone: spaceTimeZone,
          })
        : { quests: dailyQuests(memories, fedToday), dayState: null },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memories, fedToday, questKey, spaceTimeZone],
  );
  useEffect(() => {
    if (questKey && questResult.dayState) saveQuestDayState(questKey, questResult.dayState);
  }, [questKey, questResult.dayState]);
  const quests = questResult.quests;
  if (quests.length === 0) return null;
  return (
    <div className="dq-wrap">
      <h4 className="dq-title">🎯 Today's tending</h4>
      <div className="dq-list">
        {quests.map((q) => (
          <button
            key={q.id}
            className={`dq-quest ${q.done ? "done" : ""}`}
            disabled={q.done && q.action === "capture"}
            onClick={() => {
              if (q.action === "capture") onCapture?.();
              else if (q.action === "insights") onOpenInsights?.();
              else if (q.focusId != null) onFocus(q.focusId);
            }}
          >
            <span className="dq-ic">{q.done ? "✓" : q.icon}</span>
            <span className="dq-text">{q.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
