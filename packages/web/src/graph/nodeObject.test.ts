import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as THREE from "three";
import { makeNodeObject, nodeVisualCacheKey, releaseNodeTextures } from "./nodeObject.js";
import type { GraphNode } from "@brain/shared";

/**
 * Pins the Performance Program Stage 4 geometry diet: a flat SphereGeometry(size,48,48)
 * for every star/planet regardless of tier or how many screen pixels it covers was real
 * waste (~4600 tris for something often 40px on screen). Segment counts now follow the
 * same star/planet/rocky role split as the shader material choice.
 *
 * happy-dom (this project's test environment) has no real 2D canvas context, and
 * makeNodeObject's label/glow/surface-texture helpers need one — a stub covering the
 * handful of methods they actually call (scoped to this file, restored after) is enough
 * to exercise the real object-construction code instead of skipping it.
 */
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function () {
    const grad = { addColorStop: () => {} };
    return {
      font: "",
      textBaseline: "",
      shadowColor: "",
      shadowBlur: 0,
      globalAlpha: 1,
      set fillStyle(_v: unknown) {},
      measureText: () => ({ width: 10 }),
      fillText: () => {},
      fillRect: () => {},
      createRadialGradient: () => grad,
      beginPath: () => {},
      ellipse: () => {},
      arc: () => {},
      fill: () => {},
    };
  };
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function node(celestial: GraphNode["celestial"], extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 1,
    label: "test",
    type: "memory" as any,
    content: "",
    createdAt: new Date().toISOString(),
    celestial,
    ...extra,
  } as GraphNode;
}

// Every body carries TWO spheres — the full-detail mesh and the low-poly "macro" LOD
// body (always 14x14, added alongside it, swapped in by distance in Graph3D's tick loop)
// — so this must target the full-detail one specifically via its isFidelity tag rather
// than grabbing whichever SphereGeometry traverse() happens to visit last.
function findFullDetailSphere(obj: THREE.Object3D): THREE.SphereGeometry {
  let found: THREE.SphereGeometry | undefined;
  obj.traverse((o: any) => {
    if (o.isMesh && o.userData?.isFidelity && o.geometry?.type === "SphereGeometry") found = o.geometry;
  });
  if (!found) throw new Error("no full-detail SphereGeometry found");
  return found;
}

describe("nodeObject — Stage 4 geometry segment diet", () => {
  it("stars get 32x24 (their granule shader reads at a glance, usually the biggest/closest body)", () => {
    const geom = findFullDetailSphere(makeNodeObject(node("star")));
    expect(geom.parameters.widthSegments).toBe(32);
    expect(geom.parameters.heightSegments).toBe(24);
  });

  it("planets/giants get 24x16 (terrain rarely needs more detail than that)", () => {
    for (const cls of ["planet", "gas_giant", "giant"] as const) {
      const geom = findFullDetailSphere(makeNodeObject(node(cls)));
      expect(geom.parameters.widthSegments).toBe(24);
      expect(geom.parameters.heightSegments).toBe(16);
    }
  });

  it("moons stay at the pre-existing conservative 24x24", () => {
    const geom = findFullDetailSphere(makeNodeObject(node("moon")));
    expect(geom.parameters.widthSegments).toBe(24);
    expect(geom.parameters.heightSegments).toBe(24);
  });

  it("asteroids' full-detail body is still an icosahedron, not a sphere", () => {
    let isIco = false;
    // Every body also carries the low-poly macro LOD sphere (see findFullDetailSphere's
    // comment) — checking every isFidelity mesh, not just the last one traverse() visits.
    makeNodeObject(node("asteroid")).traverse((o: any) => {
      if (o.isMesh && o.userData?.isFidelity) isIco = o.geometry?.type === "IcosahedronGeometry";
    });
    expect(isIco).toBe(true);
  });
});

/**
 * Galaxy render forensic audit §8.2/§22: the full-detail body, its macro-LOD sibling, and
 * an action item's core are all opaque by construction (none of their materials set
 * `transparent: true`) — Graph3D's hover-highlight effect uses `userData.isBody` to know
 * it's safe to restore these to fully opaque while lit, instead of leaving them in
 * three.js's transparent render queue (no early-Z rejection) unconditionally. Rings,
 * glow/corona sprites, labels, and asteroid belts must NOT carry this tag — they are
 * genuinely transparent by design with their own tuned base opacity.
 */
describe("nodeObject — isBody tagging (early-Z restoration fix)", () => {
  it("the full-detail celestial mesh and its macro-LOD sibling are both tagged isBody", () => {
    let fullDetailIsBody = false;
    let macroIsBody = false;
    makeNodeObject(node("planet")).traverse((o: any) => {
      if (o.isMesh && o.userData?.isFidelity && o.geometry?.type === "SphereGeometry") {
        fullDetailIsBody = !!o.userData.isBody;
      }
      if (o.isMesh && o.userData?.isMacro) macroIsBody = !!o.userData.isBody;
    });
    expect(fullDetailIsBody).toBe(true);
    expect(macroIsBody).toBe(true);
  });

  it("an action item's core mesh is tagged isBody", () => {
    let coreIsBody = false;
    makeNodeObject({ id: 2, label: "do thing", type: "memory" as any, content: "", createdAt: new Date().toISOString(), kind: "action" } as GraphNode).traverse(
      (o: any) => {
        if (o.isMesh && o.userData?.spin && o.geometry?.type === "OctahedronGeometry") coreIsBody = !!o.userData.isBody;
      },
    );
    expect(coreIsBody).toBe(true);
  });

  it("a gas-giant ring and a star's glow sprite are NOT tagged isBody — they're transparent by design", () => {
    // Ring gating is hashed on node id (1/5 chance) — id chosen so `(id*2654435761)>>>0 % 5 === 0`.
    let ringId = 0;
    while (((ringId * 2654435761) >>> 0) % 5 !== 0) ringId++;
    let sawRing = false;
    makeNodeObject(node("gas_giant", { id: ringId })).traverse((o: any) => {
      if (o.isMesh && o.geometry?.type === "RingGeometry") {
        sawRing = true;
        expect(o.userData.isBody).toBeUndefined();
      }
    });
    expect(sawRing).toBe(true);

    let sawGlow = false;
    makeNodeObject(node("star")).traverse((o: any) => {
      if (o.isSprite && o.userData?.glowCacheKey != null) {
        sawGlow = true;
        expect(o.userData.isBody).toBeUndefined();
      }
    });
    expect(sawGlow).toBe(true);
  });
});

/**
 * Galaxy render recovery pass (2026-09-10): unlike every celestial body, an action item
 * had NO macro-LOD fallback at all — its ring+glow+core (3 draw calls) rendered
 * unconditionally regardless of camera distance, uncapped by any LOD. Tagging the
 * decorative ring+glow isFidelity reuses Graph3D's existing isMacroView distance swap for
 * free. The core must stay untagged so an urgent action item never fully disappears.
 */
describe("nodeObject — action item LOD (uncapped-draw-call fix)", () => {
  function actionNode(id = 2): GraphNode {
    return { id, label: "do thing", type: "memory" as any, content: "", createdAt: new Date().toISOString(), kind: "action" } as GraphNode;
  }

  it("the ring and glow are tagged isFidelity so they hide at macro distance", () => {
    let ringIsFidelity = false;
    let glowIsFidelity = false;
    let sawRing = false;
    let sawGlow = false;
    makeNodeObject(actionNode()).traverse((o: any) => {
      if (o.isMesh && o.geometry?.type === "RingGeometry") {
        sawRing = true;
        ringIsFidelity = !!o.userData.isFidelity;
      }
      if (o.isSprite && o.userData?.glowCacheKey != null) {
        sawGlow = true;
        glowIsFidelity = !!o.userData.isFidelity;
      }
    });
    expect(sawRing).toBe(true);
    expect(sawGlow).toBe(true);
    expect(ringIsFidelity).toBe(true);
    expect(glowIsFidelity).toBe(true);
  });

  it("the core is NOT tagged isFidelity — an urgent action item must never fully disappear", () => {
    let sawCore = false;
    let coreIsFidelity = false;
    makeNodeObject(actionNode()).traverse((o: any) => {
      if (o.isMesh && o.geometry?.type === "OctahedronGeometry") {
        sawCore = true;
        coreIsFidelity = !!o.userData.isFidelity;
      }
    });
    expect(sawCore).toBe(true);
    expect(coreIsFidelity).toBe(false);
  });
});

/**
 * Performance Program Stage 7: labelTexCache/glowTexCache never evicted anything —
 * one canvas texture per unique label string (or glow color+size) forever, real VRAM
 * that only ever grew. Fixed with reference counting rather than a blind size-capped
 * LRU (which risks disposing a texture a still-live sprite's material.map is actively
 * pointing at) — these tests pin that a shared texture is reused across sprites with
 * the same cache key, and only actually disposed once EVERY referencing sprite has
 * been released, never before.
 */
function findLabelSprite(obj: THREE.Object3D): THREE.Sprite {
  let found: THREE.Sprite | undefined;
  obj.traverse((o: any) => {
    if (o.isSprite && o.userData?.labelCacheKey != null && !found) found = o;
  });
  if (!found) throw new Error("no label sprite found");
  return found;
}

describe("nodeObject — Stage 7 label/glow texture refcounting", () => {
  it("two sprites built with the same label text share ONE texture instance", () => {
    const label = `shared-label-${Math.random()}`;
    const a = findLabelSprite(makeNodeObject(node("star", { label, id: 301 })));
    const b = findLabelSprite(makeNodeObject(node("star", { label, id: 302 })));
    expect((a.material as THREE.SpriteMaterial).map).toBe((b.material as THREE.SpriteMaterial).map);
  });

  it("a shared label texture is only disposed once every referencing sprite is released", () => {
    const label = `release-label-${Math.random()}`;
    const a = makeNodeObject(node("star", { label, id: 401 }));
    const b = makeNodeObject(node("star", { label, id: 402 }));
    const map = (findLabelSprite(a).material as THREE.SpriteMaterial).map as THREE.Texture;
    const disposeSpy = vi.spyOn(map, "dispose");

    releaseNodeTextures(a);
    expect(disposeSpy).not.toHaveBeenCalled(); // b's sprite still references the same cache entry

    releaseNodeTextures(b);
    expect(disposeSpy).toHaveBeenCalledTimes(1); // nothing left referencing it
  });

  it("releasing a node whose label text is unique to it disposes immediately", () => {
    const label = `solo-label-${Math.random()}`;
    const obj = makeNodeObject(node("star", { label, id: 501 }));
    const map = (findLabelSprite(obj).material as THREE.SpriteMaterial).map as THREE.Texture;
    const disposeSpy = vi.spyOn(map, "dispose");

    releaseNodeTextures(obj);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("releasing a node with no tagged children (or twice) is a safe no-op", () => {
    const g = new THREE.Group(); // nothing tagged
    expect(() => releaseNodeTextures(g)).not.toThrow();

    const label = `double-release-${Math.random()}`;
    const obj = makeNodeObject(node("planet", { label, id: 601 }));
    releaseNodeTextures(obj);
    expect(() => releaseNodeTextures(obj)).not.toThrow(); // refcount floor, no negative underflow
  });
});

/**
 * Fix #1 (per-node rendering cost): getGeometry's cache key used to include the node's
 * own continuous, mass-derived `size` float directly — since `size` essentially never
 * repeats bit-for-bit between two different nodes, the "cache" almost never actually hit
 * in practice, so every node still allocated its own fresh geometry despite going through
 * a function that looks like it shares them. Fixed by always requesting the CANONICAL
 * unit geometry (radius/size = 1) and applying the real per-node size via
 * `mesh.scale.setScalar(size)` instead. These tests prove (a) the cache now actually
 * hits — different-size nodes of the same class/segment-config share one geometry
 * instance — and (b) uniform scaling is mathematically identical to baking the radius
 * into the geometry directly, not just visually close.
 */
function findFullDetailMesh(obj: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  obj.traverse((o: any) => {
    if (o.isMesh && o.userData?.isFidelity && o.geometry?.type === "SphereGeometry") found = o;
  });
  if (!found) throw new Error("no full-detail mesh found");
  return found;
}

function findMacroMesh(obj: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  obj.traverse((o: any) => {
    if (o.isMesh && o.userData?.isMacro) found = o;
  });
  if (!found) throw new Error("no macro mesh found");
  return found;
}

describe("nodeObject — Fix #1: geometry sharing via canonical-unit + scale", () => {
  it("two stars of very different mass (different size) share the SAME full-detail geometry instance", () => {
    const dim = findFullDetailMesh(makeNodeObject(node("star", { id: 701, importance: 0.05, degree: 0 })));
    const bright = findFullDetailMesh(makeNodeObject(node("star", { id: 702, importance: 0.95, degree: 12 })));
    expect(dim.geometry).toBe(bright.geometry); // the cache now actually hits
    expect((dim.geometry as THREE.SphereGeometry).parameters.radius).toBe(1); // canonical unit, not a baked-in size
  });

  it("per-node size is still expressed — via mesh.scale, uniformly on all 3 axes", () => {
    const dim = findFullDetailMesh(makeNodeObject(node("star", { id: 703, importance: 0.05, degree: 0 })));
    const bright = findFullDetailMesh(makeNodeObject(node("star", { id: 704, importance: 0.95, degree: 12 })));
    expect(dim.scale.x).toBeGreaterThan(0);
    expect(dim.scale.x).toBe(dim.scale.y);
    expect(dim.scale.y).toBe(dim.scale.z);
    expect(bright.scale.x).toBeGreaterThan(dim.scale.x); // higher mass -> bigger effective size
  });

  it("the macro-LOD sibling also shares one canonical geometry across different-size nodes", () => {
    const a = findMacroMesh(makeNodeObject(node("planet", { id: 705, importance: 0.05, degree: 0 })));
    const b = findMacroMesh(makeNodeObject(node("planet", { id: 706, importance: 0.95, degree: 12 })));
    expect(a.geometry).toBe(b.geometry);
    expect((a.geometry as THREE.SphereGeometry).parameters.radius).toBe(1);
    expect(b.scale.x).toBeGreaterThan(a.scale.x);
  });

  it("a ringed gas giant's ring geometry is canonical (inner 1.6/outer 2.4) and shared across different-mass rings, scaled via mesh.scale", () => {
    function ringId(start: number): number {
      let id = start;
      while (((id * 2654435761) >>> 0) % 5 !== 0) id++;
      return id;
    }
    function findRing(obj: THREE.Object3D): THREE.Mesh {
      let found: THREE.Mesh | undefined;
      obj.traverse((o: any) => {
        if (o.isMesh && o.geometry?.type === "RingGeometry") found = o;
      });
      if (!found) throw new Error("no ring found");
      return found;
    }
    const a = findRing(makeNodeObject(node("gas_giant", { id: ringId(801), importance: 0.05, degree: 0 })));
    const b = findRing(makeNodeObject(node("gas_giant", { id: ringId(900), importance: 0.95, degree: 12 })));
    expect(a.geometry).toBe(b.geometry);
    const params = (a.geometry as THREE.RingGeometry).parameters;
    expect(params.innerRadius).toBe(1.6);
    expect(params.outerRadius).toBe(2.4);
    expect(b.scale.x).toBeGreaterThan(a.scale.x);
  });

  it("mathematical proof: scaling a canonical unit sphere reproduces IDENTICAL vertex positions and normals to constructing the sphere at that radius directly", () => {
    const radius = 4.7;
    const direct = new THREE.SphereGeometry(radius, 24, 16);
    const scaled = new THREE.SphereGeometry(1, 24, 16);
    scaled.scale(radius, radius, radius); // BufferGeometry.scale bakes a uniform transform into the attributes directly

    const directPos = direct.attributes.position!.array;
    const scaledPos = scaled.attributes.position!.array;
    expect(scaledPos.length).toBe(directPos.length);
    for (let i = 0; i < directPos.length; i++) expect(scaledPos[i]!).toBeCloseTo(directPos[i]!, 5);

    const directNormal = direct.attributes.normal!.array;
    const scaledNormal = scaled.attributes.normal!.array;
    for (let i = 0; i < directNormal.length; i++) expect(scaledNormal[i]!).toBeCloseTo(directNormal[i]!, 5);
  });

  it("mathematical proof: the same holds for a flat RingGeometry (no Z-extent, so a uniform scale reproduces the exact inner/outer radii)", () => {
    const size = 3.3;
    const direct = new THREE.RingGeometry(size * 1.6, size * 2.4, 48);
    const scaled = new THREE.RingGeometry(1.6, 2.4, 48);
    scaled.scale(size, size, size);

    const directPos = direct.attributes.position!.array;
    const scaledPos = scaled.attributes.position!.array;
    expect(scaledPos.length).toBe(directPos.length);
    for (let i = 0; i < directPos.length; i++) expect(scaledPos[i]!).toBeCloseTo(directPos[i]!, 5);
  });
});

/**
 * Performance Program Round 3 (memory scaling audit): nodeThreeObjCacheRef's cache key
 * used to include raw `entropy` — a continuously-drifting float — so it invalidated on
 * almost every `refresh()` even when nothing visually meaningful changed. Fixed by
 * bucketing entropy (see `bucketEntropy`/`nodeVisualCacheKey` in nodeObject.ts) instead of
 * dropping it outright, since entropy DOES affect the constructed object's color tint and
 * pulse vitality. These tests pin the two halves of that trade-off directly against the
 * exported key function, with no THREE/canvas machinery involved.
 */
describe("nodeObject — Round 3 node-object cache key (entropy bucketing)", () => {
  function baseNode(over: Partial<GraphNode> = {}): GraphNode {
    return {
      id: 1,
      label: "Ping the dentist",
      type: "memory" as any,
      content: "",
      createdAt: new Date().toISOString(),
      celestial: "planet",
      importance: 0.5,
      degree: 2,
      kind: undefined,
      color: "#88aaff",
      entropy: 0,
      ...over,
    } as GraphNode;
  }

  it("Test A — a small, insignificant entropy drift (same bucket) reuses cache identity", () => {
    const a = nodeVisualCacheKey(baseNode({ entropy: 0.4 }));
    const b = nodeVisualCacheKey(baseNode({ entropy: 0.42 })); // a typical refresh-to-refresh drift is ~0.002; this is generous and still same-bucket
    expect(a).toBe(b);
  });

  it("Test A — undefined/null entropy and exact-zero entropy also collapse together", () => {
    const a = nodeVisualCacheKey(baseNode({ entropy: undefined }));
    const b = nodeVisualCacheKey(baseNode({ entropy: 0 }));
    expect(a).toBe(b);
  });

  it("Test B — a materially different entropy (crossing several buckets) still invalidates the cache", () => {
    const cold = nodeVisualCacheKey(baseNode({ entropy: 0.9 }));
    const warm = nodeVisualCacheKey(baseNode({ entropy: 0.1 }));
    expect(cold).not.toBe(warm);
  });

  it("Test B — a memory being 'tended' (entropy resets to 0) is a real, distinct event", () => {
    const stale = nodeVisualCacheKey(baseNode({ entropy: 0.6 }));
    const tended = nodeVisualCacheKey(baseNode({ entropy: 0 }));
    expect(stale).not.toBe(tended);
  });

  it("Test B — every other construction-relevant field still fully distinguishes identity", () => {
    const base = baseNode();
    const key = nodeVisualCacheKey(base);
    expect(nodeVisualCacheKey(baseNode({ label: "Something else" }))).not.toBe(key);
    expect(nodeVisualCacheKey(baseNode({ importance: 0.9 }))).not.toBe(key);
    expect(nodeVisualCacheKey(baseNode({ degree: 7 }))).not.toBe(key);
    expect(nodeVisualCacheKey(baseNode({ color: "#ff0000" }))).not.toBe(key);
    expect(nodeVisualCacheKey(baseNode({ kind: "action" as any }))).not.toBe(key);
  });

  it("Test B — entropy is clamped to [0,1] before bucketing (out-of-range input can't collapse into the wrong bucket)", () => {
    expect(nodeVisualCacheKey(baseNode({ entropy: -5 }))).toBe(nodeVisualCacheKey(baseNode({ entropy: 0 })));
    expect(nodeVisualCacheKey(baseNode({ entropy: 5 }))).toBe(nodeVisualCacheKey(baseNode({ entropy: 1 })));
  });
});

import { wrapLabelLines } from "./nodeObject.js";

describe("wrapLabelLines (UX review #5 — no mid-word marquee slices)", () => {
  const measure = (s: string) => s.length * 10; // 10px per char
  it("keeps a short label on one line", () => {
    expect(wrapLabelLines("The first light", 400, measure)).toEqual(["The first light"]);
  });
  it("wraps a long label at word boundaries, never mid-word, first letter intact", () => {
    const lines = wrapLabelLines("I want to learn guitar this year and practice", 200, measure);
    expect(lines.length).toBe(2);
    expect(lines[0]!.startsWith("I want")).toBe(true);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(200);
    expect(lines[1]!.endsWith("…")).toBe(true);
    // Every word that is shown is a whole word from the source.
    const src = new Set("I want to learn guitar this year and practice".split(" "));
    for (const w of lines.join(" ").replace("…", "").split(" ")) expect(src.has(w)).toBe(true);
  });
  it("ellipsizes a single over-long word instead of overflowing", () => {
    const [only] = wrapLabelLines("Supercalifragilisticexpialidocious", 100, measure);
    expect(measure(only!)).toBeLessThanOrEqual(100);
    expect(only!.endsWith("…")).toBe(true);
  });
});
