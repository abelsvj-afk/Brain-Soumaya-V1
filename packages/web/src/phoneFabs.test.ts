import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");
const tools = readFileSync(join(here, "components/ToolsMenu.tsx"), "utf8");

function block(marker: string, endMarker: string): string {
  const i = css.indexOf(marker);
  expect(i).toBeGreaterThanOrEqual(0);
  const j = css.indexOf(endMarker, i);
  expect(j).toBeGreaterThan(i);
  return css.slice(i, j);
}

const portrait = () => block("6 — UX review #2: a phone keeps", "7 — The Views sheet");
const landscape = () => block("@media (max-height: 500px) and (orientation: landscape) {\n  .fab-recenter", "/* Header notices go top-RIGHT");

describe("owner request: zoom and music stay on screen on phones", () => {
  for (const [name, get] of [["portrait", portrait], ["landscape", landscape]] as const) {
    it(`${name}: zoom +/− and music are not hidden; recenter/briefing/settings still fold`, () => {
      const b = get();
      const hidden = b.match(/([^{}]*)\{ display: none; \}/)?.[1] ?? "";
      expect(hidden).toContain(".fab-recenter");
      expect(hidden).toContain(".fab-settings");
      expect(hidden).not.toContain(".fab-zoom-in");
      expect(hidden).not.toContain(".fab-zoom-out");
      expect(hidden).not.toContain(".fab-music");
      // each restored button gets its own slot, clear of Add (18) and Chat (74)
      expect(b).toMatch(/\.fab-zoom-out \{ bottom: calc\(130px/);
      expect(b).toMatch(/\.fab-zoom-in \{ bottom: calc\(186px/);
      expect(b).toMatch(/\.fab-music \{ bottom: calc\(74px/);
    });
  }
  it("Tools no longer duplicates zoom or music", () => {
    expect(tools).not.toMatch(/label: "Zoom in"/);
    expect(tools).not.toMatch(/label: "Zoom out"/);
    expect(tools).not.toMatch(/Music on|Music off/);
    expect(tools).toMatch(/label: "Recenter"/);
  });
  it("portrait hides header notices while Add or the dock is open (× was covered)", () => {
    expect(portrait()).toMatch(/\.app:has\(\.dock, \.ingest\) \.notifications-bar \{ display: none; \}/);
  });
});
