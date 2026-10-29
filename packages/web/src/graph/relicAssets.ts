import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import {
  relicsForWorld,
  type RelicDef,
  type RelicWorld,
} from "@brain/shared";
import { DEEP_PAST_BASIN_Y, DEEP_PAST_BASIN_RADIUS } from "./deepPastLayout.js";
import {
  GARDEN_TERRACE_COUNT,
  GARDEN_TERRACE_HEIGHT,
} from "./gardenLayout.js";
import { PEOPLE_FIELD_RADIUS } from "./peopleLayout.js";
import { STATION_WHEEL_RADIUS } from "./stationLayout.js";

/**
 * Relic placement in the worlds (relics increment) — the 3D half of the
 * registry. The registry (`@brain/shared` relics.ts) says WHICH relic rests
 * WHERE in plain words; this module says where that is in scene units.
 *
 * Anchors are the relic's CENTER (the model is recentered on load, so a
 * tall relic and a flat one both sit the same way), with clearance above
 * the surface baked in. The Deep Past GLB wiring (a separate increment)
 * replaces the procedural basin/terrace/rim/stair/lantern geometry — when
 * it lands, these anchors must be re-checked against the new geometry.
 *
 * A relic whose GLB has not landed (or fails to load) is simply absent:
 * no procedural stand-in, no find offered for it. The find is offered
 * only for a relic the loader actually delivered — see `placeWorldRelics`.
 */

/** Longest side of a placed relic, in world units — monumental-small:
 *  readable from the scripted orbit, small beside the world itself. */
export const RELIC_DISPLAY_SIZE = 22;

export interface RelicAnchor {
  /** Scene-space center of the relic. */
  position: readonly [number, number, number];
  /** Longest side once placed. */
  size: number;
}

/**
 * Anchor per discoverable relic, derived from the layout constants of its
 * world (never a second copy of the numbers):
 * - Station: the wheel rim (radius 210, tube 26 → top ≈ 26) and the hero
 *   mooring radius (228). The nail sits on the rim; the ring floats just
 *   off the harbor beside the hero's mooring, clear of her ship at angle 0.
 * - Garden: the crown disc (radius 60) at the top terrace (y = 90) under
 *   the witness tree (trunk base radius 22). The seed rests just outside
 *   the trunk; the leaf rests at the roots' edge.
 * - Deep Past: the basin floor (y = −830, radius 320) and the lowest
 *   stratum's alcove band (radius 250–285, y = −712). The Witness rests
 *   at the basin's center, in the First Light itself.
 * - People: the field is data — clusters rest at radius 90–510 with
 *   lights orbiting to 30, so no fixed point inside the cluster band is
 *   guaranteed clear of a person's hearth (and no relic is ever tied to
 *   one person's cluster: the non-ranking rule). The only guaranteed-clear
 *   fixed spots are the field's heart and its outer edge. The Ember rests
 *   at the heart, among the first hearths; the Thread rests at the field's
 *   edge (radius 570: clear of the farthest light at 540, clear of the
 *   dressing ships at 620+), where the paths between the warm lights meet
 *   the dark beyond. Ground runs to radius 600, so both sit on the field.
 */
export const RELIC_ANCHORS: Readonly<Record<string, RelicAnchor>> = {
  "harbor-nail": {
    position: [STATION_WHEEL_RADIUS, 38, 0],
    size: RELIC_DISPLAY_SIZE,
  },
  "mooring-ring": {
    position: [214, 14, 78],
    size: RELIC_DISPLAY_SIZE,
  },
  "dawn-leaf": {
    position: [-34, GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]! + 12, 22],
    size: RELIC_DISPLAY_SIZE,
  },
  "witness-seed": {
    position: [26, GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]! + 12, 14],
    size: RELIC_DISPLAY_SIZE,
  },
  "first-light-shard": {
    position: [120, DEEP_PAST_BASIN_Y + 12, 80],
    size: RELIC_DISPLAY_SIZE,
  },
  "basin-stone": {
    position: [-140, DEEP_PAST_BASIN_Y + 12, 60],
    size: RELIC_DISPLAY_SIZE,
  },
  "lantern-of-keeping": {
    position: [150, -712, 242],
    size: RELIC_DISPLAY_SIZE,
  },
  "witness-without-a-name": {
    position: [0, DEEP_PAST_BASIN_Y + 12, 0],
    size: RELIC_DISPLAY_SIZE,
  },
  "hearth-ember": {
    position: [0, 12, 0],
    size: RELIC_DISPLAY_SIZE,
  },
  "thread-of-many": {
    position: [PEOPLE_FIELD_RADIUS + 10, 12, 0],
    size: RELIC_DISPLAY_SIZE,
  },
};

/** The basin's radius, re-exported for the anchor tests (one source). */
export const RELIC_BASIN_RADIUS = DEEP_PAST_BASIN_RADIUS;

/**
 * Scale a loaded relic so its longest side is `size`, and recenter it so
 * its bounding-box center sits at the origin — the caller then places the
 * holder at the anchor. Returns the scale applied (1 when the model has
 * no measurable size — the caller still places it, unscaled, rather than
 * dropping a real model for a measurement failure).
 */
export function fitRelicToAnchor(root: THREE.Object3D, size: number): number {
  const box = new THREE.Box3().setFromObject(root);
  const extents = box.getSize(new THREE.Vector3());
  const longest = Math.max(extents.x, extents.y, extents.z);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  const scale = size / longest;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
  const scaled = new THREE.Box3().setFromObject(root);
  const center = scaled.getCenter(new THREE.Vector3());
  root.position.sub(center);
  return scale;
}

/** A warm radial glow, computed as bytes — no canvas, so it builds in tests too. */
let glowTexture: THREE.DataTexture | null = null;
export function relicGlowTexture(): THREE.DataTexture {
  if (glowTexture) return glowTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2; // 0 at the center, 1 at the edge
      const a = Math.pow(Math.max(0, 1 - d), 2.2) * 255;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 214;
      data[i + 2] = 150;
      data[i + 3] = a;
    }
  }
  glowTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTexture.needsUpdate = true;
  return glowTexture;
}

/**
 * Load one relic GLB through the app's shared glTF loader. Resolves to
 * the loaded scene, or null when the load fails — the caller keeps the
 * world without that relic and the failure is registered for the
 * diagnostics note (the app's model-fallback pattern).
 */
export function loadRelicModel(url: string): Promise<THREE.Object3D | null> {
  const name = url.split("/").pop() ?? url;
  return new Promise((resolve) => {
    gltfLoader().load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => {
        noteModelFallback(name);
        resolve(null);
      },
    );
  });
}

/**
 * Place a world's discoverable relics into a scene group: each relic's GLB,
 * scaled to its anchor size, plus a small warm glow so it can be spotted
 * from the orbit. `onVisible` fires per relic ONLY once its real GLB is in
 * the scene — the host offers the find for that relic on that signal, and
 * never for a relic still missing. A load that fails leaves the world
 * without that relic (no stand-in) and fires nothing.
 *
 * Returns a cancel function: the scene calls it from dispose so a load
 * resolving after unmount disposes its model instead of adding it to a
 * dead group.
 */
export function placeWorldRelics(
  parent: THREE.Object3D,
  world: RelicWorld,
  onVisible?: (slug: string) => void,
): () => void {
  let cancelled = false;
  const defs: RelicDef[] = relicsForWorld(world).filter((d) => d.discoverable);
  for (const def of defs) {
    const anchor = RELIC_ANCHORS[def.id];
    if (!anchor) continue;
    void loadRelicModel(def.assetUrl).then((loaded) => {
      if (!loaded || cancelled) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      const holder = new THREE.Group();
      holder.name = `relic-${def.id}`;
      fitRelicToAnchor(loaded, anchor.size);
      holder.add(loaded);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: relicGlowTexture(),
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      );
      glow.scale.setScalar(44);
      glow.name = `relic-glow-${def.id}`;
      holder.add(glow);
      holder.position.set(
        anchor.position[0],
        anchor.position[1],
        anchor.position[2],
      );
      parent.add(holder);
      onVisible?.(def.id);
    });
  }
  return () => {
    cancelled = true;
  };
}
