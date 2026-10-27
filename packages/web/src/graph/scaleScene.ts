import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import { buildSurveyFrame } from "./gateScene.js";
import { SCALE_PALETTE, SCALE_ISS_ASSET, SCALE_PROBE_ASSETS } from "./scaleAssets.js";
import {
  SCALE_ISS_SCALE,
  SCALE_ORBIT,
  SCALE_SUN_DIRECTION,
  type ScaleLayout,
} from "./scaleLayout.js";

/**
 * Scale scene (Phase 3, Scale world) — renders exactly what scaleLayout
 * returns, nothing more. The host owns the renderer, camera, and fog
 * (true black, no fog in this world, per the settled stack); this module
 * owns the scene group and its per-frame motion.
 *
 * The recipe's grammar: the actual station, actual size. The real ISS at
 * its real size against true black and true stars, with real probes as
 * small true things at real distances, a docked capsule and your ship as
 * witnesses of known size, and the survey frame — the gate that measures —
 * holding the approach. Baked glow only — no bloom, no post-processing.
 * The camera arrives far and closes in stages (the surface owns the
 * orbit; the scene owns the approach vista).
 *
 * Draw-call sketch (recipe ceiling 90): ISS ≤6 (one mesh, six material
 * groups) · probes ≤27 (7 + 11 + 8 + 1 meshes, one material each) ·
 * asteroids 1 · HYG sky 1 · survey frame 2 · capsule 1 · fallback truss
 * 3 (only until the real ISS loads) = ≤41. Runtime measurement belongs
 * to the device check; these constants are the static half.
 *
 * Honesty about the loads (design note C6, the Profondo pattern):
 * - The ISS GLB has NOT landed yet (browser upload, owner's step). The
 *   scene renders a wireframe truss immediately — the station's shape at
 *   its real size — and swaps the real model in when it loads. A failed
 *   load keeps the truss and registers `ISS-A.glb` as a model fallback
 *   (Settings → diagnostics says so). The truss is a diagnosed fallback,
 *   never presented as the real station.
 * - A probe whose GLB has not landed is simply absent — no stand-in —
 *   and its failure is registered the same way. The world never invents
 *   a probe.
 *
 * Kindness is structural here: the scene has no state for decline. Scale
 * carries no memories and no scores; it is a place to stand beside
 * something real and feel how big it is. Reduced motion holds the space:
 * no probe drift, no frame pulse.
 *
 * Relic hooks (relics increment, worlds/relics-codex — NOT on this tip):
 * this builder accepts the registry's `onRelicVisible` callback, in the
 * same shape as the Station, garden, and Deep Past builders in that
 * increment. When the relics increment rebases onto this tip it adds one
 * line here — `placeWorldRelics(group, "scale", opts.onRelicVisible)` —
 * and the three SCALE_RELIC_ANCHORS entries to its RELIC_ANCHORS. Until
 * then the callback is held unused: no relic GLB is loaded, no find is
 * offered, nothing glimmers unexplained. This module duplicates nothing
 * from the registry.
 */

export interface ScaleScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

/** The empty layout, for the surface's loading state (the world builds nothing until the layout exists). */
export const EMPTY_SCALE_LAYOUT: ScaleLayout = {
  iss: { x: 0, y: 0, z: 0, scale: SCALE_ISS_SCALE, trussSpan: 109 },
  probes: [],
  asteroids: [],
  surveyFrame: { position: [0, 0, 320], width: 130, height: 50 },
  capsule: { position: [64, 0, 10], length: 8 },
  relicAnchors: {},
};

/**
 * Load one model through the app's shared glTF loader. Resolves to the
 * loaded scene, or null when the load fails — the caller keeps the world
 * without it and the failure is registered for the diagnostics note.
 */
function loadModel(url: string, fallbackName: string): Promise<THREE.Object3D | null> {
  return new Promise((resolve) => {
    gltfLoader().load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => {
        noteModelFallback(fallbackName);
        resolve(null);
      },
    );
  });
}

/** Scale a loaded model so its longest side is `size`, recentered on its bounding-box center. */
function fitToSize(root: THREE.Object3D, size: number): void {
  const box = new THREE.Box3().setFromObject(root);
  const extents = box.getSize(new THREE.Vector3());
  const longest = Math.max(extents.x, extents.y, extents.z);
  if (!Number.isFinite(longest) || longest <= 0) return;
  const scale = size / longest;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
  const scaled = new THREE.Box3().setFromObject(root);
  const center = scaled.getCenter(new THREE.Vector3());
  root.position.sub(center);
}

/** The ISS fallback: a wireframe truss at the station's real size — a diagnosed stand-in, never the real station. */
function buildIssFallbackTruss(): THREE.Group {
  const truss = new THREE.Group();
  truss.name = "iss-fallback";
  const frame = new THREE.MeshBasicMaterial({ color: SCALE_PALETTE.solarGold, wireframe: true });
  const trussBar = new THREE.Mesh(new THREE.BoxGeometry(109, 2, 2), frame);
  trussBar.name = "iss-fallback-truss";
  truss.add(trussBar);
  const crossBar = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 2), frame);
  crossBar.name = "iss-fallback-cross";
  truss.add(crossBar);
  const panelMat = new THREE.MeshBasicMaterial({
    color: SCALE_PALETTE.solarGold,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
  });
  for (const x of [-40, 40]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 12), panelMat);
    panel.position.set(x, 0, 0);
    panel.name = "iss-fallback-panel";
    truss.add(panel);
  }
  return truss;
}

export function createScaleScene(
  layout: ScaleLayout,
  opts: { onRelicVisible?: (slug: string) => void } = {},
): ScaleScene {
  // The relic hook is accepted here for the relics increment's rebase
  // (see module header). It is intentionally unused on this tip: the
  // registry does not exist here yet, and a relic with no codex behind
  // it would glimmer unexplained. Referenced so the parameter is not
  // dead code in the reader's eyes — the wiring point is this line.
  void opts.onRelicVisible;
  const group = new THREE.Group();
  group.name = "scale";
  let disposed = false;

  // The station: a wireframe truss at real size until the real ISS loads
  // (the Profondo pattern — proxy now, real model on load, fallback
  // registered if the load fails).
  const issHolder = new THREE.Group();
  issHolder.name = "iss-holder";
  issHolder.position.set(layout.iss.x, layout.iss.y, layout.iss.z);
  group.add(issHolder);
  const fallback = buildIssFallbackTruss();
  issHolder.add(fallback);
  void loadModel(SCALE_ISS_ASSET.url, "ISS-A.glb").then((loaded) => {
    if (!loaded) return; // fallback stays; the failure is registered.
    if (disposed) {
      disposeObject3D(loaded);
      return;
    }
    fitToSize(loaded, layout.iss.trussSpan);
    loaded.name = "iss";
    issHolder.remove(fallback);
    disposeObject3D(fallback);
    issHolder.add(loaded);
  });

  // The probes: real models, each scaled to its layout size and
  // recentered. A missing probe is absent — never a stand-in.
  interface ProbeDrift {
    holder: THREE.Group;
    anchor: readonly [number, number, number];
    drift: readonly [number, number, number];
    phase: number;
  }
  const drifts: ProbeDrift[] = [];
  for (const probe of layout.probes) {
    const asset = SCALE_PROBE_ASSETS.find((a) => a.slug === probe.slug);
    if (!asset) continue;
    const holder = new THREE.Group();
    holder.name = `probe-${probe.slug}`;
    holder.position.set(probe.x, probe.y, probe.z);
    group.add(holder);
    drifts.push({
      holder,
      anchor: [probe.x, probe.y, probe.z],
      drift: probe.drift,
      phase: probe.x * 0.001,
    });
    void loadModel(asset.url, asset.url.split("/").pop() ?? asset.url).then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      fitToSize(loaded, probe.size);
      loaded.name = `probe-model-${probe.slug}`;
      holder.add(loaded);
    });
  }

  // Named asteroids: one draw call, dim grey rock — small true things
  // in a vast dark. Positions are seed-placed (layout), names are real.
  if (layout.asteroids.length > 0) {
    const positions = new Float32Array(layout.asteroids.length * 3);
    layout.asteroids.forEach((a, i) => {
      positions[i * 3] = a.x;
      positions[i * 3 + 1] = a.y;
      positions[i * 3 + 2] = a.z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const asteroids = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 3, color: SCALE_PALETTE.asteroid, sizeAttenuation: true }),
    );
    asteroids.name = "named-asteroids";
    group.add(asteroids);
  }

  // The true sky: the same real HYG data as the Station's, at full
  // strength — the sky is this world's subject.
  const stars = buildHygStarfield();
  group.add(stars);

  // The survey frame: Scale's gate silhouette — a clean rectangular
  // measurement frame of thin light, held against the dark on the
  // approach axis.
  const frame = buildSurveyFrame();
  frame.group.position.set(
    layout.surveyFrame.position[0],
    layout.surveyFrame.position[1],
    layout.surveyFrame.position[2],
  );
  group.add(frame.group);

  // The docked capsule: a witness of known size at the truss's end.
  // A plain capsule — a generic shape whose purpose is scale reference,
  // not a stand-in for a missing real model.
  const capsuleRadius = 1.6;
  const capsuleLength = Math.max(0.1, layout.capsule.length - capsuleRadius * 2);
  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(capsuleRadius, capsuleLength, 4, 8),
    new THREE.MeshStandardMaterial({ color: SCALE_PALETTE.capsule, roughness: 0.4, metalness: 0.6 }),
  );
  capsule.rotation.z = Math.PI / 2; // lie along the truss, nose outward
  capsule.position.set(layout.capsule.position[0], layout.capsule.position[1], layout.capsule.position[2]);
  capsule.name = "docked-capsule";
  group.add(capsule);

  // One key light — the real sun, cool white, from the sunward side —
  // plus a low ambient so the dark side of the station still reads.
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
  sun.position.set(
    SCALE_SUN_DIRECTION[0] * 1000,
    SCALE_SUN_DIRECTION[1] * 1000,
    SCALE_SUN_DIRECTION[2] * 1000,
  );
  group.add(sun);
  group.add(new THREE.AmbientLight(0x404050, 0.6));

  return {
    group,
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed || opts?.reducedMotion) return;
      // Probes drift slowly on their true vectors — a gentle oscillation
      // around their anchor, so they never leave their station.
      for (const d of drifts) {
        const sway = Math.sin(elapsedMs * 0.00002 + d.phase) * 20;
        d.holder.position.set(
          d.anchor[0] + d.drift[0] * sway,
          d.anchor[1] + d.drift[1] * sway,
          d.anchor[2] + d.drift[2] * sway,
        );
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      frame.dispose();
      disposeObject3D(group);
    },
  };
}

/** The orbit the surface holds for Scale (re-exported for the surface entry). */
export const SCALE_SURFACE_ORBIT = SCALE_ORBIT;
