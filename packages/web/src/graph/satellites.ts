/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from "three";
import { COOLING_ENTROPY } from "@brain/shared";
import { gltfLoader, fadeSwapIn, noteModelFallback } from "./gltf.js";
import { emotionColorHex } from "./theme.js";

/**
 * Aura-class Beacons — Soumaya's deployed relay satellites.
 *
 * PURPOSE (tied to the Celestial Economy's entropy): a small fleet of probes that
 * autonomously seek out memories going COLD from neglect (high `entropy`) and take
 * up orbit around them, firing a warm tractor BEAM down onto the memory. They make
 * the abstract cooling signal physical — a satellite beaming a memory is Soumaya
 * saying "this one is fading, come back to it." Tend the memory (focus it →
 * entropy resets) and the beam cuts out; the beacon drifts to the next-coldest.
 *
 * LORE: the Aura beacons are older than the ship — salvaged warmth-relays Soumaya
 * keeps in the dark between the memories. They cannot rekindle a memory themselves;
 * only you can. So they do the one thing they can: pin a warm beam to a cooling
 * thought and hold it there until you return. (Drifters give them a wide berth —
 * the relays' beam scrambles a wanderer's bearings, so the aliens fear them.)
 *
 * Procedural fallback first; the real glTF swaps in when it loads. Self-animated
 * from the Graph3D tick via update(dt, nodes).
 */

export const SATELLITE_NAME = "Aura-class Beacon";
export const SATELLITE_LORE =
  "Soumaya's salvaged warmth-relays. They drift to memories going cold and pin a " +
  "warm beam onto them — they can't rekindle a fading thought, only you can, so they " +
  "make sure none cools unseen. Visit a beamed memory to warm it; the beacon moves on. " +
  "Drifters fear them: the beam scrambles a wanderer's bearings, so the aliens keep clear.";

/** A memory is "going cold" (worth a beacon) at/above this entropy — the same
 *  threshold the ❄️ badge, the Browse cooling filter and the daily quest all use. */
const COLD_THRESHOLD = COOLING_ENTROPY;

const vecOf = (n: any): THREE.Vector3 => new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0);

/** How "heavy a hub" a memory is — what the fleet guards when nothing is cold. */
const hubWeight = (n: any): number => (n.mass ?? 0) * 2 + (n.degree ?? 0) * 0.3;

/**
 * The beam/impact color for a target. It follows the memory's EMOTIONAL color so a
 * joyful memory glows warm gold and a heavy one cool blue — the relay's warmth is
 * tinted by the feeling it's tending. Falls back to the LLM-assigned node color,
 * then to the classic warm amber.
 */
const colorFor = (n: any): THREE.Color => {
  if (typeof n.color === "string" && /^#?[0-9a-f]{6}$/i.test(n.color)) {
    return new THREE.Color(n.color.startsWith("#") ? n.color : `#${n.color}`);
  }
  // Scene-wide emotion palette (theme.ts) — the beam reads the same as the
  // memory's links: gold joyful, indigo heavy, synapse green neutral.
  return new THREE.Color(emotionColorHex(n.emotionalWeight ?? 0));
};

/** Approximate a body's visual radius (mirrors nodeObject sizing) for standoff. */
const bodyRadius = (n: any): number => {
  const m = n.mass ?? 0.3;
  switch (n.celestial) {
    case "supergiant": return 9 + m * 7;
    case "star": return 6 + m * 6;
    case "giant": return 6.5 + m * 5;
    case "gas_giant": return 5.5 + m * 4.5;
    case "planet": return 4 + m * 4;
    case "moon": return 3 + m * 2.5;
    default: return 2.2 + m * 2;
  }
};

function makeGlowSprite(inner: string, mid: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, mid);
  g.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

/** A single procedural satellite (central bus + solar panels + dish) + running light. */
function makeProbe(): { group: THREE.Group; light: THREE.Sprite; fallback: THREE.Group } {
  const group = new THREE.Group();

  const fallback = new THREE.Group();
  const busMat = new THREE.MeshStandardMaterial({
    color: "#cfd6e8",
    emissive: new THREE.Color("#ffae50"),
    emissiveIntensity: 0.5,
    metalness: 0.85,
    roughness: 0.25,
  });
  const bus = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 2.6), busMat);
  fallback.add(bus);

  const panelMat = new THREE.MeshStandardMaterial({
    color: "#21407a",
    emissive: new THREE.Color("#2a5cff"),
    emissiveIntensity: 0.35,
    metalness: 0.6,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 2.4), panelMat);
    panel.position.set(sx * 4.2, 0, 0);
    fallback.add(panel);
  }
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 0.2, 0.5, 18, 1, true),
    new THREE.MeshStandardMaterial({
      color: "#eef2ff",
      emissive: new THREE.Color("#ffd28a"),
      emissiveIntensity: 0.6,
      metalness: 0.5,
      roughness: 0.3,
      side: THREE.DoubleSide,
    }),
  );
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 1.4, 0);
  fallback.add(dish);
  group.add(fallback);

  // Small running light on the probe itself (the beam below does the heavy lifting).
  const light = makeGlowSprite("rgba(255,210,130,0.95)", "rgba(255,170,80,0.3)");
  light.scale.set(10, 10, 1);
  group.add(light);

  group.scale.setScalar(1.5);
  group.visible = false;

  // Swap in the real glTF satellite once it loads (keep its own materials).
  // Uses the shared Draco-aware loader — this model is Draco-compressed.
  gltfLoader().load(
    "/aura-satellite.glb",
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const dim = new THREE.Vector3();
      box.getSize(dim);
      const maxDim = Math.max(dim.x, dim.y, dim.z) || 1;
      const k = 12 / maxDim;
      model.scale.setScalar(k);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.copy(center.multiplyScalar(-k));
      group.add(model);
      // IM-24: crossfade the real model in over the procedural probe.
      fadeSwapIn(model, () => {
        fallback.visible = false;
      });
    },
    undefined,
    (err) => {
      console.warn("[satellites] model failed to load; using procedural probe", err);
      noteModelFallback("The Aura beacon model");
    },
  );

  return { group, light, fallback };
}

/** A warm tractor beam (a tapered cylinder) that connects the probe to its memory. */
function makeBeam(): THREE.Mesh {
  // Unit cylinder along +Y; we orient + scale it between the two points each frame.
  const geom = new THREE.CylinderGeometry(0.18, 1.1, 1, 10, 1, true);
  geom.translate(0, 0.5, 0); // base at y=0, tip at y=1 so we can anchor at the probe
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#ffb24d"),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(geom, mat);
  beam.visible = false;
  return beam;
}

const UP = new THREE.Vector3(0, 1, 0);

interface Slot {
  probe: ReturnType<typeof makeProbe>;
  beam: THREE.Mesh;
  impact: THREE.Sprite;
  targetId: number | null;
  angle: number;
  spin: number;
  fade: number; // 0..1 visibility ease
  guard: boolean; // true = guarding a heavy hub (nothing cold); false = warming a cold memory
  launchedFor: number | null; // which target this probe was last launched (from the station) toward
  released: boolean; // false if assigned but waiting for Soumaya ship dispatch
}

export interface SatelliteSystem {
  group: THREE.Group;
  update: (
    dt: number,
    nodes: any[],
    stationPos?: THREE.Vector3 | null,
    soumayaPos?: THREE.Vector3 | null,
  ) => void;
  /** Active beacons (currently beaming a memory) — for the focus button. */
  getActive: () => { object: THREE.Object3D; targetId: number }[];
  /** Ids of memories currently under a beam (drifters avoid these). */
  getBeaconedIds: () => Set<number>;
  /** World positions of active beacons (drifters flee these). */
  getPositions: () => THREE.Vector3[];
  /** Ids of targets whose beacons are queued but not yet released. */
  getPendingDispatches: () => number[];
  /** Mark a beacon target as released. */
  release: (targetId: number) => void;
}

export function makeSatellites(maxCount = 3): SatelliteSystem {
  const group = new THREE.Group();
  const slots: Slot[] = [];
  for (let i = 0; i < maxCount; i++) {
    const probe = makeProbe();
    const beam = makeBeam();
    const impact = makeGlowSprite("rgba(255,235,190,0.95)", "rgba(255,180,90,0.45)");
    impact.visible = false;
    group.add(probe.group, beam, impact);
    slots.push({
      probe,
      beam,
      impact,
      targetId: null,
      angle: Math.random() * Math.PI * 2,
      spin: 0,
      fade: 0,
      guard: false,
      launchedFor: null,
      released: true,
    });
  }

  let retarget = 0;
  // Per-slot target lookup used to be a full `nodes.find()` linear scan every frame for
  // every slot. Node identities are stable and mutated in place by the orbit system, so
  // caching id->node here stays positionally fresh even though the Map itself is only
  // rebuilt at 5Hz rather than every frame.
  let idMapT = 0;
  let idMap = new Map<number, any>();

  const reassign = (nodes: any[]) => {
    const memories = nodes.filter((n) => n.kind !== "action" && n.x != null);
    if (memories.length === 0) {
      for (const s of slots) s.targetId = null;
      return;
    }
    const cold = memories
      .filter((n) => (n.entropy ?? 0) >= COLD_THRESHOLD)
      .sort((a, b) => (b.entropy ?? 0) - (a.entropy ?? 0));

    // Cold memories exist → warm the coldest (fleet GROWS with how many are cold).
    // Nothing cold → fall back to GUARDING the single heaviest hub star, so the
    // fleet is always visibly doing something purposeful.
    let ranked: any[];
    let desired: number;
    if (cold.length > 0) {
      ranked = cold;
      desired = Math.min(slots.length, cold.length);
    } else {
      ranked = [...memories].sort((a, b) => hubWeight(b) - hubWeight(a));
      desired = 1; // one sentinel on the brain's heaviest hub
    }
    const wanted = new Set(ranked.slice(0, desired).map((n) => n.id));

    // Drop slots whose target is no longer wanted; keep the ones still in the set.
    const taken = new Set<number>();
    for (const s of slots) {
      if (s.targetId != null && wanted.has(s.targetId)) {
        taken.add(s.targetId);
      } else {
        s.targetId = null;
        s.released = true; // reset to true when empty
      }
    }
    // Fill free slots with the wanted memories not already covered.
    const fill = ranked.slice(0, desired).filter((n) => !taken.has(n.id));
    let fi = 0;
    for (const s of slots) {
      if (s.targetId != null) continue;
      if (fi < fill.length) {
        s.targetId = fill[fi++]!.id;
        s.released = false; // assigned but not yet dispatched by ship!
      }
    }
  };

  const update = (
    dt: number,
    nodes: any[],
    stationPos?: THREE.Vector3 | null,
    soumayaPos?: THREE.Vector3 | null,
  ) => {
    try {
      retarget -= dt;
      if (retarget <= 0) {
        reassign(nodes);
        retarget = 2.5; // re-evaluate the cold list a few times a minute
      }
      idMapT -= dt;
      if (idMapT <= 0) {
        idMapT = 0.2; // 5Hz
        idMap = new Map(nodes.map((n) => [n.id, n]));
      }
      for (const s of slots) {
        const g = s.probe.group;
        const target = s.targetId != null ? idMap.get(s.targetId) ?? null : null;
        const tp = target && target.x != null ? vecOf(target) : null;

        if (s.targetId != null && !s.released) {
          // Pinned to launcher (ship or station) until released by Soumaya
          const launchPos = soumayaPos || stationPos;
          if (launchPos) {
            g.position.copy(launchPos);
          }
          s.fade = 0;
          g.visible = false;
          s.beam.visible = false;
          s.impact.visible = false;
          continue;
        }

        // Dispatched FROM Soumaya's ship: when a probe is newly assigned a target, it
        // launches from her ship position and flies out to the cold memory.
        if (target && s.targetId != null && s.launchedFor !== s.targetId) {
          s.launchedFor = s.targetId;
          if (s.fade < 0.05) {
            const launchPos = soumayaPos || stationPos;
            if (launchPos) {
              g.position.copy(launchPos);
            }
          }
        }

        // Materialise gently (slower fade) so a launch reads as a real event, not a pop-in.
        const wantVisible = tp != null;
        s.fade = THREE.MathUtils.clamp(s.fade + (wantVisible ? dt : -dt) * 0.7, 0, 1);
        g.visible = s.fade > 0.02;

        if (!g.visible || !tp || !target) {
          s.beam.visible = false;
          s.impact.visible = false;
          if (s.targetId == null) s.launchedFor = null; // allow a fresh launch next time
          continue;
        }

        const radius = bodyRadius(target);
        const standoff = radius + 18;
        s.angle += dt * 0.6;
        const want = new THREE.Vector3(
          tp.x + Math.cos(s.angle) * standoff,
          tp.y + Math.sin(s.angle * 0.7) * standoff * 0.4,
          tp.z + Math.sin(s.angle) * standoff,
        );
        const dir = want.clone().sub(g.position);
        const d = dir.length();
        // Cruise out at a watchable pace (was 220 u/s — too fast to follow). Ease as it
        // nears its standoff point so the arrival reads as a deliberate deployment.
        const cruise = 78 + Math.min(d, 260) * 0.28; // faster when far, gentle on approach
        g.position.addScaledVector(dir.normalize(), Math.min(d, cruise * dt));
        g.lookAt(tp);
        g.scale.setScalar(1.5 * (0.4 + 0.6 * s.fade));

        const entropy = target.entropy ?? 0.5;
        // Guard mode = nothing's cold, so this beacon is sentinel over a heavy hub
        // (calm, steady) rather than rescuing a cooling memory (urgent, bright).
        s.guard = entropy < COLD_THRESHOLD;
        const col = colorFor(target); // beam follows the memory's emotional color
        s.spin += dt;
        const pulse = 0.7 + 0.3 * Math.sin(s.spin * 3);

        // Running light on the probe (tinted to the memory's feeling).
        const ls = 9 * pulse * s.fade;
        s.probe.light.scale.set(ls, ls, 1);
        (s.probe.light.material as THREE.SpriteMaterial).color.copy(col);
        (s.probe.light.material as THREE.SpriteMaterial).opacity = 0.6 * s.fade;

        // --- The real beam: from the probe down to the memory's surface. ---
        const from = g.position.clone();
        const beamDir = tp.clone().sub(from);
        const gap = beamDir.length();
        if (gap < 0.001) {
          // Probe sitting on top of the node — no meaningful beam this frame.
          s.beam.visible = false;
          s.impact.visible = false;
          continue;
        }
        const len = Math.max(0.001, gap - radius); // stop at the surface
        beamDir.normalize();
        s.beam.visible = true;
        s.beam.position.copy(from);
        s.beam.quaternion.setFromUnitVectors(UP, beamDir);
        // Warming a cold memory: wide, bright beam that grows with the chill.
        // Guarding a hub: a thin, steady sentinel ray. Both tinted to the emotion.
        const beamMat = s.beam.material as THREE.MeshBasicMaterial;
        beamMat.color.copy(col);
        const width = s.guard
          ? 0.4 * (0.9 + 0.1 * Math.sin(s.spin * 2))
          : (0.5 + entropy * 0.9) * (0.85 + 0.15 * Math.sin(s.spin * 5));
        s.beam.scale.set(width, len, width);
        beamMat.opacity = (s.guard ? 0.16 : 0.22 + entropy * 0.4) * pulse * s.fade;

        // Impact glow where the beam strikes the surface (also emotion-tinted).
        const hit = from.clone().addScaledVector(beamDir, len);
        s.impact.visible = true;
        s.impact.position.copy(hit);
        const isz = (radius * 1.4 + 6) * (0.85 + 0.15 * Math.sin(s.spin * 6));
        s.impact.scale.set(isz, isz, 1);
        const impactMat = s.impact.material as THREE.SpriteMaterial;
        impactMat.color.copy(col);
        impactMat.opacity = (s.guard ? 0.28 : 0.4 + entropy * 0.5) * s.fade;
      }
    } catch {
      /* skip frame */
    }
  };

  const getActive = () =>
    slots
      .filter((s) => s.targetId != null && s.fade > 0.5)
      .map((s) => ({ object: s.probe.group as THREE.Object3D, targetId: s.targetId as number }));

  const getBeaconedIds = () =>
    new Set(slots.filter((s) => s.targetId != null && s.fade > 0.3).map((s) => s.targetId as number));

  const getPositions = () =>
    slots.filter((s) => s.fade > 0.3).map((s) => s.probe.group.position.clone());

  const getPendingDispatches = () =>
    slots.filter((s) => s.targetId != null && !s.released).map((s) => s.targetId as number);

  const release = (targetId: number) => {
    const slot = slots.find((s) => s.targetId === targetId);
    if (slot) {
      slot.released = true;
    }
  };

  return { group, update, getActive, getBeaconedIds, getPositions, getPendingDispatches, release };
}
