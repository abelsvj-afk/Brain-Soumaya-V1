/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from "three";

/**
 * Roaming visitors (#12). On a continuous randomized schedule, small craft drift
 * into the sandbox, head for a memory chosen by its vibe (warm memories draw a
 * luminous "traveler"; heavy/negative ones draw a darker "wanderer"), loiter a
 * while, then leave. All procedural (no glTF) — drop a .glb later to upgrade the
 * look. Self-animated from the Graph3D tick.
 */

interface Variant {
  name: string;
  hull: string;
  glow: string;
}
import { bodyColor } from "./theme.js";
import { gltfLoader, fadeSwapIn, noteModelFallback } from "./gltf.js";

const FRIENDLY: Variant = { name: "Luminous Traveler", hull: "#dfe9ff", glow: "#7af9ff" };
const NEUTRAL: Variant = { name: "Drifter", hull: "#cfd0e0", glow: "#b388ff" };
const OMINOUS: Variant = { name: "Void Wanderer", hull: "#3a2030", glow: "#ff5a6e" };

const vecOf = (n: any): THREE.Vector3 => new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0);

function makeCraft(index: number): {
  group: THREE.Group;
  setColor: (hull: string, glow: string) => void;
  /** Start loading the real craft model — called the first time this craft is shown (speed audit S3). */
  ensureModel: () => void;
} {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    emissive: new THREE.Color("#7af9ff"),
    emissiveIntensity: 1.2,
    metalness: 0.8,
    roughness: 0.2,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(2.4, 18, 12), bodyMat);
  body.scale.set(1, 0.42, 1); // saucer
  group.add(body);

  const ringMat = new THREE.MeshBasicMaterial({
    color: "#aef",
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.35, 8, 28), ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  group.scale.setScalar(1.4);
  group.visible = false;

  let loadedModel: THREE.Object3D | null = null;

  // The 921 KB model used to download at startup for a craft nobody had seen yet; it now loads the first time the craft
  // is shown (the procedural saucer covers the few frames until it lands, as before).
  let modelRequested = false;
  const ensureModel = () => {
    if (index !== 0 || modelRequested) return;
    modelRequested = true;
    // Replace Visitor 0 completely with the organic spaceship GLB, or procedural fallback
    gltfLoader().load(
      "/organic-spaceship.glb",
      (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const dim = new THREE.Vector3();
        box.getSize(dim);
        const maxDim = Math.max(dim.x, dim.y, dim.z) || 1;
        const k = 6.0 / maxDim; // match visitor scale
        model.scale.setScalar(k);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.copy(center.multiplyScalar(-k));

        loadedModel = model;
        group.add(model);
        // IM-24: crossfade the real craft in over the procedural saucer.
        fadeSwapIn(model, () => {
          body.visible = false;
          ring.visible = false;
        });
      },
      undefined,
      (err) => {
        console.log("[visitor] organic spaceship failed to load; using procedural fallback", err);
        noteModelFallback("The visitor craft model");
      }
    );
  };

  return {
    ensureModel,
    group,
    setColor: (hull, glow) => {
      bodyMat.color.set(hull);
      bodyMat.emissive.set(glow);
      ringMat.color.set(glow);
    },
  };
}

interface Slot {
  craft: ReturnType<typeof makeCraft>;
  phase: "idle" | "arrive" | "loiter" | "leave";
  targetId: number | null;
  loiter: number;
  angle: number;
  exit: THREE.Vector3;
  variant: Variant;
}

/** Fired when a craft actually reaches (settles on) a memory. */
export type OnVisit = (nodeId: number, visitorType: string) => void;

/** What the Aura beacons are doing right now — drifters fear/hate these. */
export interface VisitorHazard {
  /** Memories currently under a beam — aliens won't visit these. */
  beaconedIds: Set<number>;
  /** World positions of active beacons — aliens flee when one gets close. */
  positions: THREE.Vector3[];
}

export interface VisitorSystem {
  group: THREE.Group;
  update: (dt: number, nodes: any[], hazard?: VisitorHazard) => void;
  /** Visible craft currently in the sandbox (for the "jump to visitor" button).
   *  IM-19: carries the variant's name so the shell can identify the craft
   *  in-scene instead of leaving it anonymous. */
  getActive: () => { object: THREE.Object3D; targetId: number | null; variantName: string }[];
}

/** How close a beacon must get before a drifter panics and bolts. */
const FLEE_RADIUS = 240;

export function makeVisitors(maxConcurrent = 3, onVisit?: OnVisit): VisitorSystem {
  const group = new THREE.Group();
  const visitsMap = new Map<number, number>();
  const slots: Slot[] = [];
  for (let i = 0; i < maxConcurrent; i++) {
    const craft = makeCraft(i);
    group.add(craft.group);
    slots.push({ craft, phase: "idle", targetId: null, loiter: 0, angle: 0, exit: new THREE.Vector3(), variant: NEUTRAL });
  }
  let spawnTimer = 8; // first visitor a few seconds in
  // Per-slot target lookup used to be a full `nodes.find()` linear scan every frame for
  // every slot. Node identities are stable and mutated in place by the orbit system, so
  // caching id->node here stays positionally fresh even though the Map itself is only
  // rebuilt at 5Hz rather than every frame.
  let idMapT = 0;
  let idMap = new Map<number, any>();

  const spawn = (nodes: any[], hazard?: VisitorHazard) => {
    const slot = slots.find((s) => s.phase === "idle");
    if (!slot) return;
    // Drifters give beamed memories a wide berth — they won't even approach one.
    const beaconed = hazard?.beaconedIds;
    const candidates = nodes.filter((n) => n.x != null && !(beaconed?.has(n.id)));
    if (candidates.length === 0) return;

    // Calculate average emotional weight for the brain to compute rarity
    const totalEmotionalWeight = nodes.reduce((sum, n) => sum + (n.emotionalWeight ?? 0), 0);
    const avgEmotionalWeight = nodes.length > 0 ? totalEmotionalWeight / nodes.length : 0;

    // Score all candidates
    const scored = candidates.map((n) => {
      const emotionalIntensity = Math.abs(n.emotionalWeight ?? 0);
      const emotionalRarity = Math.abs((n.emotionalWeight ?? 0) - avgEmotionalWeight);
      const massFactor = n.mass ?? n.importance ?? 0.1;
      const densityFactor = (n.degree ?? 0) / 10;
      
      let recencyFactor = 0.5;
      const timeStr = n.lastTendedAt ?? n.occurredAt ?? n.createdAt;
      if (timeStr) {
        const ageMs = Date.now() - Date.parse(timeStr);
        if (!Number.isNaN(ageMs)) {
          // decay over 7 days
          recencyFactor = Math.exp(-ageMs / (7 * 24 * 3600 * 1000));
        }
      }
      
      const visits = visitsMap.get(n.id) ?? 0;
      const revisitPenalty = 1 / (1 + visits);
      
      // Attractions score function
      const score = (
        emotionalIntensity * 1.5 +
        emotionalRarity * 1.0 +
        massFactor * 2.0 +
        densityFactor * 0.8 +
        recencyFactor * 1.2
      ) * revisitPenalty;

      return { node: n, score };
    });

    // Sort by attraction score descending
    scored.sort((a, b) => b.score - a.score);

    // Pick top nodes with geometric decay probability distribution (70% top 1, 21% top 2, etc.)
    let target = scored[0]?.node;
    if (scored.length > 1) {
      const r = Math.random();
      let index = 0;
      let accum = 0.7;
      while (r > accum && index < scored.length - 1) {
        index++;
        accum += Math.pow(0.3, index) * 0.7;
      }
      target = scored[index]?.node ?? scored[0]?.node;
    }

    if (!target) return;
    
    // Color Sync: The visitor adopts the emotional color of the planet it is visiting.
    const nodeColor = bodyColor(target);
    const emo = target.emotionalWeight ?? 0;
    const variant = emo > 0.3 ? FRIENDLY : emo < -0.3 ? OMINOUS : NEUTRAL;
    
    // Blend the variant's hull with the node's color to show influence
    slot.craft.setColor(variant.hull, nodeColor);

    slot.variant = variant;
    slot.targetId = target.id;
    slot.phase = "arrive";
    slot.loiter = 12 + Math.random() * 22;
    slot.angle = Math.random() * Math.PI * 2;
    // start far out in a random direction
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    slot.craft.group.position.copy(vecOf(target).addScaledVector(dir, 1600));
    slot.exit.copy(dir).multiplyScalar(2600);
    slot.craft.ensureModel();
    slot.craft.group.visible = true;
  };

  const update = (dt: number, nodes: any[], hazard?: VisitorHazard) => {
    try {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawn(nodes, hazard);
        spawnTimer = 25 + Math.random() * 45; // next visitor in 25–70s
      }
      idMapT -= dt;
      if (idMapT <= 0) {
        idMapT = 0.2; // 5Hz
        idMap = new Map(nodes.map((n) => [n.id, n]));
      }
      for (const s of slots) {
        if (s.phase === "idle") continue;
        const g = s.craft.group;

        // FEAR: if a beacon strays too close, the drifter flashes hostile and bolts.
        if (s.phase !== "leave" && hazard?.positions?.length) {
          let nearest = Infinity;
          for (const p of hazard.positions) nearest = Math.min(nearest, p.distanceTo(g.position));
          if (nearest < FLEE_RADIUS) {
            s.craft.setColor(OMINOUS.hull, OMINOUS.glow); // hate/fear flush
            s.phase = "leave";
            // Run directly away from the galaxy centre (and the beam).
            s.exit.copy(g.position).normalize().multiplyScalar(2800);
          }
        }

        const target = s.targetId != null ? idMap.get(s.targetId) ?? null : null;
        const tp = target && target.x != null ? vecOf(target) : null;

        if (s.phase === "leave" || !tp) {
          // Cruise outward, then despawn.
          const dir = s.exit.clone().sub(g.position);
          const d = dir.length();
          g.position.addScaledVector(dir.normalize(), Math.min(d, 120 * dt));
          g.lookAt(s.exit);
          if (d < 60 || g.position.length() > 2400) {
            s.phase = "idle";
            g.visible = false;
          }
          continue;
        }

        if (s.phase === "arrive") {
          const want = tp.clone().add(new THREE.Vector3(60, 30, 60));
          const dir = want.clone().sub(g.position);
          const d = dir.length();
          g.position.addScaledVector(dir.normalize(), Math.min(d, 140 * dt));
          g.lookAt(tp);
          if (d < 12) {
            s.phase = "loiter";
            // It has arrived — record the visit (the memory + which craft type).
            if (s.targetId != null) {
              visitsMap.set(s.targetId, (visitsMap.get(s.targetId) ?? 0) + 1);
              onVisit?.(s.targetId, s.variant.name);
            }
          }
        } else if (s.phase === "loiter") {
          s.loiter -= dt;
          s.angle += dt * 0.5;
          g.position.set(
            tp.x + Math.cos(s.angle) * 70,
            tp.y + Math.sin(s.angle * 0.6) * 24,
            tp.z + Math.sin(s.angle) * 70,
          );
          g.lookAt(tp);
          if (s.loiter <= 0) {
            s.phase = "leave";
            s.exit.copy(g.position).normalize().multiplyScalar(2600);
          }
        }
      }
    } catch {
      /* skip frame */
    }
  };

  const getActive = () =>
    slots
      .filter((s) => s.phase !== "idle" && s.craft.group.visible)
      .map((s) => ({ object: s.craft.group as THREE.Object3D, targetId: s.targetId, variantName: s.variant.name }));

  return { group, update, getActive };
}
