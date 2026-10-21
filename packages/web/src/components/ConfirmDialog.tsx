import { useRef } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y.js";

/**
 * The app's in-design-system confirmation dialog (IM-34): an overlay card with
 * role="dialog", Escape/backdrop cancel, focus trap + focus restore via the
 * shared useDialogA11y hook — the pattern the app's other overlays (Settings,
 * Lenses, lightbox) already use, replacing native window.confirm() for
 * destructive actions so node delete and attachment delete confirm the same way.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogA11y(cardRef, onCancel);
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="mini" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="mini confirm-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
