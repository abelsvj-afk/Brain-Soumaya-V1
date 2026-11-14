import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Standard modal keyboard/focus behavior, factored out once rather than
 * hand-rolled per dialog: Escape closes it, Tab is trapped within the
 * dialog's own focusable elements while it's open, and focus returns to
 * whatever had it (e.g. the FAB that opened the dialog) once it closes.
 * None of this app's overlays (Settings/Review/Help/ChatDock/ToolsMenu) had
 * any of the three.
 *
 * `active` defaults to true because most dialogs in this app are only ever
 * mounted while open (the parent conditionally renders the whole
 * component) — pass `active` explicitly for a component that stays mounted
 * and toggles its own open state internally (e.g. a popover menu).
 *
 * `initialFocus: "container"` focuses the dialog element itself (it needs
 * tabIndex={-1}) without scrolling, instead of its first focusable — for a
 * tall card whose first focusable sits far down (UX review #7: the Welcome
 * card opened scrolled to its Help link on phones). The element that had
 * focus BEFORE the dialog opened is captured first either way, so closing
 * returns focus there.
 *
 * Focus fallback (applies to EVERY dialog using this hook, not only the
 * Welcome card): if the element that had focus is gone from the document, or
 * was <body>, closing moves focus to the first of FALLBACK_FOCUS_SELECTORS
 * that exists and can take focus (the first-star cue's button, then the
 * "Add a memory" FAB). If none can, focus is left where the browser puts it.
 * See restoreFocus below.
 */
export function useDialogA11y(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
  options: { initialFocus?: "first" | "container" } = {},
): void {
  const initialFocus = options.initialFocus ?? "first";
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (container && !container.contains(document.activeElement)) {
      if (initialFocus === "container") container.focus({ preventScroll: true });
      else (focusableIn(container)[0] ?? container).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const items = focusableIn(container);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreFocus(previouslyFocused);
    };
  }, [active, containerRef, initialFocus]);
}

/**
 * Where focus lands when a dialog closes and the element that opened it is gone
 * (or was <body>), e.g. the first-run Welcome card, whose opener was the signup
 * button that unmounted with the login screen. Without a fallback focus fell to
 * <body> and keyboard users had to Tab from the top of the page.
 */
export const FALLBACK_FOCUS_SELECTORS = [
  '.empty-galaxy-cue button',
  'button[aria-label="Add a memory"]',
];

export function restoreFocus(previouslyFocused: HTMLElement | null): void {
  if (
    previouslyFocused &&
    previouslyFocused !== document.body &&
    document.contains(previouslyFocused)
  ) {
    previouslyFocused.focus();
    return;
  }
  for (const sel of FALLBACK_FOCUS_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    el.focus();
    if (document.activeElement === el) return;
  }
}
