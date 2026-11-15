import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import * as THREE from "three";
import { applyLabelViewportScale, PHONE_LABEL_SCALE } from "./graph/nodeObject.js";
import { useNoticesBottomVar, NOTICES_BOTTOM_VAR } from "./components/NotificationsBar.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");
const graph = readFileSync(join(here, "graph/Graph3D.tsx"), "utf8");

function landscapeBlock(): string {
  const at = css.indexOf("@media (max-height: 500px) and (orientation: landscape) {");
  expect(at).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("\n}\n", at));
}

afterEach(() => { document.documentElement.style.removeProperty(NOTICES_BOTTOM_VAR); });

describe("Reviewer r4 follow-ups", () => {
  it("applyLabelViewportScale rescales a memory label when the phone scale flips, and back", () => {
    const s = new THREE.Sprite();
    s.userData.labelBaseScale = [40, 10];
    s.userData.labelViewportScale = 1;
    s.scale.set(40, 10, 1);
    expect(applyLabelViewportScale(s, 1)).toBe(false); // unchanged → no work
    expect(applyLabelViewportScale(s, PHONE_LABEL_SCALE)).toBe(true);
    expect(s.scale.x).toBeCloseTo(40 * PHONE_LABEL_SCALE);
    expect(s.scale.y).toBeCloseTo(10 * PHONE_LABEL_SCALE);
    expect(applyLabelViewportScale(s, 1)).toBe(true);
    expect(s.scale.x).toBe(40);
  });
  it("labels without a base scale (sector titles) are never touched", () => {
    const s = new THREE.Sprite();
    s.scale.set(7, 3, 1);
    expect(applyLabelViewportScale(s, PHONE_LABEL_SCALE)).toBe(false);
    expect(s.scale.x).toBe(7);
  });
  it("Graph3D re-reads the phone-portrait check each frame and applies the label scale", () => {
    expect(graph).toMatch(/let IS_PHONE_PORTRAIT = isPhonePortraitViewport/);
    expect(graph).toMatch(/IS_PHONE_PORTRAIT = isPhonePortraitViewport\(window\.innerWidth, window\.innerHeight\)/);
    expect(graph).toContain("if (child.userData?.isLabel) applyLabelViewportScale(child, labelViewportScale);");
  });
  it("--notices-bottom is cleared when the banner measures 0 (hidden)", () => {
    const el = document.createElement("div");
    let h = 96;
    el.getBoundingClientRect = () => ({ top: 104, bottom: 104 + h, height: h, left: 0, right: 0, width: 0, x: 0, y: 104, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    renderHook(() => useNoticesBottomVar({ current: el }, 1));
    expect(document.documentElement.style.getPropertyValue(NOTICES_BOTTOM_VAR)).toBe("200px");
    h = 0;
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.getPropertyValue(NOTICES_BOTTOM_VAR)).toBe("");
    el.remove();
  });
  it("landscape: streak chip leaves the Focus/Views column for the right-column gap", () => {
    expect(landscapeBlock()).toMatch(/\.streak-ember \{\s*top: calc\(68px[^}]*right: calc\(14px/);
  });
  it("landscape: expanded warming card stays left of the centre band", () => {
    expect(landscapeBlock()).toContain("width: min(26vw, 218px)");
  });
});
