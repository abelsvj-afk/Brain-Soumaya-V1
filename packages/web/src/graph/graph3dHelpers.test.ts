import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { linkEnd, linkKey, LINK_LOD_MIN, LINK_LOD_ZOOM, LINK_LOD_CUTOFF, isNodeLit, isNodeCacheEntryValid, shouldApplyPixelRatio, highlightMaterialState, computeGlowFar, pickNearestIds } from "./graph3dHelpers.js";

/** Locks the pure Graph3D helpers extracted in D4. (updateFigurine/disposeObject3D
 *  need a WebGL/GLTF context, so they're exercised by the app, not here.) */
describe("graph3dHelpers", () => {
  it("linkEnd reads an id from either a raw id or a node object", () => {
    expect(linkEnd(42)).toBe(42);
    expect(linkEnd({ id: 7 })).toBe(7);
  });

  it("linkKey is stable and order-sensitive per direction", () => {
    const k1 = linkKey({ source: 1, target: 2 });
    const k2 = linkKey({ source: { id: 1 }, target: { id: 2 } });
    expect(k1).toBe(k2); // object vs raw endpoints resolve the same
  });

  it("exposes sane LOD thresholds (min < zoom, cutoff in 0..1)", () => {
    expect(LINK_LOD_MIN).toBeLessThan(LINK_LOD_ZOOM);
    expect(LINK_LOD_CUTOFF).toBeGreaterThan(0);
    expect(LINK_LOD_CUTOFF).toBeLessThan(1);
  });
});

/**
 * Galaxy node-object cache disposal desync fix
 * (docs/specs/soumaya-galaxy-cache-disposal-audit.md): three-forcegraph's own internal node
 * cache can be cleared and its Object3Ds disposed independently of Graph3D's own
 * `nodeThreeObjCacheRef` (e.g. an unmemoized prop reference change, or an existing fg.refresh()
 * call) — always detaching the object from the scene immediately before disposing it. A matching
 * cache key alone can't tell a still-live cached object apart from one that was just torn down,
 * so `isNodeCacheEntryValid` also requires the object to still have a parent.
 */
describe("graph3dHelpers — isNodeCacheEntryValid (cache disposal desync fix)", () => {
  it("matching key + object still attached to a scene -> valid cache hit", () => {
    const scene = new THREE.Scene();
    const obj = new THREE.Group();
    scene.add(obj);
    expect(isNodeCacheEntryValid({ obj, key: "k1" }, "k1")).toBe(true);
  });

  it("matching key + object detached (parent === null, as three-forcegraph leaves it after disposal) -> invalid, must rebuild", () => {
    const scene = new THREE.Scene();
    const obj = new THREE.Group();
    scene.add(obj);
    scene.remove(obj); // exactly what three-forcegraph's onRemoveObj wrapper does before _deallocate
    expect(obj.parent).toBeNull();
    expect(isNodeCacheEntryValid({ obj, key: "k1" }, "k1")).toBe(false);
  });

  it("different key (real content change) -> invalid regardless of attachment, same as existing cache-miss behavior", () => {
    const scene = new THREE.Scene();
    const obj = new THREE.Group();
    scene.add(obj);
    expect(isNodeCacheEntryValid({ obj, key: "k1" }, "k2")).toBe(false);
  });

  it("no cached entry (a genuinely new node) -> invalid, same as always", () => {
    expect(isNodeCacheEntryValid(undefined, "k1")).toBe(false);
  });

  it("a freshly created Object3D not yet added to any scene is correctly treated as having no parent", () => {
    // Not a cache-hit scenario in practice (a fresh object is always scene.add()-ed by
    // three-forcegraph's own onCreateObj wrapper right after creation), but pins that the
    // check is purely structural (`.parent`), not tied to any Galaxy-specific setup.
    const obj = new THREE.Group();
    expect(isNodeCacheEntryValid({ obj, key: "k1" }, "k1")).toBe(false);
  });
});

/**
 * Adaptive-graphics pixel-ratio churn fix: WebGLRenderer.setPixelRatio() has no internal
 * early-out (it unconditionally calls setSize(), resizing the WebGL drawing buffer), so the
 * call sites in Graph3D.tsx must gate on the EFFECTIVE value actually changing rather than
 * assuming "the rung changed" implies "the pixel ratio changed."
 */
describe("graph3dHelpers — shouldApplyPixelRatio (pixel-ratio churn fix)", () => {
  it("no prior applied value (first apply) -> should apply", () => {
    expect(shouldApplyPixelRatio(null, 1.5)).toBe(true);
  });

  it("same value as last applied -> should NOT apply, even across repeated calls", () => {
    expect(shouldApplyPixelRatio(1.5, 1.5)).toBe(false);
    expect(shouldApplyPixelRatio(1, 1)).toBe(false);
  });

  it("a genuinely different value -> should apply", () => {
    expect(shouldApplyPixelRatio(1, 1.25)).toBe(true);
    expect(shouldApplyPixelRatio(2, 1)).toBe(true);
  });

  it("adjacent rungs sharing a pixelRatioCap resolve to the same value -> suppressed", () => {
    // RUNG_TABLE has rungs 0/1 both mapping to detailTier "performance" but different
    // pixelRatioCap (1.0 vs 1.25) — this test instead pins the general contract those
    // rungs rely on: a rung CHANGE whose resolved pixelRatio happens to be unchanged
    // (e.g. a descend-then-ascend round trip back to a previously-applied value) must
    // not re-trigger a buffer resize.
    expect(shouldApplyPixelRatio(1.25, 1.25)).toBe(false);
  });
});

/**
 * Regression coverage for the second render-cost finding in
 * soumaya-galaxy-large-render-forensic-audit.md §8.2: the hover-highlight effect used to
 * force `transparent = true` on every node child unconditionally, including opaque-by-
 * construction body meshes, which pushed every body into three.js's transparent queue
 * (no early-Z rejection) even when nothing was selected and nothing needed to fade.
 */
describe("graph3dHelpers — highlightMaterialState (early-Z restoration fix)", () => {
  it("a lit body is restored to fully opaque, not left transparent for no reason", () => {
    expect(highlightMaterialState(true, true)).toEqual({ transparent: false, opacity: 1 });
  });

  it("a dimmed body still needs real alpha blending to fade", () => {
    expect(highlightMaterialState(true, false)).toEqual({ transparent: true, opacity: 0.12 });
  });

  it("a lit non-body child (label/glow/ring/belt) stays transparent, unchanged from before", () => {
    expect(highlightMaterialState(false, true)).toEqual({ transparent: true, opacity: 1 });
  });

  it("a dimmed non-body child stays transparent at the same reduced opacity as before", () => {
    expect(highlightMaterialState(false, false)).toEqual({ transparent: true, opacity: 0.12 });
  });
});

/**
 * Node-glow render-stall fix (2026-09-10 sub-isolation sweep): the render-isolation
 * sweep measured glow/corona sprites alone costing MORE render time than the
 * full-detail body mesh itself (a real device: 177.7ms baseline -> 10.5ms with glow
 * off, vs. 96.6ms with the core mesh off). `computeGlowFar` gives glow a tighter cutoff
 * than the ordinary macro-view swap, using the same hysteresis shape already proven for
 * isMacroView (see the link-LOD flicker fix this pattern is itself modeled on).
 */
describe("graph3dHelpers — computeGlowFar (node-glow render-stall fix)", () => {
  const DIST = 600;
  const HYST = 80;

  it("a body well inside GLOW_DIST is never far, regardless of prior state", () => {
    expect(computeGlowFar(100, false, false, DIST, HYST)).toBe(false);
    expect(computeGlowFar(100, true, false, DIST, HYST)).toBe(false);
  });

  it("a body well beyond GLOW_DIST is always far, regardless of prior state", () => {
    expect(computeGlowFar(2000, false, false, DIST, HYST)).toBe(true);
    expect(computeGlowFar(2000, true, false, DIST, HYST)).toBe(true);
  });

  it("hysteresis: once far, must clear dist - hyst (not just dist) to come back near", () => {
    // Sitting exactly at GLOW_DIST - 40 (inside the hysteresis band, still > dist-hyst):
    // a body that WAS far stays far until it clears the inner edge.
    expect(computeGlowFar(DIST - 40, true, false, DIST, HYST)).toBe(true);
    // Once it clears the inner edge, it's near again.
    expect(computeGlowFar(DIST - HYST - 1, true, false, DIST, HYST)).toBe(false);
  });

  it("hysteresis: once near, must exceed dist + hyst (not just dist) to become far", () => {
    // Sitting exactly at GLOW_DIST + 40 (inside the band, still < dist+hyst): a body
    // that WAS near stays near until it clears the outer edge.
    expect(computeGlowFar(DIST + 40, false, false, DIST, HYST)).toBe(false);
    // Once it clears the outer edge, it's far.
    expect(computeGlowFar(DIST + HYST + 1, false, false, DIST, HYST)).toBe(true);
  });

  it("at the exact midpoint distance, the result depends only on prior state (both bands include it)", () => {
    // dist === GLOW_DIST sits inside BOTH hysteresis bands (glowDist-hyst < dist <
    // glowDist+hyst) — the whole point of hysteresis is that a body hovering exactly
    // here doesn't oscillate; it just keeps whatever state it already had.
    expect(computeGlowFar(DIST, true, false, DIST, HYST)).toBe(true); // was far -> stays far
    expect(computeGlowFar(DIST, false, false, DIST, HYST)).toBe(false); // was near -> stays near
  });

  it("the selected/active body is exempt at ANY distance — the cheap active-node exception", () => {
    expect(computeGlowFar(50000, false, true, DIST, HYST)).toBe(false);
    expect(computeGlowFar(50000, true, true, DIST, HYST)).toBe(false);
  });

  it("is a pure function — same inputs always produce the same output, no hidden state", () => {
    const a = computeGlowFar(700, false, false, DIST, HYST);
    const b = computeGlowFar(700, false, false, DIST, HYST);
    expect(a).toBe(b);
  });
});

/**
 * Bounded full-fidelity body population (MAX_FIDELITY_BODIES in Graph3D.tsx). Every
 * automated in-session diagnostic run agreed that a mostly-macro galaxy renders in
 * ~9-15ms/frame while a mostly-full-fidelity one costs ~1400-2900ms, regardless of
 * which decoration was nominally being isolated — and the owner's own observation is
 * that opening a Lens/View (fewer bodies on screen, nothing else) makes it instantly
 * usable. A distance threshold can't bound that; a COUNT cap can.
 */
describe("graph3dHelpers — pickNearestIds (bounded full-fidelity population)", () => {
  const none = new Set<number>();

  it("keeps only the N nearest ids", () => {
    const got = pickNearestIds([{ id: 1, d: 50 }, { id: 2, d: 10 }, { id: 3, d: 30 }], 2, none);
    expect(got).toEqual(new Set([2, 3]));
  });

  it("returns everything when there are fewer candidates than the cap", () => {
    const got = pickNearestIds([{ id: 7, d: 5 }], 10, none);
    expect(got).toEqual(new Set([7]));
  });

  it("returns an empty set for a zero cap, and never exceeds the cap", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: i, d: i }));
    expect(pickNearestIds(many, 0, none).size).toBe(0);
    expect(pickNearestIds(many, 12, none).size).toBe(12);
  });

  it("is sticky: an incumbent keeps its slot against a marginally-nearer rival", () => {
    // Incumbent 1 at d=100 reads as 85; rival 2 at d=90 does not beat that.
    const got = pickNearestIds([{ id: 1, d: 100 }, { id: 2, d: 90 }], 1, new Set([1]));
    expect(got).toEqual(new Set([1]));
  });

  it("stickiness still yields to a CLEAR overtake, so it can't freeze the set forever", () => {
    // Incumbent 1 at d=100 reads as 85; rival 2 at d=50 clearly beats that.
    const got = pickNearestIds([{ id: 1, d: 100 }, { id: 2, d: 50 }], 1, new Set([1]));
    expect(got).toEqual(new Set([2]));
  });

  it("does not mutate the caller's candidate array (it's a reused per-frame scratch buffer)", () => {
    const candidates = [{ id: 1, d: 50 }, { id: 2, d: 10 }];
    pickNearestIds(candidates, 1, none);
    expect(candidates.map((c) => c.id)).toEqual([1, 2]); // original order intact
  });

  it("handles an empty candidate list", () => {
    expect(pickNearestIds([], 12, none).size).toBe(0);
  });
});

describe("graph3dHelpers — isNodeLit (galaxy fluidity: ref-delivered selection gate)", () => {
  // The predicate Graph3D's isLit closure used to compute inline; extracted
  // so the []-stable linkWidthCb can evaluate it against (activeIdRef,
  // adjacencyRef) with identical outcomes. Truth table pinned here.
  const adj = new Map<number, Set<number>>([
    [5, new Set([7, 8])],
    [7, new Set([5])],
    [8, new Set([5])],
  ]);

  it("no active node → everything is lit", () => {
    expect(isNodeLit(5, null, adj)).toBe(true);
    expect(isNodeLit(999, null, adj)).toBe(true);
    expect(isNodeLit(999, null, new Map())).toBe(true);
  });

  it("the active node itself is lit", () => {
    expect(isNodeLit(5, 5, adj)).toBe(true);
  });

  it("direct neighbors of the active node are lit", () => {
    expect(isNodeLit(7, 5, adj)).toBe(true);
    expect(isNodeLit(8, 5, adj)).toBe(true);
    expect(isNodeLit(5, 7, adj)).toBe(true);
  });

  it("non-neighbors are not lit", () => {
    expect(isNodeLit(8, 7, adj)).toBe(false);
    expect(isNodeLit(999, 5, adj)).toBe(false);
  });

  it("an active node with no adjacency entry lights only itself", () => {
    expect(isNodeLit(42, 42, adj)).toBe(true);
    expect(isNodeLit(5, 42, adj)).toBe(false);
  });
});
