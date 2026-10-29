import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Persistent HUD (docs/specs/persistent-hud-2026-10-30.md): the stylesheet contract that keeps the HUD above every world. */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.css"), "utf8");
const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), "utf8");

describe("persistent HUD", () => {
  it("the worlds layer sits BELOW the HUD tiers, so core buttons and panels stay on top", () => {
    const z = Number(/--hud-z-world:\s*(\d+)/.exec(css)![1]);
    const passive = Number(/--hud-z-passive:\s*(\d+)/.exec(css)![1]);
    expect(z).toBeLessThan(passive);
    expect(css).toMatch(/\.worlds-surface \{ z-index: var\(--hud-z-world\)/);
  });
  it("the world's context bar and dock sit under the HUD's top row", () => {
    expect(css).toMatch(/\.worlds-surface-bar \{ top: var\(--hud-top\); \}/);
    expect(css).toMatch(/\.worlds-dock \{ top: calc\(var\(--hud-top\) \+ 3\.5rem\); \}/);
  });
  it("galaxy-camera controls and home-only readouts are hidden in worlds; the core buttons are not", () => {
    for (const hidden of [".focus-cluster", ".gv-wrap", ".fab-recenter", ".fab-zoom-in", ".fab-zoom-out", ".streak-ember", ".notifications-bar"]) {
      expect(css).toContain(`body.in-world ${hidden}`);
    }
    const hideRule = css.slice(css.lastIndexOf("body.in-world .focus-cluster"), css.indexOf("display: none;", css.lastIndexOf("body.in-world .focus-cluster")));
    for (const core of [".fab-dock", ".fab-search", ".fab-settings", ".fab-chat", ".fab-ingest", ".fab-observatory", ".fab-music", ".tools-btn"]) {
      expect(hideRule).not.toContain(core);
    }
  });
  it("the worlds layer announces itself with body classes", () => {
    const s = src("components/WorldsSurface.tsx");
    expect(s).toContain('b.classList.toggle("in-world", visible)');
    expect(s).toContain('b.classList.toggle("in-transit", visible && mode === "transit")');
  });
  it("one door per action: no Calm rail button, Search is a rail button and not a Tools entry", () => {
    expect(src("App.tsx")).not.toContain("fab-focus-toggle");
    expect(src("components/ToolsMenu.tsx")).not.toContain('label: "Search"');
    expect(src("components/NavRail.tsx")).toContain("fab-search");
  });
});
