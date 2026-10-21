import type { GraphData, GraphNode } from "@brain/shared";
import { dailyQuests } from "./quests.js";

/**
 * IM-90: today's tending quests, surfaced in Progress (the "what do I do
 * next to advance" tab) — until now `dailyQuests()` was consumed only by
 * the Observatory arrival screen. Same quests, same wiring as Observatory:
 * a focus quest flies to its memory, the capture quest opens the ingest
 * panel, the insights quest jumps to the Insights tab.
 */
export function DailyQuests({
  graph,
  fedToday,
  onFocus,
  onCapture,
  onOpenInsights,
}: {
  graph: GraphData;
  fedToday: boolean;
  onFocus: (id: number) => void;
  onCapture?: () => void;
  onOpenInsights?: () => void;
}) {
  const memories = (graph.nodes as GraphNode[]).filter((n) => n.kind !== "action");
  const quests = dailyQuests(memories, fedToday);
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
