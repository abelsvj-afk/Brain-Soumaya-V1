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
    { match: /^station-rotating$/, label: "The Station", icon: "🛰" },
    { match: /^witness-drydock-gantry$/, label: "Drydock", icon: "🏗" },
    { match: /^annex-(?!model)/, label: "Annex", icon: "🏢" },
    { match: /^hero-ship$/, label: "Your berth", icon: "🚀" },
    { match: /^backdrop-(?!.*-model$)/, label: "Planet", icon: "🪐" },
  ],
  "deep-past": [
    { match: /^glb-basin$/, label: "First Light basin", icon: "🌅" },
    { match: /^glb-rim$/, label: "The rim", icon: "⭕" },
    { match: /^glb-stair$/, label: "The stair", icon: "🪜" },
    { match: /^glb-lantern$/, label: "Hero lantern", icon: "🏮" },
    { match: /^glb-crystal$/, label: "Crystals", icon: "💎" },
    { match: /^glb-supernova$/, label: "Supernova remnant", icon: "💥" },
    { match: /^glb-spire$/, label: "The spire", icon: "🗼" },
    { match: /^glb-orb$/, label: "First Light orb", icon: "🔆" },
    { match: /^glb-terrace$/, label: "Terrace", icon: "⛰" },
  ],
  scale: [
    { match: /^iss-holder$/, label: "The ISS", icon: "🛰" },
    { match: /^moon$/, label: "The Moon", icon: "🌙" },
    { match: /^planet-(?!model)/, label: "Planet", icon: "🪐" },
    { match: /^probe-(?!model)/, label: "Probe", icon: "📡" },
    { match: /^moon-outpost-(?!model)/, label: "Moon outpost", icon: "🏠" },
    { match: /^satellite-/, label: "Satellite", icon: "🛰" },
    { match: /^encounter-/, label: "Encounter", icon: "👁" },
    { match: /^centerpiece-/, label: "Centerpiece", icon: "✨" },
  ],
  people: [
    { match: /^field-ground$/, label: "The field", icon: "🌾" },
    { match: /^backdrop-(?!.*-model$)/, label: "Planet", icon: "🪐" },
  ],
  "quiet-archive": [
    { match: /^still-threshold$/, label: "The threshold", icon: "⛩" },
    { match: /^field-ground$/, label: "The field", icon: "🌫" },
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
