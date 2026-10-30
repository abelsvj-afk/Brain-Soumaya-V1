import { useRef, useState } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y.js";

/**
 * Tools menu — a single 🧰 button that opens a compact grid of the SECONDARY tools
 * (search, lenses, connections, recall, chronicle, legend, flashback, focus mode, help).
 *
 * Why it exists: the app had grown ~8 always-visible buttons stacked down the top-right
 * edge, which overflowed off small (mobile-first!) screens — the Smart Lens button was
 * literally unreachable on a phone. Collapsing them into one menu guarantees every tool is
 * reachable in one tap on any screen, and declutters the galaxy. The FEW frequent controls
 * (add, panels, recenter, zoom, chat) stay as their own buttons.
 */
import { Icon, renderIcon } from "./icons/Icon.js";

export interface ToolsMenuProps {
  onSearch: () => void;
  onLenses: () => void;
  onConnections: () => void;
  /** Batch G (REG-196): null = UNKNOWN (no successful count poll yet, or the
   *  last refresh failed) — never rendered as 0. */
  candCount: number | null;
  onReview: () => void;
  /** Batch G (REG-196): null = UNKNOWN — the red-dot due count must never
   *  present a failed refresh as "0 due". */
  dueCount: number | null;
  onTimeline: () => void;
  onLegend: () => void;
  onWorldMap: () => void;
  /** Opens the Society (the worlds' people, factions and ordinances — a mirror of your galaxy, never a verdict). */
  onSociety?: () => void;
  /** Opens the travel sheet (route board, tours, world changes). Omitted
   *  while the worlds flag is off — the item then doesn't render at all,
   *  rather than opening an empty sheet. */
  onTravel?: () => void;
  onFlashback: () => void;
  onFocusMode: () => void;
  focusMode: boolean;
  onHelp: () => void;
}

export function ToolsMenu(p: ToolsMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Escape/focus-trap/focus-restore — this popover previously had none of the
  // three, only a scrim click to dismiss.
  useDialogA11y(menuRef, () => setOpen(false), open);
  const items: { icon: string; label: string; on: () => void; badge?: number | null }[] = [
    { icon: "i:lenses", label: "Lenses", on: p.onLenses },
    { icon: "i:connections", label: "Connections", on: p.onConnections, badge: p.candCount },
    { icon: "i:recall", label: "Recall", on: p.onReview, badge: p.dueCount },
    { icon: "i:timeline", label: "Timeline", on: p.onTimeline },
    { icon: "i:legend", label: "Legend", on: p.onLegend },
    { icon: "i:planet", label: "World map", on: p.onWorldMap },
    ...(p.onTravel ? [{ icon: "i:rocket", label: "Travel", on: p.onTravel }] : []),
    ...(p.onSociety ? [{ icon: "i:people", label: "Society", on: p.onSociety }] : []),
    { icon: "i:comet", label: "Flashback", on: p.onFlashback },
    { icon: p.focusMode ? "i:sun" : "i:calm", label: p.focusMode ? "Exit calm" : "Calm mode", on: p.onFocusMode },
    { icon: "i:help", label: "Help", on: p.onHelp },
  ];
  const alerts = (p.candCount ?? 0) + (p.dueCount ?? 0);
  // Batch H (REG-201 / CN-02, F1 from the Batch G review): the closed FAB's
  // badge must never read as a total while either count is unknown — both
  // unknown showed NO badge (visually identical to "0 alerts"), and one
  // unknown showed the known partial as if it were the total. "?" whenever
  // either count is null; a numeric badge only when BOTH are known.
  const anyUnknown = p.candCount === null || p.dueCount === null;
  // The closed FAB's badge and the open menu's per-item badges are both small
  // numeric counters, but capped at different ceilings (9+ vs 99+) — showing
  // "9+" on the FAB when opening the menu could reveal individual counts well
  // under 10, which reads as inconsistent. One shared cap for both.
  const BADGE_CAP = 9;
  // Batch G (REG-196): an unknown count renders "?" — never 0, never hidden
  // as if nothing were waiting. The title names the unknown so a screen
  // reader (and a hover) doesn't read a failed poll as "0 due".
  const fmtBadge = (n: number | null) => (n === null ? "?" : n > BADGE_CAP ? `${BADGE_CAP}+` : String(n));
  const fmtCount = (n: number | null, singular: string, plural: string) =>
    n === null ? `unknown ${plural}` : `${n} ${n === 1 ? singular : plural}`;
  const tap = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const alertsTitle =
    alerts > 0 || p.candCount === null || p.dueCount === null
      ? `Tools — ${fmtCount(p.candCount, "connection suggestion", "connection suggestions")}, ${fmtCount(p.dueCount, "recall", "recalls")} due`
      : "Tools — search, lenses, recall, legend & more";
  return (
    <>
      <button
        className={`fab fab-tools ${open ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Tools"
        aria-expanded={open}
        title={alertsTitle}
      >
        <Icon name="tools" />
        <span className="fab-cap">Tools</span>
        {((anyUnknown || alerts > 0) && !open) && (
          <span className="fab-badge" title={anyUnknown ? "Couldn't check — count unknown" : undefined}>
            {anyUnknown ? "?" : fmtBadge(alerts)}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="tools-scrim" onClick={() => setOpen(false)} aria-hidden />
          <div className="tools-menu" role="menu" aria-label="Tools" ref={menuRef}>
            {items.map((it) => (
              <button key={it.label} className="tools-item" role="menuitem" onClick={() => tap(it.on)}>
                <span className="tools-ic">{renderIcon(it.icon, 20)}</span>
                <span className="tools-lbl">{it.label}</span>
                {it.badge !== undefined && (it.badge === null || it.badge > 0) && (
                  <span className="tools-badge" title={it.badge === null ? "Couldn't check — count unknown" : undefined}>
                    {fmtBadge(it.badge)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
