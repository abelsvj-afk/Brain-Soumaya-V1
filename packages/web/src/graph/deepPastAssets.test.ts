import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  buildDeepPastLayout,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_BUDGET,
  DEEP_PAST_STRATUM_RADIUS,
  DEEP_PAST_STRATUM_Y,
} from "./deepPastLayout.js";
import { createDeepPastScene } from "./deepPastScene.js";
import {
  DEEP_PAST_ASSET_URLS,
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_BASIN_SPAN,
  DEEP_PAST_BEAD,
  DEEP_PAST_BEAD_MAX_STOPS,
  DEEP_PAST_CRYSTAL,
  DEEP_PAST_CRYSTALS,
  DEEP_PAST_GLB_DRAW_CALLS,
  DEEP_PAST_GLB_POINTS_TOTAL,
  DEEP_PAST_GLB_TRIS_TOTAL,
  DEEP_PAST_LANTERN,
  DEEP_PAST_MODELS,
  DEEP_PAST_ORB,
  DEEP_PAST_RIM,
  DEEP_PAST_SPIRE,
  DEEP_PAST_SUPERNOVA,
  DEEP_PAST_TERRACE,
  deepPastDressingLanterns,
  deepPastStairFlights,
  deepPastTerraceSlices,
  fitDeepPastAsset,
  fitDeepPastAssetToHeight,
  fitDeepPastAssetToSize,
  fitDeepPastAssetToSpan,
  instantiateDeepPastRoot,
  loadDeepPastAsset,
} from "./deepPastAssets.js";
import type { GraphData } from "@brain/shared";

const NOW = new Date("2026-10-25T12:00:00");

/** Draw calls: every object that draws (meshes, instanced meshes, points, lines, sprites). */
function countDrawCalls(group: THREE.Group): number {
  let calls = 0;
  group.traverse((o) => {
    const anyO = o as THREE.Mesh & THREE.InstancedMesh & THREE.Points & THREE.Line & THREE.Sprite;
    if (anyO.isMesh || anyO.isInstancedMesh || anyO.isPoints || anyO.isLine || anyO.isSprite) calls++;
  });
  return calls;
}

/** Triangle estimate: indexed geometry counts × instance count; sprites count 2 each. */
function estimateTris(group: THREE.Group): number {
  let tris = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) {
      const geo = mesh.geometry as THREE.BufferGeometry;
      const per = (geo.index ? geo.index.count : geo.getAttribute("position")!.count) / 3;
      const instances = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as unknown as THREE.InstancedMesh).count
        : 1;
      tris += per * instances;
    } else if ((o as THREE.Sprite).isSprite) {
      tris += 2;
    }
  });
  return Math.round(tris);
}

describe("deepPastAssets manifest", () => {
  it("is the shipped pieces, basin first, plus the crystal, the supernova, the spire, the orb, and the bead — all GLBs under public/", () => {
    expect(DEEP_PAST_MODELS.map((m) => m.key)).toEqual([
      "basin",
      "terrace",
      "rim",
      "stair",
      "lantern",
      "crystal",
      "supernova",
      "spire",
      "orb",
      "bead",
    ]);
    expect(new Set(DEEP_PAST_MODELS.map((m) => m.key)).size).toBe(10);
    expect(DEEP_PAST_MODELS.every((m) => m.url.startsWith("/") && m.url.endsWith(".glb"))).toBe(true);
    expect(new Set(DEEP_PAST_ASSET_URLS).size).toBe(10);
    expect(DEEP_PAST_ASSET_URLS).toEqual(DEEP_PAST_MODELS.map((m) => m.url));
  });

  it("carries the measured triangle counts and counts every instance, the crystal's two materials, the supernova's 34 meshes, the bead's per-stop clones, and the four extra calls honestly", () => {
    // The 2026-10-29 re-slim measurements: terrace 5,198 / stair 8,000 /
    // lantern 4,400 (simplified from the masters), orb 24,576, bead
    // 1,597; basin / rim / crystal / supernova / spire unchanged.
    expect(DEEP_PAST_MODELS.map((m) => m.tris)).toEqual([22500, 5198, 14200, 8000, 4400, 52, 0, 80210, 24576, 1597]);
    expect(DEEP_PAST_MODELS.map((m) => m.instances ?? 1)).toEqual([1, 24, 1, 9, 25, 3, 1, 1, 1, 12]);
    // Triangles count every placed instance: 22,500 + 5,198×24 +
    // 14,200 + 8,000×9 + 4,400×25 + 52×3 + 0 + 80,210 + 24,576 +
    // 1,597×12 = 467,558.
    expect(DEEP_PAST_GLB_TRIS_TOTAL).toBe(467558);
    // Draw calls do NOT multiply by instance (one InstancedMesh per
    // material) — except the bead, which is cloned per stop: its
    // override carries 2 calls × the 12 budgeted stops. The sum is 67,
    // plus 4 the sum cannot see (the hero lantern's second load, its
    // glow sprite, the dressing glows points cloud, the spire's glow
    // sprite) = 71.
    expect(DEEP_PAST_MODELS.map((m) => m.materials)).toEqual([1, 1, 1, 1, 1, 2, 1, 1, 1, 2]);
    expect(DEEP_PAST_MODELS.map((m) => m.drawCalls ?? m.materials)).toEqual([1, 1, 1, 1, 1, 2, 34, 1, 1, 24]);
    expect(DEEP_PAST_GLB_DRAW_CALLS).toBe(71);
    // The supernova is a point cloud, not a mesh: 0 triangles, 216,902
    // points in the slim (10% of the source's 2,168,851).
    expect(DEEP_PAST_MODELS.map((m) => m.points ?? 0)).toEqual([0, 0, 0, 0, 0, 0, 216902, 0, 0, 0]);
    expect(DEEP_PAST_GLB_POINTS_TOTAL).toBe(216902);
    expect(DEEP_PAST_GLB_POINTS_TOTAL).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxPoints);
  });

  it("places the pieces at the mockup's verified placements, ×5", () => {
    // Basin: spans the basin's full width, group 75 below the basin line.
    expect(DEEP_PAST_BASIN_SPAN).toBe(640);
    expect(DEEP_PAST_BASIN_GLB_Y).toBe(-905);
    // Terrace: stratum 1, angle 0.85 + 0.35, radius 360, y −38.5, size 285.
    expect(DEEP_PAST_TERRACE.angle).toBeCloseTo(1.2, 10);
    expect(DEEP_PAST_TERRACE.radius).toBe(360);
    expect(DEEP_PAST_TERRACE.y).toBe(-38.5);
    expect(DEEP_PAST_TERRACE.size).toBe(285);
    // Rim: span 880 (2 × the rim radius 440), y −45.
    expect(DEEP_PAST_RIM.span).toBe(880);
    expect(DEEP_PAST_RIM.y).toBe(-45);
    // Lantern: stratum 3, angle 3·0.85 + 0.62·4.4, radius 322.5, y −213.5, size 100.
    expect(DEEP_PAST_LANTERN.angle).toBeCloseTo(5.278, 10);
    expect(DEEP_PAST_LANTERN.radius).toBe(322.5);
    expect(DEEP_PAST_LANTERN.y).toBe(-213.5);
    expect(DEEP_PAST_LANTERN.size).toBe(100);
    // Crystal: stratum 5, on the stratum's arc at the alcove radius, 8
    // above the stratum floor, 30 tall — a crystal, not a monument.
    expect(DEEP_PAST_CRYSTAL.stratum).toBe(5);
    expect(DEEP_PAST_CRYSTAL.angle).toBeCloseTo(5 * 0.85 + 0.9, 10);
    expect(DEEP_PAST_CRYSTAL.radius).toBe(352.5 - 15);
    expect(DEEP_PAST_CRYSTAL.y).toBe(-450 + 8);
    expect(DEEP_PAST_CRYSTAL.size).toBe(30);
    // Supernova: stratum 7, on the stratum's arc at the alcove radius,
    // 20 above the stratum floor, 100 across — a shell of ancient
    // light, the oldest thing in the descent.
    expect(DEEP_PAST_SUPERNOVA.stratum).toBe(7);
    expect(DEEP_PAST_SUPERNOVA.angle).toBeCloseTo(7 * 0.85 + 1.4, 10);
    expect(DEEP_PAST_SUPERNOVA.radius).toBe(317.5 - 40);
    expect(DEEP_PAST_SUPERNOVA.y).toBe(-630 + 20);
    expect(DEEP_PAST_SUPERNOVA.size).toBe(100);
    // Spire: stratum 1, opposite the terrace across the descent, on the
    // terrace's ring, its base on the stratum-1 floor and its tip above
    // the rim plane — the nail that pins the top of the descent.
    expect(DEEP_PAST_SPIRE.stratum).toBe(1);
    expect(DEEP_PAST_SPIRE.angle).toBeCloseTo(1.2 + Math.PI, 10);
    expect(DEEP_PAST_SPIRE.radius).toBe(360);
    expect(DEEP_PAST_SPIRE.y).toBe(-90 + 60);
    expect(DEEP_PAST_SPIRE.size).toBe(120);
    // Orb: the basin center, just above the hollow, at the interim basin
    // light's position — the light stays as the light source and the glow
    // sprite is its halo. 80 across, the heart inside the 190-wide glow.
    expect(DEEP_PAST_ORB.y).toBe(-830 + 24);
    expect(DEEP_PAST_ORB.size).toBe(80);
    // Bead: spans 10 once placed, centre 10 above its stop; routes are
    // budgeted up to 12 stops.
    expect(DEEP_PAST_BEAD.size).toBe(10);
    expect(DEEP_PAST_BEAD.floatAbove).toBe(10);
    expect(DEEP_PAST_BEAD_MAX_STOPS).toBe(12);
  });

  it("dresses every stratum: three terrace slices and three lanterns on each of strata 1–8, stratum 0 bare", () => {
    const slices = deepPastTerraceSlices();
    expect(slices.length).toBe(24);
    // Slice 1 of stratum 1 IS the original single placement, generalised.
    expect(slices[0]!.stratum).toBe(1);
    expect(slices[0]!.angle).toBeCloseTo(DEEP_PAST_TERRACE.angle, 10);
    expect(slices[0]!.radius).toBe(DEEP_PAST_TERRACE.radius);
    expect(slices[0]!.y).toBe(DEEP_PAST_TERRACE.y);
    for (let i = 1; i <= 8; i++) {
      const onStratum = slices.filter((s) => s.stratum === i);
      expect(onStratum.length).toBe(3);
      for (const s of onStratum) {
        expect(s.radius).toBe(DEEP_PAST_STRATUM_RADIUS[i]! - 62.5);
        expect(s.y).toBe(DEEP_PAST_STRATUM_Y[i]! + 6.5 + 45);
      }
    }
    expect(slices.some((s) => s.stratum === 0)).toBe(false);

    const lanterns = deepPastDressingLanterns();
    expect(lanterns.length).toBe(24);
    for (let i = 1; i <= 8; i++) {
      expect(lanterns.filter((l) => l.stratum === i).length).toBe(3);
    }
    // Each lantern stands at the far end of its slice, ON the shelf:
    // the fit centres the slice on its placement angle, so the slice
    // spans half its fitted length to either side and the far end is
    // a half-length along the ring — not a full length (that would
    // put the lantern in the gap past the shelf).
    lanterns.forEach((l, idx) => {
      const slice = slices[idx]!;
      expect(l.stratum).toBe(slice.stratum);
      expect(l.radius).toBe(slice.radius);
      expect(l.angle).toBeCloseTo(slice.angle + DEEP_PAST_TERRACE.size / 2 / slice.radius, 10);
      // Within the slice's own angular span, past its centre.
      const offset = l.angle - slice.angle;
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThan(DEEP_PAST_TERRACE.size / slice.radius);
      expect(l.y).toBe(DEEP_PAST_STRATUM_Y[l.stratum]! + 6.5 + 50);
    });
  });

  it("the staircase is nine flights, floor to floor, the basin leg spanning the full −110 (D1/A2)", () => {
    const flights = deepPastStairFlights();
    expect(flights.length).toBe(9);
    flights.forEach((f, idx) => {
      const k = idx + 1;
      // Flight k hangs at angle k × the helix twist.
      expect(f.angle).toBeCloseTo(k * 0.85, 10);
      if (k <= 8) {
        expect(f.drop).toBe(90);
        // Top step on the upper floor, bottom step on the receiving
        // floor: the flight's centre ± half its drop IS the two floors.
        expect(f.y + f.drop / 2).toBe(DEEP_PAST_STRATUM_Y[k - 1]);
        expect(f.y - f.drop / 2).toBe(DEEP_PAST_STRATUM_Y[k]);
        expect(f.radius).toBe((DEEP_PAST_STRATUM_RADIUS[k - 1]! + DEEP_PAST_STRATUM_RADIUS[k]!) / 2);
      }
    });
    // The basin leg: stratum 8's floor to the basin floor, at its own scale.
    const basinLeg = flights[8]!;
    expect(basinLeg.drop).toBe(110);
    expect(basinLeg.y + basinLeg.drop / 2).toBe(DEEP_PAST_STRATUM_Y[8]);
    expect(basinLeg.y - basinLeg.drop / 2).toBe(DEEP_PAST_BASIN_Y);
    expect(basinLeg.radius).toBe((DEEP_PAST_STRATUM_RADIUS[8]! + 320) / 2);
  });

  it("carries exactly three crystals, on strata 5, 6, and 7", () => {
    expect(DEEP_PAST_CRYSTALS.map((c) => c.stratum)).toEqual([5, 6, 7]);
    expect(DEEP_PAST_CRYSTALS.map((c) => c.size)).toEqual([30, 24, 36]);
    for (const c of DEEP_PAST_CRYSTALS) {
      expect(c.radius).toBe(DEEP_PAST_STRATUM_RADIUS[c.stratum]! - 15);
      expect(c.y).toBe(DEEP_PAST_STRATUM_Y[c.stratum]! + 8);
    }
  });
});

describe("loadDeepPastAsset", () => {
  it("a load that cannot even start resolves null and notes the fallback — never throws", async () => {
    // In tests there is no page to resolve the URL against, so three's
    // loader throws synchronously; the loader must degrade, not crash.
    await expect(loadDeepPastAsset(DEEP_PAST_MODELS[0]!.url)).resolves.toBeNull();
  });
});

describe("fitDeepPastAsset", () => {
  it("centres a root on the origin and scales it uniformly", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    mesh.position.set(10, 20, 30);
    const root = new THREE.Group();
    root.add(mesh);
    expect(fitDeepPastAsset(root, 5)).toBe(5);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(10, 5);
    expect(size.y).toBeCloseTo(20, 5);
    expect(size.z).toBeCloseTo(30, 5);
  });

  it("spans a root to a target width whatever it measures", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.17, 0.3, 1.17),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    const root = new THREE.Group();
    root.add(mesh);
    // The basin file measures 1.17 wide in-scene; the app's basin spans 640.
    // (Precision 2: the 1.17 is a float32 measurement, not an exact decimal.)
    const scale = fitDeepPastAssetToSpan(root, 640);
    expect(scale).toBeCloseTo(640 / 1.17, 2);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(640, 2);
  });

  it("spans by the horizontal diameter — the larger horizontal extent, not a chosen axis", () => {
    // The rim file's shape: its diameter lies along z (0.758 × 1.000).
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.758, 0.259, 1.0),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    const root = new THREE.Group();
    root.add(mesh);
    const scale = fitDeepPastAssetToSpan(root, 880);
    expect(scale).toBeCloseTo(880, 5);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(880, 2);
  });

  it("fits a root to a target longest side whatever it measures", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    mesh.position.set(10, 20, 30);
    const root = new THREE.Group();
    root.add(mesh);
    expect(fitDeepPastAssetToSize(root, 30)).toBeCloseTo(5, 5);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(30, 5);
  });

  it("fits a root by height — a −90 stair flight lands at the D1 uniform scale from its measured height", () => {
    // The stair file measures 1.000 × 0.361 × 0.676 natively.
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.361, 0.676),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    const root = new THREE.Group();
    root.add(mesh);
    const scale = fitDeepPastAssetToHeight(root, 90);
    // 90 ÷ 0.361 ≈ 249.3 — the settlement's number, from the
    // measurement, not a literal.
    expect(scale).toBeCloseTo(90 / 0.361, 2);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(90, 2);
    // Uniform: the other axes scale by the same factor — never stretched.
    expect(size.x).toBeCloseTo(90 / 0.361, 2);
  });
});

describe("instantiateDeepPastRoot", () => {
  it("instances one mesh per source mesh at the placements, keeping the fitted root for disposal", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    mesh.name = "piece";
    const root = new THREE.Group();
    root.add(mesh);
    const group = instantiateDeepPastRoot(
      root,
      [
        { x: 10, y: -45, z: 0, rotationY: 0, scale: 285 },
        { x: -20, y: -135, z: 5, rotationY: 1.1, scale: 285 },
      ],
      "slices",
    );
    const instanced = group.children.filter(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh[];
    expect(instanced.length).toBe(1);
    expect(instanced[0]!.count).toBe(2);
    expect(instanced[0]!.name).toBe("slices:piece");
    expect(instanced[0]!.frustumCulled).toBe(false);
    const m = new THREE.Matrix4();
    instanced[0]!.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(10, 5);
    expect(pos.y).toBeCloseTo(-45, 5);
    // The fitted source root rides along invisible, so disposal frees
    // the shared geometry and material with the group.
    expect(root.visible).toBe(false);
    expect(group.children).toContain(root);
  });

  it("carries an offset child mesh with the placement — the composition the helix pieces rely on", () => {
    // A source mesh that does NOT sit at its root's origin: its world
    // matrix must ride under the placement, or every instance drifts
    // by the offset.
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    mesh.position.set(2, 3, 0);
    const root = new THREE.Group();
    root.add(mesh);
    const group = instantiateDeepPastRoot(
      root,
      [{ x: 10, y: 0, z: 0, rotationY: 0, scale: 1 }],
      "offset",
    );
    const instanced = group.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    instanced.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(12, 5); // placement 10 + the child's own offset 2
    expect(pos.y).toBeCloseTo(3, 5);
  });

  it("a fitted, instanced stair flight spans exactly its drop, floor to floor (A2, composed)", () => {
    // The whole chain, not its pieces: the stair file's measured shape
    // (1.000 × 0.361 × 0.676), fitted to height 1, instanced at flight
    // 1's placement with the drop as its scale. The instanced
    // geometry's vertical span must BE the drop, its top on the upper
    // floor and its bottom on the receiving floor.
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.361, 0.676),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    const root = new THREE.Group();
    root.add(mesh);
    fitDeepPastAssetToHeight(root, 1);
    const flight = deepPastStairFlights()[0]!; // stratum 0 → stratum 1
    expect(flight.drop).toBe(90);
    const group = instantiateDeepPastRoot(
      root,
      [{ x: 0, y: flight.y, z: 0, rotationY: 0, scale: flight.drop }],
      "flights",
    );
    const instanced = group.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    instanced.getMatrixAt(0, m);
    mesh.geometry.computeBoundingBox();
    const placed = mesh.geometry.boundingBox!.clone().applyMatrix4(m);
    expect(placed.max.y - placed.min.y).toBeCloseTo(flight.drop, 3);
    expect(placed.max.y).toBeCloseTo(DEEP_PAST_STRATUM_Y[0]!, 3);
    expect(placed.min.y).toBeCloseTo(DEEP_PAST_STRATUM_Y[1]!, 3);
  });

  it("a two-material piece instances as two meshes (the crystal's honest 2 calls)", () => {
    const root = new THREE.Group();
    for (const name of ["crystal_a", "crystal_b"]) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 2, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      mesh.name = name;
      root.add(mesh);
    }
    const group = instantiateDeepPastRoot(
      root,
      [{ x: 0, y: 0, z: 0, rotationY: 0, scale: 30 }],
      "crystals",
    );
    const instanced = group.children.filter(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh[];
    expect(instanced.length).toBe(2);
    expect(instanced.map((i) => i.name).sort()).toEqual(["crystals:crystal_a", "crystals:crystal_b"]);
  });
});

describe("deep past budget with the GLB layer loaded", () => {
  it("the recipe budget still holds for a large graph with the full GLB layer in", () => {
    const bigNodes = Array.from({ length: 2000 }, (_, i) => ({
      id: i + 1,
      label: `node ${i + 1}`,
      type: "memory",
      content: "",
      createdAt: "2020-01-01T00:00:00.000Z",
      kind: i < 1800 ? "memory" : i < 1950 ? "action" : "moc",
    }));
    const big = createDeepPastScene(
      buildDeepPastLayout({ nodes: bigNodes, links: [] } as never as GraphData, [], new Map(), NOW),
    );
    // The GLBs load async, so the built group holds the procedural
    // scene only; the manifest's measured cost is added here, so the
    // budget assertion covers the scene as the user actually sees it
    // once the pieces have landed.
    expect(countDrawCalls(big.group) + DEEP_PAST_GLB_DRAW_CALLS).toBeLessThanOrEqual(
      DEEP_PAST_BUDGET.maxDrawCalls,
    );
    expect(estimateTris(big.group) + DEEP_PAST_GLB_TRIS_TOTAL).toBeLessThanOrEqual(
      DEEP_PAST_BUDGET.maxTris,
    );
    // Points too, combined: the scene's own clouds (marine snow +
    // memory lanterns) plus the supernova's manifest points.
    let scenePoints = 0;
    big.group.traverse((o) => {
      if ((o as THREE.Points).isPoints) {
        scenePoints += ((o as THREE.Points).geometry.getAttribute("position") as THREE.BufferAttribute).count;
      }
    });
    expect(scenePoints + DEEP_PAST_GLB_POINTS_TOTAL).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxPoints);
    big.dispose();
  });
});
