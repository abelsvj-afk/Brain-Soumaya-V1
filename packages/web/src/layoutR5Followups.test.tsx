import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, act, fireEvent, cleanup } from "@testing-library/react";
import * as THREE from "three";
import { rescaleCachedLabels, PHONE_LABEL_SCALE } from "./graph/nodeObject.js";
import { ShipStatusStack, SHIP_STATUS_AUTO_COLLAPSE_MS } from "./components/GalaxyHud.js";
import * as hud from "./components/GalaxyHud.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");
const app = readFileSync(join(here, "App.tsx"), "utf8");
const graph = readFileSync(join(here, "graph/Graph3D.tsx"), "utf8");

function block(header: string): string {
  const at = css.indexOf(header);
  expect(at, header).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("\n}\n", at));
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Reviewer r5 follow-ups", () => {
  it("1: a phone-portrait flip rescales every cached node's labels, hidden ones included", () => {
    const mk = (visible: boolean) => {
      const g = new THREE.Group();
      const s = new THREE.Sprite();
      s.userData.isLabel = true;
      s.userData.labelBaseScale = [40, 10];
      s.userData.labelViewportScale = 1;
      s.scale.set(40, 10, 1);
      s.visible = visible;
      g.add(s);
      return { obj: g, key: "k", s };
    };
    const a = mk(true), b = mk(false);
    expect(rescaleCachedLabels([a, b], PHONE_LABEL_SCALE)).toBe(2);
    expect(b.s.scale.x).toBeCloseTo(40 * PHONE_LABEL_SCALE);
    expect(rescaleCachedLabels([a, b], PHONE_LABEL_SCALE)).toBe(0);
    expect(graph).toContain("rescaleCachedLabels(nodeThreeObjCacheRef.current.values(), nextLabelScale)");
  });
  it("2: portrait streak chip sits in the header row, left of Tools — off the banner (top 104)", () => {
    const p = block("@media (max-width: 560px) and (orientation: portrait) {");
    expect(p).toMatch(/\.streak-ember \{[^}]*top: calc\(14px[^}]*right: calc\(68px/);
    expect(p).toContain(".app:has(.streak-ember) .brand h1");
  });
  it("3: desktop streak chip under Tools; gauge ends above the left button rail", () => {
    const d = block("@media (min-width: 721px) and (min-height: 501px) {");
    expect(d).toMatch(/\.streak-ember \{[^}]*right: calc\(14px/);
    expect(d).toMatch(/\.fuel-gauge \{[^}]*bottom: calc\(var\(--hud-cam-focus-bottom\) \+ 58px/);
  });
  it("4: the first-star cue hides while a world is open", () => {
    expect(css).toMatch(/body\.in-world \.empty-galaxy-cue \{ display: none; \}/);
  });
  it("5: #183 dead code is gone", () => {
    expect((hud as Record<string, unknown>).AudioStateChip).toBeUndefined();
    expect((hud as Record<string, unknown>).shipStatusPrefKey).toBeUndefined();
    expect((hud as Record<string, unknown>).shipStatusSeenKey).toBeUndefined();
    expect(app).not.toMatch(/sfxOnHud|voiceOnHud|settingsFocusAudio/);
    expect(css).not.toContain("audio-state-chip");
  });
  it("6: a tap-style (non keyboard) focus does not hold the expanded card open", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    const { container } = render(
      <ShipStatusStack onToggle={onToggle}>
        <button type="button">target</button>
      </ShipStatusStack>,
    );
    const btn = container.querySelector("button")!;
    // jsdom: :focus-visible does not match a programmatic/pointer focus.
    fireEvent.focus(btn);
    act(() => { vi.advanceTimersByTime(SHIP_STATUS_AUTO_COLLAPSE_MS + 50); });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it("6: keyboard focus (:focus-visible) still holds it open", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    const { container } = render(
      <ShipStatusStack onToggle={onToggle}>
        <button type="button">target</button>
      </ShipStatusStack>,
    );
    const btn = container.querySelector("button")!;
    const real = btn.matches.bind(btn);
    (btn as unknown as { matches: (s: string) => boolean }).matches = (sel: string) =>
      sel === ":focus-visible" ? true : real(sel);
    fireEvent.focus(btn);
    act(() => { vi.advanceTimersByTime(SHIP_STATUS_AUTO_COLLAPSE_MS * 2); });
    expect(onToggle).not.toHaveBeenCalled();
  });
});
