import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import TravelSheet from "./TravelSheet.js";

afterEach(cleanup);

function readRepoFile(rel: string): string {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)]) {
    if (existsSync(c)) return readFileSync(c, "utf8");
  }
  throw new Error(`cannot find ${rel}`);
}

const css = readRepoFile("src/index.css").replace(/\/\*[\s\S]*?\*\//g, "");
const appSrc = readRepoFile("src/App.tsx");

function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1]!;
}

describe("stylesheet integrity", () => {
  // An unclosed rule makes every later rule a nested descendant of it, so
  // they silently match nothing — that is how the World map lost its
  // fixed positioning and rendered off-screen. jsdom never lays out, so
  // only a structural check like this catches it.
  it("every { in index.css is closed — braces balance and never go negative", () => {
    let depth = 0;
    let line = 1;
    for (const ch of css) {
      if (ch === "\n") line++;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        expect(depth, `stray } near stripped line ${line}`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(depth).toBe(0);
  });

  it("the world map's overlay rule is top-level and fixed", () => {
    expect(ruleBody(".world-map")).toMatch(/position:\s*fixed/);
  });
});

describe("travel sheet — placement", () => {
  it("is a fixed, full-viewport layer above the worlds layer, and [hidden] really hides it", () => {
    const body = ruleBody(".travel-sheet");
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/inset:\s*0/);
    const z = Number(/z-index:\s*(\d+)/.exec(body)?.[1]);
    expect(z).toBeGreaterThan(70);
    expect(ruleBody(".travel-sheet[hidden]")).toMatch(/display:\s*none/);
  });

  it("its body scrolls, so a long route board can't run off the card", () => {
    expect(ruleBody(".travel-sheet-body")).toMatch(/overflow-y:\s*auto/);
  });

  it("App mounts every worlds panel INSIDE the sheet, never loose in .app", () => {
    const open = appSrc.indexOf("<TravelSheet");
    const close = appSrc.indexOf("</TravelSheet>");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    for (const panel of ["<TravelPanel", "<ToursPanel", "<ApprovalsInbox", "<WorldChangesView"]) {
      const first = appSrc.indexOf(panel);
      expect(first, panel).toBeGreaterThan(open);
      expect(first, panel).toBeLessThan(close);
      expect(appSrc.indexOf(panel, first + 1), `${panel} mounted twice`).toBe(-1);
    }
  });

  it("every way into travel opens the sheet — no bare focus setter left behind", () => {
    // The only call to the focus setter is inside openTravel itself.
    expect(appSrc.match(/setTravelFocus\(/g)).toHaveLength(1);
    expect(appSrc).toMatch(/const openTravel = useCallback\(\(world[^)]*\) => \{\s*setTravelFocus\(world\);\s*setShowTravel\(true\);/);
    expect(appSrc).toMatch(/openTravel\(world\)/);
    expect(appSrc).toMatch(/openTravel\(String\(a\.value\)\)/);
  });
});

describe("TravelSheet — behaviour", () => {
  function Counter() {
    const [n, setN] = useState(0);
    return <button onClick={() => setN((v) => v + 1)}>count {n}</button>;
  }

  it("stays mounted while closed, so the panels inside keep their state", () => {
    const { rerender, container } = render(
      <TravelSheet open onClose={() => {}}>
        <Counter />
      </TravelSheet>,
    );
    fireEvent.click(screen.getByText("count 0"));
    rerender(
      <TravelSheet open={false} onClose={() => {}}>
        <Counter />
      </TravelSheet>,
    );
    expect(container.querySelector(".travel-sheet")?.hasAttribute("hidden")).toBe(true);
    rerender(
      <TravelSheet open onClose={() => {}}>
        <Counter />
      </TravelSheet>,
    );
    expect(screen.getByText("count 1")).toBeTruthy();
  });

  it("closes on the × button, on the scrim, and on Escape — but not on a click inside the card", () => {
    const onClose = vi.fn();
    const { container } = render(
      <TravelSheet open onClose={onClose}>
        <p>inside</p>
      </TravelSheet>,
    );
    fireEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Close travel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".travel-sheet")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
