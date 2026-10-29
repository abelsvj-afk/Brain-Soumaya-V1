/**
 * The bottom-right action FABs — add a memory, Observatory, chat, settings. Extracted
 * from App.tsx (Post-MVP D4) as a pure presentational component. Behaviour + classNames
 * unchanged (the music FAB + song menu and the focus-cluster stay in App).
 */
export interface ActionRailProps {
  onIngest: () => void;
  onObservatory: () => void;
  onChat: () => void;
  chatActive: boolean;
  chatPulse: boolean;
  spaceName: string;
  onSettings: () => void;
}

export function ActionRail(p: ActionRailProps) {
  return (
    <>
      <button className="fab fab-ingest" onClick={p.onIngest} aria-label="Add a memory" title="Add a memory (or press C anywhere — ⌘K opens the command palette)">
        📝
        <span className="fab-cap">Add</span>
      </button>
      <button className="fab fab-observatory" onClick={p.onObservatory} aria-label="Open the Observatory home" title="Observatory — your daily briefing">
        🔭
        {/* "Home" read as "go back to the galaxy" — which is exactly what it does NOT do inside a world (audit: naming). */}
        <span className="fab-cap">Briefing</span>
      </button>
      <button
        className={`fab fab-chat ${p.chatActive ? "on" : ""} ${p.chatPulse ? "pulse" : ""}`}
        onClick={p.onChat}
        aria-label="Talk to Soumaya"
        title={`Talk to ${p.spaceName || "Soumaya"}`}
      >
        💬
        <span className="fab-cap">Chat</span>
      </button>
      <button className="fab fab-settings" onClick={p.onSettings} aria-label="Settings" title="Settings">
        ⚙️
        <span className="fab-cap">Settings</span>
      </button>
    </>
  );
}
