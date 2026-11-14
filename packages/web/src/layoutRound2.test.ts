import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { visibleToasts, PHONE_TOAST_QUERY } from "./components/Toasts.js";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.css"), "utf8");

describe("UX review #1/#2 round 2 — login, phone toasts, landscape phones", () => {
  it("a too-tall login card scrolls from its top (safe centring)", () => {
    expect(css).toMatch(/\.login-screen \{[^}]*justify-content: safe center;/);
  });
  it("phones show one toast at a time and fold the rest into +N", () => {
    expect(visibleToasts([1, 2, 3], 0, false)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(visibleToasts([1, 2, 3], 2, true)).toEqual({ shown: [3], more: 4 });
    expect(visibleToasts([], 1, true)).toEqual({ shown: [], more: 1 });
    expect(PHONE_TOAST_QUERY).toContain("(max-width: 560px)");
    expect(PHONE_TOAST_QUERY).toContain("orientation: landscape");
  });
  it("landscape phones get the same declutter (FABs fold into Tools)", () => {
    const at = css.indexOf("@media (max-height: 500px) and (orientation: landscape)");
    expect(at).toBeGreaterThanOrEqual(0);
    const block = css.slice(at);
    expect(block).toMatch(/\.fab-settings \{ display: none; \}/);
    expect(block).toMatch(/\.tools-item\.tools-phone-only \{ display: flex; \}/);
    // the Add sheet fits under the brand row and scrolls instead of running off the top
    expect(block).toMatch(/\.ingest \{\s*top: calc\(96px[^}]*overflow-y: auto;/);
  });
  it("the dock tab row owns its 44 px height, scoped to the dock", () => {
    expect(css).toMatch(/\.dock \.tabs button:not\(\.tab-close\) \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.dock \.tabs \.tab-close \{ min-width: 44px; min-height: 44px; \}/);
  });
});
