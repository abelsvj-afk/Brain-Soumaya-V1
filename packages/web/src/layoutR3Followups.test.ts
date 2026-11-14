import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { labelScaleForViewport, PHONE_LABEL_SCALE } from "./graph/nodeObject.js";
import { useNoticesBottomVar, NOTICES_BOTTOM_VAR } from "./components/NotificationsBar.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");
const login = readFileSync(join(here, "components/LoginScreen.tsx"), "utf8");
const a11y = readFileSync(join(here, "hooks/useDialogA11y.ts"), "utf8");

function landscapeBlock(): string {
  const at = css.indexOf("@media (max-height: 500px) and (orientation: landscape) {");
  expect(at).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}\n", at);
  return css.slice(at, end);
}

afterEach(() => { document.documentElement.style.removeProperty(NOTICES_BOTTOM_VAR); });

describe("Reviewer r3 phone polish", () => {
  it("landscape: fuel gauge hangs from the bottom, ending above Music (128px)", () => {
    const b = landscapeBlock();
    expect(b).toMatch(/\.fuel-gauge \{\s*top: auto;\s*bottom: calc\(128px/);
    expect(b).toContain(".fuel-gauge .fg-tube { height: 72px; }");
    // Music keeps its on-screen slot (owner request).
    expect(b).toContain(".fab-music { bottom: calc(74px");
  });
  it("landscape: the Add sheet header (title + ×) is sticky", () => {
    expect(landscapeBlock()).toMatch(/\.ingest \.panel-head \{\s*position: sticky;/);
  });
  it("portrait: toasts sit under the banner's real bottom edge", () => {
    expect(css).toContain("calc(var(--notices-bottom, 0px) + 8px)");
  });
  it("useNoticesBottomVar publishes and clears the bar's bottom edge", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 104, bottom: 211.4, height: 107.4, left: 0, right: 0, width: 0, x: 0, y: 104, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    const { unmount } = renderHook(() => useNoticesBottomVar({ current: el }, 1));
    expect(document.documentElement.style.getPropertyValue(NOTICES_BOTTOM_VAR)).toBe("212px");
    unmount();
    expect(document.documentElement.style.getPropertyValue(NOTICES_BOTTOM_VAR)).toBe("");
    el.remove();
  });
  it("phone portrait shrinks memory labels; landscape and desktop do not", () => {
    expect(labelScaleForViewport(390, 844)).toBe(PHONE_LABEL_SCALE);
    expect(PHONE_LABEL_SCALE).toBeLessThan(1);
    expect(labelScaleForViewport(844, 390)).toBe(1);
    expect(labelScaleForViewport(1280, 800)).toBe(1);
  });
  it("reserved username error ends with '— pick another'", () => {
    expect(login).toContain("The username 'Soumaya' is reserved — pick another.");
  });
  it("useDialogA11y documents that the focus fallback applies to every dialog", () => {
    expect(a11y).toMatch(/Focus fallback \(applies to EVERY dialog/);
  });
});
