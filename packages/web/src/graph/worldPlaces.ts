import * as THREE from "three";
import type { V3 } from "./worldFlight.js";

/**
 * Places you can fly to inside a world (docs/specs/worlds-flight-2026-10-29.md). Discovered at runtime from the
 * scene's own named holders and their bounding boxes — so a model that loads late appears when it lands, a
 * model that fails to load simply isn't offered, and a world gains places when a model is added.
 */
export interface Place {
  id: string;
  label: string;
  icon: string;
  center: V3;
  /** Bounding-sphere radius, world units. */
  radius: number;
}

interface Rule {
  match: RegExp;
  label: string;
  icon: string;
}

/** Per world: which named objects are places, and what to call them. First matching rule wins. */
export const PLACE_RULES: Record<string, Rule[]> = {
  "great-station": [
    { match: /^station-rotating$/, label: "The Station", icon: "i:harbor" },
    { match: /^witness-drydock-gantry$/, label: "Drydock", icon: "i:hangar" },
    { match: /^annex-(?!model)/, label: "Annex", icon: "i:door" },
    { match: /^hero-ship$/, label: "Your berth", icon: "i:rocket" },
    { match: /^backdrop-(?!.*-model$)/, label: "Planet", icon: "i:planet" },
  ],
  "deep-past": [
    { match: /^glb-basin$/, label: "First Light", icon: "i:sun" },
    { match: /^place-rim$/, label: "The rim", icon: "i:recenter" },
    // The generated stair is a named landmark (main's lore spot obj.follower-ribbon anchors to
    // it); as a place rule it also joins the fly-to list — a merge-integration consequence of the
    // rework, named in the PR (2026-10-30).
    { match: /^stair$/, label: "The stair", icon: "i:rise" },
    { match: /^glb-spire$/, label: "Anchor Spire", icon: "i:rise" },
    { match: /^glb-supernova$/, label: "Supernova", icon: "i:insights" },
    { match: /^place-shelf$/, label: "Rise shelf", icon: "i:insights" },
    { match: /^place-landing-deepest$/, label: "Deepest memories", icon: "i:rise" },
    { match: /^place-landing-mid$/, label: "Mid-descent", icon: "i:rise" },
    { match: /^place-landing-last$/, label: "Last landing", icon: "i:rise" },
  ],
  scale: [
    { match: /^iss-holder$/, label: "The ISS", icon: "i:harbor" },
    { match: /^moon$/, label: "The Moon", icon: "i:calm" },
    { match: /^planet-(?!model)/, label: "Planet", icon: "i:planet" },
    { match: /^probe-(?!model)/, label: "Probe", icon: "i:harbor" },
    { match: /^moon-outpost-(?!model)/, label: "Moon outpost", icon: "i:door" },
    { match: /^satellite-/, label: "Satellite", icon: "i:harbor" },
    { match: /^encounter-/, label: "Encounter", icon: "i:regard" },
    { match: /^centerpiece-/, label: "Centerpiece", icon: "i:insights" },
  ],
  people: [
    { match: /^field-ground$/, label: "The field", icon: "i:meadow" },
    { match: /^backdrop-(?!.*-model$)/, label: "Planet", icon: "i:planet" },
  ],
  "the-unmade-hour": [
    { match: /^unmade-hollows$/, label: "The hollows", icon: "i:veil" },
    { match: /^unmade-ring$/, label: "The ring", icon: "i:calm" },
    { match: /^unmade-standing$/, label: "The standing place", icon: "i:regard" },
    { match: /^unmade-hands$/, label: "The hands", icon: "i:meadow" },
    { match: /^unmade-frame$/, label: "The frame", icon: "i:door" },
    { match: /^unmade-tally$/, label: "The marks", icon: "i:insights" },
    { match: /^unmade-seam$/, label: "The step", icon: "i:rise" },
    { match: /^unmade-note$/, label: "The held note", icon: "i:sun" },
  ],
  "the-village": [
    { match: /^village-gate$/, label: "The gate", icon: "i:door" },
    { match: /^village-windows$/, label: "The windows", icon: "i:insights" },
    { match: /^village-well$/, label: "The well", icon: "i:meadow" },
    { match: /^village-chair$/, label: "The chair", icon: "i:veil" },
    { match: /^village-hearth$/, label: "The hearth", icon: "i:meadow" },
    { match: /^village-hooks$/, label: "The hooks", icon: "i:rise" },
    { match: /^village-door$/, label: "The doorway", icon: "i:door" },
    { match: /^village-bread$/, label: "The bread", icon: "i:meadow" },
  ],
  "road-to-the-seam": [
    { match: /^road-mouth$/, label: "The mouth", icon: "i:door" },
    { match: /^road-lamps$/, label: "The lamps", icon: "i:insights" },
    { match: /^road-nails$/, label: "The nails", icon: "i:door" },
    { match: /^road-chalk$/, label: "The chalk", icon: "i:meadow" },
    { match: /^road-doorframe$/, label: "The door-frame", icon: "i:door" },
    { match: /^road-post$/, label: "The post", icon: "i:rise" },
    { match: /^road-chalk-end$/, label: "Where the chalk stops", icon: "i:meadow" },
    { match: /^road-far$/, label: "The far end", icon: "i:rise" },
  ],
  "faded-ward": [
    { match: /^ward-door$/, label: "The door", icon: "i:door" },
    { match: /^ward-cot-ruel$/, label: "The cot that laughs", icon: "i:veil" },
    { match: /^ward-cot-linnet$/, label: "The made-up cot", icon: "i:veil" },
    { match: /^ward-small-bed$/, label: "The small bed", icon: "i:veil" },
    { match: /^ward-bowl$/, label: "The bowl", icon: "i:meadow" },
    { match: /^ward-window$/, label: "The window", icon: "i:insights" },
    { match: /^ward-hook$/, label: "The coat on its hook", icon: "i:door" },
    { match: /^ward-far$/, label: "The far end", icon: "i:rise" },
  ],
  "quiet-archive": [
    { match: /^still-threshold$/, label: "The threshold", icon: "i:door" },
    { match: /^field-ground$/, label: "The field", icon: "i:veil" },
  ],
};

/** Smallest thing worth flying to: anything smaller is dressing. */
export const MIN_PLACE_RADIUS = 4;
export const MAX_PLACES = 8;

/** "planet-planet-jupiter" → "Jupiter"; "centerpiece-sf-black-hole" → "Black hole". */
const KIND_PREFIX = /^(?:backdrop|planet|probe|satellite|encounter|centerpiece|annex|moon-outpost|sf|pp|pillars)[-_ ]+/i;
export function prettify(name: string): string {
  let s = name;
  for (let i = 0; i < 4 && KIND_PREFIX.test(s) && s.replace(KIND_PREFIX, "").length > 0; i++) s = s.replace(KIND_PREFIX, "");
  s = s.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The places in `root` for `world`. Needs up-to-date world matrices (the caller updates them); objects
 * whose bounds are empty or non-finite (a holder whose model hasn't loaded) are skipped.
 */
export function findPlaces(world: string, root: THREE.Object3D): Place[] {
  const rules = PLACE_RULES[world];
  if (!rules) return [];
  const found: Place[] = [];
  const seen = new Set<string>();
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  // Walk the tree; the first object that matches a rule IS the place and nothing inside it is looked at again
  // (its own model is part of it, never a second place).
  const visit = (obj: THREE.Object3D) => {
    const rule = obj.name ? rules.find((r) => r.match.test(obj.name)) : undefined;
    if (!rule) {
      obj.children.forEach(visit);
      return;
    }
    box.setFromObject(obj);
    if (box.isEmpty()) return;
    box.getBoundingSphere(sphere);
    if (!Number.isFinite(sphere.radius) || !Number.isFinite(sphere.center.x) || sphere.radius < MIN_PLACE_RADIUS) return;
    const generic = ["Planet", "Probe", "Annex", "Satellite", "Encounter", "Centerpiece", "Moon outpost"].includes(rule.label);
    // A generic kind is named by what it is ("Jupiter", "Voyager"); the kind itself is only the fallback.
    const detail = generic ? prettify(obj.name) : "";
    let label = detail && detail.toLowerCase() !== rule.label.toLowerCase() ? detail : rule.label;
    // A scenery planet's key ("lava") isn't a name on its own; the real bodies are.
    if (rule.label === "Planet" && detail && !/^(sun|moon|earth|mars|jupiter|saturn|venus|mercury|uranus|neptune|pluto)\b/i.test(detail) && !/planet/i.test(detail)) label = `${detail} planet`;
    if (seen.has(obj.name)) return;
    seen.add(obj.name);
    found.push({ id: obj.name, label, icon: rule.icon, center: [sphere.center.x, sphere.center.y, sphere.center.z], radius: sphere.radius });
  };
  visit(root);
  // Biggest first, capped: a tile row is for destinations, not an inventory.
  return found.sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id)).slice(0, MAX_PLACES);
}
