import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import { buildSurveyFrame } from "./gateScene.js";
import { mergeByMaterial, mergeToSingleMaterial, recenterGeometry, scaleGeometryToSize } from "./stationAssets.js";
import {
  SCALE_BELT_ASSETS,
  SCALE_BELT_PIECE_ASSETS,
  SCALE_CENTERPIECE_ASSETS,
  SCALE_CLOUD_ASSET,
  SCALE_ENCOUNTER_ASSETS,
  SCALE_HUNT2_HUBBLE_ASSET,
  SCALE_HUNT2_PLANET_ASSETS,
  SCALE_ISS_ASSET,
  SCALE_MOON_ASSET,
  SCALE_MOON_OUTPOST_ASSETS,
  SCALE_NEBULA_PLANE_ASSETS,
  SCALE_PALETTE,
  SCALE_PLANET_ASSETS,
  SCALE_PROBE_ASSETS,
  SCALE_SATELLITE_ASSET,
  SCALE_SKETCHFAB_CENTERPIECE_ASSETS,
  SCALE_SKETCHFAB_PULSAR_ASSET,
} from "./scaleAssets.js";
import {
  SCALE_BELT_SIZES,
  SCALE_ISS_SCALE,
  SCALE_MOON_OUTPOST_OFFSETS,
  SCALE_MOON_OUTPOST_SIZES,
  SCALE_ORBIT,
  SCALE_SUN_DIRECTION,
  type ScaleEncounter,
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
 * Draw-call sketch (recipe ceiling 100, raised from 90 for the
 * Sketchfab long game — see scaleLayout.ts): ISS ≤6 (one mesh, six
 * material groups) · probes ≤27 (7 + 11 + 8 + 1 meshes, one material
 * each) · planets 23 (11 low-poly + 12 hunt-2, loaded as-is, colors
 * kept) · moon 2 · belts 3 (asteroid_big merged by material: 2;
 * asteroid_small: 1) · belt pieces 6 (strip, Bennu, big rock, toastie
 * as-is; debris pile and rubble merged) · centerpieces 12 (black hole
 * + G292 + Pillars + cloud merged or single-material: 4; the Sketchfab
 * Planetary Nebula and black hole kept as-is at 4 materials each: 8) ·
 * nebula planes 3 · encounters 7 (merged to one material each, except
 * the pulsar at 2, kept as-is so its glow survives) · debris satellite
 * 1 · moon outpost 3 (merged to one material each) · HYG sky 1 ·
 * survey frame 2 · capsule 1 · fallback truss 3 (only until the real
 * ISS loads) = ≤100. Runtime measurement belongs to the device check;
 * these constants are the static half. New tris ≈ 357,000 (planets
 * 10,106 + Hubble 684 + belt pieces 27,638 + centerpieces 305,304 —
 * black hole 1,572 + Pillars 24,576 + G292 122,304 + cloud 816 +
 * Planetary Nebula 146,636 + Sketchfab black hole 10,216 — + pulsar
 * 11,520 + planes 0) — total ≈ 450,000 vs the 500k ceiling. The
 * Dilley solar system was measured and left out (11 calls for 2,880
 * tris); the single Quaternius Star was measured and left out (its job
 * is the Sun's); CasA, Cygnus Loop, Pillars 2, the Jarlan system, the
 * Poly Pizza Moon and ISS were measured and left out too — see
 * scaleAssets.ts for why each one stays out.
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
  planets: [],
  moon: null,
  encounters: [],
  satellite: null,
  beltPieces: [],
  centerpieces: [],
  nebulaPlanes: [],
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

/**
 * Load one model WITH its animation clips (the Sketchfab centerpieces
 * carry their own clips — the first GLB clips this world has ever
 * played). Resolves null on failure, same as loadModel.
 */
function loadAnimatedModel(
  url: string,
  fallbackName: string,
): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
  return new Promise((resolve) => {
    gltfLoader().load(
      url,
      (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations ?? [] }),
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

/** Nebula colors for the two centerpieces that carry no color of their own. */
const NEBULA_COLORS: Record<string, number> = {
  "pillars-1b": 0xc97b5e, // rose-gold, the Pillars' published hue
  "gas-cloud": 0x9db8d9, // pale blue
};

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
  //
  // Slow drifters (probes, the moon, encounters, the debris satellite):
  // every drifting body sways gently around its anchor on its own
  // vector and amplitude, so it never leaves its station. Reduced
  // motion holds them all still.
  interface Drift {
    holder: THREE.Group;
    anchor: readonly [number, number, number];
    drift: readonly [number, number, number];
    phase: number;
    amplitude: number;
  }
  const drifts: Drift[] = [];
  const registerDrift = (
    holder: THREE.Group,
    anchor: readonly [number, number, number],
    drift: readonly [number, number, number],
    amplitude: number,
  ) => {
    drifts.push({ holder, anchor, drift, phase: anchor[0] * 0.001, amplitude });
  };
  for (const probe of layout.probes) {
    const asset = SCALE_PROBE_ASSETS.find((a) => a.slug === probe.slug);
    if (!asset) continue;
    const holder = new THREE.Group();
    holder.name = `probe-${probe.slug}`;
    holder.position.set(probe.x, probe.y, probe.z);
    group.add(holder);
    registerDrift(holder, [probe.x, probe.y, probe.z], probe.drift, 20);
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

  // Planets as floating bodies (population increment): loaded as-is,
  // colors kept — a planet's look IS its materials. A missing planet
  // is absent — never a stand-in.
  for (const planet of layout.planets) {
    const asset =
      SCALE_PLANET_ASSETS.find((a) => a.key === planet.key) ??
      SCALE_HUNT2_PLANET_ASSETS.find((a) => a.key === planet.key);
    if (!asset) continue;
    const holder = new THREE.Group();
    holder.name = `planet-${planet.key}`;
    holder.position.set(planet.x, planet.y, planet.z);
    group.add(holder);
    void loadModel(asset.url, asset.url.split("/").pop() ?? asset.url).then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      fitToSize(loaded, planet.size);
      loaded.name = `planet-model-${planet.key}`;
      holder.add(loaded);
    });
  }

  // The moon, with its outpost riding on it: the dome, rover, and flag
  // are children of the moon holder at offsets × the moon's scaled
  // radius, so they ride with the moon when it drifts. The moon loads
  // as-is (2 materials); the outpost merges to one material each.
  if (layout.moon) {
    const moon = layout.moon;
    const moonHolder = new THREE.Group();
    moonHolder.name = "moon";
    moonHolder.position.set(moon.x, moon.y, moon.z);
    group.add(moonHolder);
    registerDrift(moonHolder, [moon.x, moon.y, moon.z], moon.drift, 20);
    void loadModel(SCALE_MOON_ASSET.url, "moon_cratered.glb").then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      fitToSize(loaded, moon.size);
      loaded.name = "moon-model";
      moonHolder.add(loaded);
    });
    const moonRadius = moon.size / 2;
    const outpostAssetBySlot = {
      dome: "moon_base_dome",
      rover: "moon_rover",
      flag: "flag_pole",
    } as const;
    for (const slot of Object.keys(outpostAssetBySlot) as (keyof typeof outpostAssetBySlot)[]) {
      const offset = SCALE_MOON_OUTPOST_OFFSETS[slot];
      const holder = new THREE.Group();
      holder.name = `moon-outpost-${slot}`;
      holder.position.set(
        offset[0] * moonRadius,
        offset[1] * moonRadius,
        offset[2] * moonRadius,
      );
      moonHolder.add(holder);
      const asset = SCALE_MOON_OUTPOST_ASSETS.find(
        (a) => a.key === outpostAssetBySlot[slot],
      );
      if (!asset) continue;
      void loadModel(asset.url, asset.url.split("/").pop() ?? asset.url).then((loaded) => {
        if (!loaded) return;
        if (disposed) {
          disposeObject3D(loaded);
          return;
        }
        const merged = mergeToSingleMaterial(loaded, SCALE_PALETTE.visitor);
        if (!merged) return;
        fitToSize(merged, SCALE_MOON_OUTPOST_SIZES[slot]);
        merged.name = `moon-outpost-model-${slot}`;
        holder.add(merged);
      });
    }
  }

  // The asteroid belts (population increment): the named asteroids are
  // real bodies now, not points — instanced big/small rocks at the same
  // 60 seed positions (even index big, odd index small). The points
  // layer is gone; a belt that cannot load leaves its positions empty
  // until its GLB lands — the names are still real, the rocks just
  // haven't arrived yet.
  for (const belt of SCALE_BELT_ASSETS) {
    const big = belt.key === "asteroid_big";
    const spots = layout.asteroids.filter((_, i) => (i % 2 === 0) === big);
    if (spots.length === 0) continue;
    void loadModel(belt.url, belt.url.split("/").pop() ?? belt.url).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      // One InstancedMesh per material (mergeByMaterial cost = material
      // count): the big rock is 2 calls, the small one 1. A multi-material
      // mesh keeps its material array — the InstancedMesh draws one call
      // per group, so the count still holds.
      const merged = mergeByMaterial(loaded);
      const meshes: THREE.Mesh[] = [];
      merged.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      for (const mesh of meshes) {
        const geo = mesh.geometry.clone();
        recenterGeometry(geo);
        scaleGeometryToSize(geo, big ? SCALE_BELT_SIZES.big : SCALE_BELT_SIZES.small);
        const instanced = new THREE.InstancedMesh(geo, mesh.material, spots.length);
        instanced.name = `belt-${belt.key}`;
        const m = new THREE.Matrix4();
        spots.forEach((a, i) => {
          m.setPosition(a.x, a.y, a.z);
          instanced.setMatrixAt(i, m);
        });
        instanced.instanceMatrix.needsUpdate = true;
        group.add(instanced);
      }
    });
  }

  // Hunt-2 belt pieces (space-hunt-2): big named rocks at the field's
  // edge — the strip, Bennu, the big rock, and the toastie load as-is;
  // the debris pile and the rubble rocks merge to one material each.
  // Bennu drifts on its own slow vector; the rest hold still.
  for (const piece of layout.beltPieces) {
    const asset = SCALE_BELT_PIECE_ASSETS.find((a) => a.key === piece.key);
    if (!asset) continue;
    const holder = new THREE.Group();
    holder.name = `belt-piece-${piece.key}`;
    holder.position.set(piece.x, piece.y, piece.z);
    group.add(holder);
    if (piece.drift) registerDrift(holder, [piece.x, piece.y, piece.z], piece.drift, 15);
    void loadModel(asset.url, asset.url.split("/").pop() ?? asset.url).then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      const body =
        asset.materials > 1
          ? mergeToSingleMaterial(loaded, SCALE_PALETTE.visitor)
          : loaded;
      if (!body) return;
      if (body !== loaded) disposeObject3D(loaded);
      fitToSize(body, piece.size);
      body.name = `belt-piece-model-${piece.key}`;
      holder.add(body);
    });
  }

  // Encounters (population increment): rare, slow-drift, far out — an
  // alien, an astronaut, two UFOs passing through the vast dark.
  // Merged to one material each; a missing encounter is simply absent.
  // The pulsar is the exception: it loads as-is, so its unlit glow
  // survives — merging it to the visitor grey would kill the sight.
  const loadMergedVisitor = (holder: THREE.Group, url: string, size: number) => {
    void loadModel(url, url.split("/").pop() ?? url).then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      const merged = mergeToSingleMaterial(loaded, SCALE_PALETTE.visitor);
      if (!merged) return;
      fitToSize(merged, size);
      holder.add(merged);
    });
  };
  const loadAsIsVisitor = (holder: THREE.Group, url: string, size: number) => {
    void loadModel(url, url.split("/").pop() ?? url).then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      fitToSize(loaded, size);
      holder.add(loaded);
    });
  };
  for (const encounter of layout.encounters) {
    const asset =
      SCALE_ENCOUNTER_ASSETS.find((a) => a.key === encounter.key) ??
      (encounter.key === "hubble" ? SCALE_HUNT2_HUBBLE_ASSET : undefined) ??
      (encounter.key === "pulsar" ? SCALE_SKETCHFAB_PULSAR_ASSET : undefined);
    if (!asset) continue;
    const holder = new THREE.Group();
    holder.name = `encounter-${encounter.key}`;
    holder.position.set(encounter.x, encounter.y, encounter.z);
    group.add(holder);
    registerDrift(holder, [encounter.x, encounter.y, encounter.z], encounter.drift, 30);
    if (encounter.material === "as-is") {
      loadAsIsVisitor(holder, asset.url, encounter.size);
    } else {
      loadMergedVisitor(holder, asset.url, encounter.size);
    }
  }

  // The debris satellite (population increment): old hardware, still
  // out there, drifting on its own slow vector.
  if (layout.satellite) {
    const sat = layout.satellite;
    const holder = new THREE.Group();
    holder.name = "satellite-a";
    holder.position.set(sat.x, sat.y, sat.z);
    group.add(holder);
    registerDrift(holder, [sat.x, sat.y, sat.z], sat.drift, 25);
    loadMergedVisitor(holder, SCALE_SATELLITE_ASSET.url, sat.size);
  }

  // Hunt-2 + Sketchfab centerpieces: heavy bodies, far out and dim —
  // the black hole and G292 load as-is; Pillars 1B and the gas cloud
  // carry no color of their own and are given the nebula material, a
  // translucent rose-gold for the Pillars and pale blue for the cloud.
  // The Sketchfab pair keeps its own materials and plays its own
  // clips — the nebula's shift, the black hole's turning disk — on top
  // of the slow spin. Each turns on its own slow spin (a full turn
  // takes minutes). A missing centerpiece is simply absent.
  const spinners: { holder: THREE.Group; periodMs: number }[] = [];
  const mixers: THREE.AnimationMixer[] = [];
  for (const piece of layout.centerpieces) {
    const asset =
      piece.key === "gas-cloud"
        ? SCALE_CLOUD_ASSET
        : (SCALE_CENTERPIECE_ASSETS.find((a) => a.key === piece.key) ??
          SCALE_SKETCHFAB_CENTERPIECE_ASSETS.find((a) => a.key === piece.key));
    if (!asset) continue;
    const holder = new THREE.Group();
    holder.name = `centerpiece-${piece.key}`;
    holder.position.set(piece.x, piece.y, piece.z);
    group.add(holder);
    spinners.push({ holder, periodMs: piece.spinMs });
    if (piece.animated) {
      void loadAnimatedModel(asset.url, asset.url.split("/").pop() ?? asset.url).then((loaded) => {
        if (!loaded) return;
        if (disposed) {
          disposeObject3D(loaded.scene);
          return;
        }
        fitToSize(loaded.scene, piece.size);
        loaded.scene.name = `centerpiece-model-${piece.key}`;
        holder.add(loaded.scene);
        if (loaded.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(loaded.scene);
          for (const clip of loaded.animations) mixer.clipAction(clip).play();
          mixers.push(mixer);
        }
      });
      continue;
    }
    void loadModel(asset.url, asset.url.split("/").pop() ?? asset.url).then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      if (piece.material === "nebula") {
        const merged = mergeToSingleMaterial(
          loaded,
          NEBULA_COLORS[piece.key] ?? 0xc97b5e,
        );
        if (!merged) return;
        disposeObject3D(loaded);
        fitToSize(merged, piece.size);
        // Translucent + emissive: a nebula reads as light held in gas,
        // not as a solid body.
        const mat = merged.material;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.transparent = true;
          mat.opacity = 0.85;
          mat.emissive = new THREE.Color(NEBULA_COLORS[piece.key] ?? 0xc97b5e);
          mat.emissiveIntensity = 0.35;
        }
        merged.name = `centerpiece-model-${piece.key}`;
        holder.add(merged);
        return;
      }
      fitToSize(loaded, piece.size);
      loaded.name = `centerpiece-model-${piece.key}`;
      holder.add(loaded);
    });
  }

  // Distant nebula light (hunt #2): three OGA renders as huge static
  // planes far outside the orbit, facing the center. A missing image
  // leaves the sky as it was — the loader no-ops, never throws. (The
  // try/catch is for loaders that throw synchronously where there is
  // no page to resolve against, as in tests — a failed load degrades
  // to the empty sky, never to a crash.)
  for (const plane of layout.nebulaPlanes) {
    const asset = SCALE_NEBULA_PLANE_ASSETS.find((a) => a.key === plane.key);
    if (!asset) continue;
    try {
      new THREE.TextureLoader().load(
        asset.url,
        (tex) => {
          if (disposed) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          const material = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(plane.width, plane.height), material);
          mesh.name = `nebula-plane-${plane.key}`;
          mesh.position.set(plane.x, plane.y, plane.z);
          mesh.lookAt(0, 0, 0);
          mesh.renderOrder = -10;
          mesh.frustumCulled = false;
          group.add(mesh);
        },
        undefined,
        () => {
          noteModelFallback(asset.url.split("/").pop() ?? asset.url);
        },
      );
    } catch {
      noteModelFallback(asset.url.split("/").pop() ?? asset.url);
    }
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

  // Clock for the animation mixers (see update): null until the first
  // tick, so the first frame never jumps a clip.
  let lastElapsedMs: number | null = null;

  return {
    group,
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed || opts?.reducedMotion) return;
      // The Sketchfab clips tick on the same clock as everything else:
      // delta from successive elapsed times, clamped so a tab-switch
      // can never jump a clip forward by minutes. Reduced motion holds
      // the clips still with the rest of the space.
      const deltaMs = lastElapsedMs === null ? 0 : elapsedMs - lastElapsedMs;
      lastElapsedMs = elapsedMs;
      const deltaS = Math.min(0.1, Math.max(0, deltaMs / 1000));
      for (const mixer of mixers) mixer.update(deltaS);
      // Drifters sway slowly on their own vectors — a gentle oscillation
      // around their anchor, so they never leave their station.
      for (const d of drifts) {
        const sway = Math.sin(elapsedMs * 0.00002 + d.phase) * d.amplitude;
        d.holder.position.set(
          d.anchor[0] + d.drift[0] * sway,
          d.anchor[1] + d.drift[1] * sway,
          d.anchor[2] + d.drift[2] * sway,
        );
      }
      // Centerpieces turn on their own slow spins — a full turn
      // takes minutes, never seconds.
      for (const s of spinners) {
        s.holder.rotation.y = (elapsedMs / s.periodMs) * Math.PI * 2;
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
