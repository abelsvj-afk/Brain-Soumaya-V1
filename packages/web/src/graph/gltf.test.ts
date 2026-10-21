import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { noteModelFallback, getModelFallbacks, fadeSwapIn } from "./gltf.js";

/** IM-24 — glTF failure registry + softened swap-in. */

describe("model fallback registry", () => {
  it("records each failed asset once and returns a copy", () => {
    noteModelFallback("The Waystation model");
    noteModelFallback("The Waystation model");
    noteModelFallback("The Aura beacon model");
    const list = getModelFallbacks();
    expect(list).toEqual(["The Waystation model", "The Aura beacon model"]);
    list.push("mutated");
    expect(getModelFallbacks()).not.toContain("mutated");
  });
});

describe("fadeSwapIn", () => {
  it("starts the model transparent and hides the fallback mid-fade", async () => {
    const mat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    let hidden = false;
    fadeSwapIn(model, () => {
      hidden = true;
    });
    expect(mat.opacity).toBe(0);
    expect(mat.transparent).toBe(true);
    // happy-dom provides rAF; the 600ms fade should complete shortly after.
    await new Promise((r) => setTimeout(r, 900));
    expect(hidden).toBe(true);
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false); // restored to its resting state
  });
});
