/**
 * IM-141 — global quick-capture plumbing (pure helpers, unit-tested in
 * quickCapture.test.ts). The manifest (public/manifest.webmanifest) declares:
 *   - share_target: GET /share?title=&text=&url=  (Android share sheet → app)
 *   - shortcuts:    /share?capture=1             (home-screen long-press)
 * The server already SPA-falls-back every non-API GET to index.html, so /share
 * needs no server route: the app boots, App.tsx calls parseShareLanding once
 * signed in + loaded, opens Ingest with the composed text prefilled, and
 * rewrites the URL to "/" so a reload never re-captures the same share.
 */

export interface ShareLanding {
  /** Prefill for the Ingest textarea ("" for a bare shortcut launch). */
  text: string;
}

/**
 * Compose the capture text from Web Share Target params. Title, text and url
 * land on separate lines, with the two duplications real shares produce
 * removed: a title identical to the text, and a url the text already embeds
 * (Android shares commonly put the link inside `text` AND in `url`).
 */
export function composeSharedText(params: URLSearchParams): string {
  const title = (params.get("title") ?? "").trim();
  const text = (params.get("text") ?? "").trim();
  const url = (params.get("url") ?? "").trim();
  const parts: string[] = [];
  if (title && title !== text) parts.push(title);
  if (text) parts.push(text);
  if (url && url !== title && !text.includes(url)) parts.push(url);
  return parts.join("\n");
}

/**
 * Is this page load a share-target / capture-shortcut landing? True for the
 * /share path itself (covers the shortcut's bare ?capture=1) or when any of
 * the share params are present on any path. Ordinary app URLs — ?lite=1, the
 * boot failsafe's ?fresh=…, a plain load — return null.
 */
export function parseShareLanding(pathname: string, search: string): ShareLanding | null {
  const params = new URLSearchParams(search);
  const isSharePath = pathname === "/share";
  const hasShareParams = params.has("title") || params.has("text") || params.has("url");
  if (!isSharePath && !hasShareParams) return null;
  return { text: composeSharedText(params) };
}

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** IM-142: ⌘K / Ctrl+K toggles the command palette (Alt+K is a different OS/browser gesture — left alone). */
export function isPaletteShortcut(e: KeyEventLike): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
}

/**
 * IM-141: a bare "c" opens capture from anywhere in the app. Any modifier
 * disqualifies it (Ctrl+C is copy, Shift+C types a capital), and the caller
 * must ALSO check isTextEntryTarget(e.target) — together they guarantee
 * typing the letter c in any field can never trigger capture.
 */
export function isCaptureShortcut(e: KeyEventLike): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === "c";
}

/** True when the event target is a place the user types text into. */
export function isTextEntryTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}
