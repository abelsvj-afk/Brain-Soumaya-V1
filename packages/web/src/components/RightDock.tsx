import type { GraphNode } from "@brain/shared";
import { NodeInspector } from "./NodeInspector.js";
import { DigestPanel } from "./DigestPanel.js";
import { ChatPanel } from "./ChatPanel.js";

export type DockTab = "details" | "insights" | "chat";

interface Props {
  tab: DockTab;
  setTab: (t: DockTab) => void;
  selected: GraphNode | null;
  onFocus: (id: number) => void;
}

const TABS: { id: DockTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "insights", label: "✨ Insights" },
  { id: "chat", label: "💬 Chat" },
];

export function RightDock({ tab, setTab, selected, onFocus }: Props) {
  return (
    <div className="panel dock">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="dock-content">
        {tab === "details" && <NodeInspector node={selected} onFocus={onFocus} />}
        {tab === "insights" && <DigestPanel onFocus={onFocus} />}
        {tab === "chat" && <ChatPanel onFocus={onFocus} />}
      </div>
    </div>
  );
}
