/**
 * The frequent nav controls (panels, recenter, zoom). Extracted from App.tsx (Post-MVP
 * D4). The SECONDARY tools (search, lenses, connections, recall, chronicle, legend,
 * flashback, focus mode, help) moved into <ToolsMenu> so the top-right edge no longer
 * overflows off small screens — mobile-first. This holds no state; it renders buttons
 * and calls back.
 */
export interface NavRailProps {
  /** Search is a rail button, not a Tools-menu entry (persistent-HUD spec: one door per action). */
  onSearch: () => void;
  onDock: () => void;
  onRecenter: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function NavRail(p: NavRailProps) {
  return (
    <>
      <button className="fab fab-search" onClick={p.onSearch} aria-label="Search your memories" title="Search your memories (⌘K opens the command palette)">
        🔍
        <span className="fab-cap">Search</span>
      </button>
      <button className="fab fab-dock" onClick={p.onDock} aria-label="Panels">
        ☰
        <span className="fab-cap">Panels</span>
      </button>
      <button className="fab fab-recenter" onClick={p.onRecenter} aria-label="Recenter galaxy" title="Recenter the galaxy">
        ⊙
        <span className="fab-cap">Recenter</span>
      </button>
      {/* On-screen zoom (works when pinch/trackpad zoom fails). */}
      <button className="fab fab-zoom-in" onClick={p.onZoomIn} aria-label="Zoom in" title="Zoom in">
        ＋
        <span className="fab-cap">Zoom +</span>
      </button>
      <button className="fab fab-zoom-out" onClick={p.onZoomOut} aria-label="Zoom out" title="Zoom out">
        －
        <span className="fab-cap">Zoom −</span>
      </button>
    </>
  );
}
