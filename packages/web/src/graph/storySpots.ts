import * as THREE from "three";
import { spotReach, STORY_TRIGGERS, type StoryTrigger } from "@brain/shared";
import type { V3 } from "./worldFlight.js";

/**
 * Where the lore lives in a scene (docs/specs/lore-physical-spots-2026-10-31.md). A spot is anchored to one of the world's own NAMED landmarks (the same holders the Fly-to
 * flight finds), so it follows the scene: a model that has not loaded has no landmark, and a spot with no landmark can never be reached (fail closed). Nothing here draws anything
 * or lists anything — a spot is only a place you are or are not standing near.
 */

export interface Landmark {
  name: string;
  center: V3;
  radius: number;
}

/** Every object in `root` whose name matches `regexSource`; the first match in a branch IS the landmark and nothing inside it is looked at again (like findPlaces). */
export function locateLandmarks(root: THREE.Object3D, regexSource: string): Landmark[] {
  const re = new RegExp(regexSource);
  const out: Landmark[] = [];
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  const visit = (obj: THREE.Object3D) => {
    if (obj.name && re.test(obj.name)) {
      box.setFromObject(obj);
      if (!box.isEmpty()) {
        box.getBoundingSphere(sphere);
        if (Number.isFinite(sphere.radius) && Number.isFinite(sphere.center.x)) out.push({ name: obj.name, center: [sphere.center.x, sphere.center.y, sphere.center.z], radius: sphere.radius });
      }
      return;
    }
    obj.children.forEach(visit);
  };
  visit(root);
  return out;
}

/**
 * A predicate "is the viewer at THIS trigger's spot?" for a viewer at `viewer` in `world`. `root` is the scene (flight worlds); the garden's origin spots need none.
 * Triggers with no spot (Eternity) are the caller's business (shared `eligibleHere`/`pickNoticed` treat them as open).
 */
export function makeReach(world: string, root: THREE.Object3D | null, viewer: V3): (t: StoryTrigger) => boolean {
  const cache = new Map<string, Landmark[]>();
  return (t) => {
    const spot = t.spot;
    if (!spot || t.world !== world) return !spot;
    if (spot.origin) return spotReach(spot, [0, 0, 0], 1, viewer);
    if (!spot.place || !root) return false;
    let marks = cache.get(spot.place);
    if (!marks) {
      marks = locateLandmarks(root, spot.place);
      cache.set(spot.place, marks);
    }
    return marks.some((m) => spotReach(spot, m.center, m.radius, viewer));
  };
}

/** Does this world's lore live at physical spots (so a viewer must be deployed to find any of it)? */
export const worldHasSpots = (world: string): boolean => STORY_TRIGGERS.some((t) => t.world === world && (t.how === "regard" || t.how === "listen") && !!t.spot);
