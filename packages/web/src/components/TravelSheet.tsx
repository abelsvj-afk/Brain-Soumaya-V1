import { useRef, type ReactNode } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y.js";

/**
 * The travel sheet — the one positioned home for the worlds panels
 * (travel, tours, approvals inbox, world changes). Those panels lay out
 * in flow; mounted loose in the fixed, overflow-hidden app root they
 * stacked below the bottom edge of the screen, so no one could ever
 * depart for a world. Opened from Tools → Travel, or by a world-map /
 * Try-It handoff.
 *
 * Stays MOUNTED while closed (only `hidden` toggles): the panels inside
 * hold server-bound state and the transit presentation clock, and
 * closing the sheet must never reset a journey's Arrive countdown.
 */
export default function TravelSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogA11y(cardRef, onClose, open);
  return (
    <div className="travel-sheet" hidden={!open} onClick={onClose}>
      <div
        className="travel-sheet-card"
        role="dialog"
        aria-modal="true"
        aria-label="Travel and worlds"
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="travel-sheet-head">
          <h2>🚀 Travel &amp; worlds</h2>
          <button type="button" className="travel-sheet-close" aria-label="Close travel" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="travel-sheet-body">{children}</div>
      </div>
    </div>
  );
}
