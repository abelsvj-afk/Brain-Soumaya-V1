import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, afterEach } from "vitest";
import { restoreFocus } from "./hooks/useDialogA11y.js";
import { drawLabelBacking, LABEL_BACKING_FILL } from "./graph/nodeObject.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");
const ingest = readFileSync(join(here, "components/IngestPanel.tsx"), "utf8");

afterEach(() => { document.body.innerHTML = ""; });

describe("Reviewer r2 layout / a11y follow-ups (#171, #172, #175)", () => {
  it("the '+ tag' input's 44px rule targets the row it actually sits in", () => {
    // IngestPanel renders the tag input inside .tag-row
    expect(ingest).toMatch(/className="tag-row"[\s\S]{0,2000}className=\{?["`]tag-input/);
    expect(css).toContain(".ingest .tag-row .tag-input { min-height: 44px; }");
    expect(css).not.toContain(".ingest .row .tag-input");
  });
  it("panel-in no longer scales controls below 44px while it starts", () => {
    const kf = css.match(/@keyframes panel-in \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(kf).toContain("translateY(10px)");
    expect(kf).not.toMatch(/scale\(/);
  });
  it("Observatory quest rows meet 44px", () => {
    expect(css).toMatch(/\.obs-answer-send, \.obs-quest \{ min-height: 44px; \}/);
  });
  it("landscape hides header notices while the dock OR Add is open", () => {
    const at = css.indexOf("@media (max-height: 500px) and (orientation: landscape) {");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(css.slice(at, at + 6000)).toContain(".app:has(.dock, .ingest) .notifications-bar { display: none; }");
  });
  it("the streak button is styled, not the browser's white default", () => {
    const rule = css.match(/\.streak-ember\.tappable \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/background: rgba\(/);
    expect(rule).toMatch(/appearance: none/);
  });
  it("labels get a dark translucent backing pill", () => {
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push("save"), restore: () => calls.push("restore"), beginPath: () => {},
      roundRect: (...a: number[]) => calls.push(`roundRect ${a.join(",")}`), rect: () => calls.push("rect"),
      fill: () => calls.push("fill"), set fillStyle(v: string) { calls.push(`fill=${v}`); },
    } as unknown as CanvasRenderingContext2D;
    drawLabelBacking(ctx, 200, 80);
    expect(calls).toContain(`fill=${LABEL_BACKING_FILL}`);
    expect(calls.some((c) => c.startsWith("roundRect 1,1,198,78"))).toBe(true);
    expect(calls).toContain("fill");
  });
});

describe("useDialogA11y restoreFocus — fallback when the opener is gone", () => {
  it("returns focus to the opener when it still exists", () => {
    document.body.innerHTML = `<button id="op">open</button><button aria-label="Add a memory">+</button>`;
    const op = document.getElementById("op") as HTMLElement;
    restoreFocus(op);
    expect(document.activeElement).toBe(op);
  });
  it("falls back to the first-star cue, then Add, when the opener unmounted or was <body>", () => {
    document.body.innerHTML = `<button aria-label="Add a memory">+</button>`;
    const gone = document.createElement("button");
    restoreFocus(gone);
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("Add a memory");
    document.body.innerHTML = `<div class="empty-galaxy-cue"><button>Add your first memory</button></div><button aria-label="Add a memory">+</button>`;
    restoreFocus(document.body);
    expect(document.activeElement?.textContent).toBe("Add your first memory");
  });
});
