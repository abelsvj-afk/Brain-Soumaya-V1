import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader HudDock.geometry.test.tsx uses (vitest's
 *  import.meta.url is not a file URL in this harness). */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

/**
 * Batch B — App-level items proven at the source seam (App.tsx is not
 * mounted by any harness in this repo; its wiring is pinned textually,
 * the same pattern HudDock.geometry.test.tsx uses):
 *  CH-02 the ChatDock onNavigate handler's flew===false branch toasts
 *        failure copy, not the success wording;
 *  CH-11 App passes ChatDock a real hasMemories signal;
 *  OB-06 App wires Observatory's onAnswered to its existing refresh;
 *  GH-06 the 🌌 toggle is captioned "Calm" (🎯 keeps "Focus"), and the
 *        Tools-menu door to the same toggle is renamed consistently.
 */

const appSrc = readRepoFile("src/App.tsx");
const toolsSrc = readRepoFile("src/components/ToolsMenu.tsx");

function window_(src: string, from: string, len: number): string {
  const a = src.indexOf(from);
  expect(a, `anchor ${from}`).toBeGreaterThan(-1);
  return src.slice(a, a + len);
}

describe("CH-02 — a failed navigation flight is announced as a failure", () => {
  it("the ChatDock onNavigate handler branches on flew with distinct failure copy", () => {
    const w = window_(appSrc, "onNavigate={(nav)", 1400);
    expect(w).toContain("flew");
    expect(w).toMatch(/couldn't fly/i);
    // The failure branch must not reuse the success wording pattern for both.
    expect(w).not.toMatch(/pushToast\(`\$\{icon\} \$\{nav\.target\.label \?\? "Navigating"\} — \$\{nav\.reason\}`, icon, flew \? 7000 : 5000\)/);
  });
});

describe("CH-11 / OB-06 — App wiring", () => {
  it("ChatDock receives hasMemories derived from the loaded graph", () => {
    const w = window_(appSrc, "<ChatDock", 700);
    expect(w).toMatch(/hasMemories=\{[^}]*data\.nodes\.length > 0[^}]*\}/);
  });

  it("Observatory receives onAnswered wired to the existing refresh paths", () => {
    const w = window_(appSrc, "<Observatory", 2200);
    expect(w).toContain("onAnswered={() => {");
    expect(w).toContain("void refresh();");
    expect(w).toContain("getStreak()");
    expect(w).toContain("setStreak(s)");
  });
});

describe("GH-06 — one 'Focus' only: the 🎯 fan; the 🌌 toggle is 'Calm'", () => {
  it("the fab-focus-toggle window carries the Calm caption, not Focus", () => {
    const w = window_(appSrc, "fab-focus-toggle", 1100);
    expect(w).toContain('fab-cap">Calm');
    expect(w).not.toContain('fab-cap">Focus');
  });

  it("the 🎯 focus-main button keeps the Focus caption", () => {
    const w = window_(appSrc, "focus-main", 1500);
    expect(w).toContain('fab-cap">Focus');
  });

  it("the Tools menu's door to the same toggle no longer says Focus", () => {
    expect(toolsSrc).toContain('"Calm mode"');
    expect(toolsSrc).toContain('"Exit calm"');
    expect(toolsSrc).not.toContain('"Focus mode"');
    expect(toolsSrc).not.toContain('"Exit focus"');
  });

  it("the focus-mode toast in App names the Calm label the user must find in Tools", () => {
    const w = window_(appSrc, "focusMode ? \"", 400);
    expect(w).toMatch(/calm mode on/i);
  });
});
