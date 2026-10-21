/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from "three";
import { gltfLoader, fadeSwapIn, noteModelFallback } from "./gltf.js";

// ---- Shared E-45 fleet model (real hull, loaded once, cloned per craft) ----
// The procedural cone below stays as the offline / load-failure fallback so the fleet is
// never invisible without the asset. Orientation constants are top-level so a nose-forward
// tweak is a one-liner if the model flies backward on-device.
const FLEET_MODEL_URL = "/E45-fleet.glb";
const FLEET_LEN = 5; // target longest-axis size in world units (a touch smaller than the named cone)
const FLEET_ROT_X = 0; // pitch tweak (radians) if the model sits nose-up/down
// glTF authors "forward" as -Z, but craft.lookAt() flies the group +Z-forward, so the model
// went tail-first. Flip 180° about Y so the nose leads the direction of travel.
const FLEET_ROT_Y = Math.PI;

let fleetProto: THREE.Object3D | null = null;
let fleetLoading = false;
const fleetWaiters: Array<(proto: THREE.Object3D) => void> = [];

function loadFleetModel(onReady: (proto: THREE.Object3D) => void): void {
  if (fleetProto) { onReady(fleetProto); return; }
  fleetWaiters.push(onReady);
  if (fleetLoading) return;
  fleetLoading = true;
  gltfLoader().load(
    FLEET_MODEL_URL,
    (gltf) => {
      const scene = gltf.scene;
      // Normalize: center at origin + scale so the longest side ≈ FLEET_LEN, with the tweak
      // rotations baked into a wrapper so per-craft lookAt() still steers the whole thing.
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      scene.position.sub(center);
      scene.traverse((o: any) => {
        if (o.isMesh && o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.fog = false;
        }
      });
      const wrap = new THREE.Group();
      wrap.add(scene);
      const longest = Math.max(size.x, size.y, size.z) || 1;
      wrap.scale.setScalar(FLEET_LEN / longest);
      wrap.rotation.set(FLEET_ROT_X, FLEET_ROT_Y, 0);
      fleetProto = wrap;
      for (const w of fleetWaiters) w(wrap);
      fleetWaiters.length = 0;
    },
    undefined,
    () => {
      fleetWaiters.length = 0;
      fleetLoading = false; /* keep the procedural cone */
      noteModelFallback("The fleet craft model");
    },
  );
}

/**
 * Soumaya's sub-agents — small autonomous craft that report to her and divide her
 * labor across the galaxy. They are procedural (drop a .glb later to upgrade) and
 * self-animated from the Graph3D tick.
 *
 *  - SCOUT (teal): explores the FRONTIER — flies to the newest / least-connected
 *    memories and surveys them, feeding Soumaya's curiosity (Research Mode).
 *  - DEFENDER (amber-red): GUARDS the brain's heaviest hub, and breaks off to
 *    intercept hostile drifters (the aliens) that stray too close.
 *  - TENDER squadron (warm amber): a growing wing of small drones that hover over the
 *    COOLING memories and warm them — the fleet grows as the galaxy grows (1 drone per
 *    ~30 memories, capped). Purely a visual helping hand: they never change entropy,
 *    speed Soumaya up, or spend fuel — her real maintenance loop is untouched.
 *
 * Each exposes a live status the Fleet panel reads. Beacons (Aura relays) are a
 * separate system (satellites.ts) but are presented together in the Fleet roster.
 */

export type SubAgentId = "scout" | "defender" | "tender" | "escort";
const MAX_TENDERS = 5; // the squadron never grows beyond this (perf + calm)

export interface SubAgentStatus {
  id: SubAgentId;
  active: boolean;
  /** Short live status line, e.g. "Surveying 'Lisbon trip'". */
  detail: string;
  /** The memory it's currently attending, if any. */
  targetLabel: string | null;
  /** The id of that memory (for fly-to), if any. */
  targetId: number | null;
}

export interface SubAgentHazard {
  positions: THREE.Vector3[];
}

export interface SubAgentSystem {
  group: THREE.Group;
  update: (dt: number, nodes: any[], hazard?: SubAgentHazard, leaderPos?: THREE.Vector3 | null) => void;
  getStatus: () => SubAgentStatus[];
  /** Followable craft (visible only), the Escort first — powers the fleet focus button. */
  getCraft: () => Array<{ id: SubAgentId; object: THREE.Object3D }>;
}

const vecOf = (n: any): THREE.Vector3 => new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0);

function glowSprite(color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(0.4, color.replace(/[\d.]+\)$/, "0.3)"));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.62, // dial the glow down a touch — it read too bright up close on focus (keep the colour)
    }),
  );
}

function makeCraft(hull: string, glow: string): THREE.Group {
  const group = new THREE.Group();
  // Procedural fallback: a small dart-like body (used until the real hull loads, and forever
  // if the asset is unavailable — the fleet is never invisible offline).
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 4.2, 12),
    new THREE.MeshStandardMaterial({
      color: hull,
      emissive: new THREE.Color(glow),
      emissiveIntensity: 0.7,
      metalness: 0.8,
      roughness: 0.25,
    }),
  );
  body.rotation.x = Math.PI / 2; // point "forward" (+z)
  group.add(body);
  // The role-coloured glow stays (it's the accessible colour channel + keeps the small hull
  // visible against dark space); the loaded hull is neutral steel underneath it.
  const light = glowSprite(glow.startsWith("rgba") ? glow : "rgba(150,220,255,0.95)");
  light.scale.set(9.5, 9.5, 1); // slightly smaller so the glow doesn't wash out the hull when focused
  group.add(light);
  // Upgrade the cone to Soumaya's real E-45 fleet hull once it loads (cloned from the shared
  // prototype — geometry/materials are shared across all craft, so it's cheap per unit).
  loadFleetModel((proto) => {
    const model = proto.clone(true);
    // Clones share the prototype's materials — give this craft its own copies
    // so the IM-24 fade-in doesn't fade every fleet craft at once.
    model.traverse((o: any) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m: any) => m.clone()) : o.material.clone();
      }
    });
    group.add(model);
    fadeSwapIn(model, () => {
      body.visible = false; // retire the placeholder cone once the hull has faded in
    });
  });
  return group;
}

interface Unit {
  id: SubAgentId;
  craft: THREE.Group;
  target: number | null;
  retarget: number;
  status: string;
  targetLabel: string | null;
}

const hubWeight = (n: any): number => (n.mass ?? 0) * 2 + (n.degree ?? 0) * 0.3;
const ageMs = (iso?: string): number => {
  if (!iso) return Infinity;
  const t = Date.parse(iso.includes("Z") ? iso : iso.replace(" ", "T") + "Z");
  return Number.isNaN(t) ? Infinity : Date.now() - t;
};

const entropyOf = (n: any): number => n.entropy ?? 0;

export function makeSubAgents(): SubAgentSystem {
  const group = new THREE.Group();
  const scout = makeCraft("#d6ffe9", "rgba(122,255,200,0.95)");
  const defender = makeCraft("#ffd9c2", "rgba(255,150,90,0.95)");
  group.add(scout, defender);

  const units: Unit[] = [
    { id: "scout", craft: scout, target: null, retarget: 0, status: "Standing by", targetLabel: null },
    { id: "defender", craft: defender, target: null, retarget: 0, status: "Standing by", targetLabel: null },
  ];

  // The Tender squadron — a pool created up front, activated to a count that scales with
  // the galaxy. Each warms a distinct cooling memory. Visual only.
  const tenders = Array.from({ length: MAX_TENDERS }, () => {
    const c = makeCraft("#ffe4b0", "rgba(255,190,110,0.95)");
    c.scale.setScalar(0.8); // a touch smaller than the named craft
    c.visible = false;
    group.add(c);
    return c;
  });
  const tenderAngle = tenders.map(() => Math.random() * 6.28);
  let tendersActive = 0;
  let coldestLabel: string | null = null;

  // The ESCORT — Soumaya's personal wing, under her DIRECT command: it flies formation on
  // her ship rather than roaming autonomously like the scout/defender/tenders. Always active
  // once her position is known; it's the primary target of the fleet focus button.
  const escort = makeCraft("#bcd8ff", "rgba(150,200,255,0.95)");
  escort.scale.setScalar(0.9);
  escort.visible = false;
  group.add(escort);
  let escortAngle = Math.random() * 6.28;
  let escortActive = false;

  const angle: Record<SubAgentId, number> = { scout: Math.random() * 6.28, defender: Math.random() * 6.28, tender: 0, escort: 0 };

  // `memories` (a full filter of every node) and `cooling` (a full sort of `memories`) used
  // to be rebuilt every single frame even though nothing that reads them — target selection
  // (already on its own 4-6s per-unit timer) or the tender count/coldest-label — actually
  // needs sub-second freshness. Throttled to 5Hz: the node OBJECTS the cache holds references
  // to are still mutated in place every frame by the orbit system, so cached entries never go
  // stale positionally — only the membership/ordering of the two arrays is allowed to lag by
  // up to 200ms, which is imperceptible for "who's the frontier" / "who's coldest".
  let memRefreshT = 0;
  let cachedMemories: any[] = [];
  let cachedCooling: any[] = [];

  const chooseTarget = (id: SubAgentId, memories: any[]): any | null => {
    if (memories.length === 0) return null;
    if (id === "scout") {
      // The frontier: newest memory, tie-broken toward the least connected.
      return [...memories].sort(
        (a, b) => ageMs(a.createdAt) - ageMs(b.createdAt) || (a.degree ?? 0) - (b.degree ?? 0),
      )[0];
    }
    // Defender guards the heaviest hub.
    return [...memories].sort((a, b) => hubWeight(b) - hubWeight(a))[0];
  };

  const update = (dt: number, nodes: any[], hazard?: SubAgentHazard, leaderPos?: THREE.Vector3 | null) => {
    try {
      // Escort: hold a gentle formation off Soumaya's wing (she commands it directly).
      escortActive = !!leaderPos;
      escort.visible = escortActive;
      if (leaderPos) {
        escortAngle += dt * 0.6;
        const aim = new THREE.Vector3(
          leaderPos.x + Math.cos(escortAngle) * 26,
          leaderPos.y + 9 + Math.sin(escortAngle * 1.5) * 4,
          leaderPos.z + Math.sin(escortAngle) * 26,
        );
        const dir = aim.clone().sub(escort.position);
        const dist = dir.length();
        escort.position.addScaledVector(dir.normalize(), Math.min(dist, 320 * dt));
        if (dist > 0.01) escort.lookAt(leaderPos); // keep her nose-to-nose with the flagship
      }
      memRefreshT -= dt;
      if (memRefreshT <= 0) {
        memRefreshT = 0.2; // 5Hz
        cachedMemories = nodes.filter((n) => n.kind !== "action" && n.x != null);
        cachedCooling = [...cachedMemories].sort((a, b) => entropyOf(b) - entropyOf(a));
      }
      const memories = cachedMemories;
      for (const u of units) {
        u.retarget -= dt;
        if (u.retarget <= 0) {
          const t = chooseTarget(u.id, memories);
          u.target = t?.id ?? null;
          u.targetLabel = t?.label ?? null;
          u.retarget = u.id === "scout" ? 4 : 6; // scouts re-survey more often
        }
        const target = u.target != null ? memories.find((n) => n.id === u.target) : null;

        // Defender breaks off to intercept a hostile drifter that strays near.
        let aim: THREE.Vector3 | null = null;
        if (u.id === "defender" && hazard && hazard.positions.length > 0) {
          const self = u.craft.position;
          let nearest: THREE.Vector3 | null = null;
          let best = Infinity;
          for (const p of hazard.positions) {
            const d = p.distanceTo(self);
            if (d < best) {
              best = d;
              nearest = p;
            }
          }
          if (nearest && best < 900) {
            aim = nearest.clone();
            u.status = "Intercepting a drifter";
            u.targetLabel = null;
          }
        }

        if (!aim && target) {
          angle[u.id] += dt * (u.id === "scout" ? 0.5 : 0.3);
          const r = 26 + (target.mass ?? 0.3) * 10;
          const tp = vecOf(target);
          aim = new THREE.Vector3(
            tp.x + Math.cos(angle[u.id]) * r,
            tp.y + Math.sin(angle[u.id] * 0.7) * r * 0.5,
            tp.z + Math.sin(angle[u.id]) * r,
          );
          u.status = u.id === "scout" ? `Surveying "${target.label}"` : `Guarding "${target.label}"`;
        }

        if (!aim) {
          u.status = "Standing by";
          u.craft.visible = false;
          continue;
        }
        u.craft.visible = true;
        const dir = aim.clone().sub(u.craft.position);
        const dist = dir.length();
        u.craft.position.addScaledVector(dir.normalize(), Math.min(dist, 260 * dt));
        if (dist > 0.01) u.craft.lookAt(aim);
      }

      // Tender squadron: the fleet grows with the galaxy (1 per ~30 memories, capped),
      // each warming a DISTINCT cooling memory. The coldest first. `cachedCooling` is the
      // same 5Hz-refreshed sort computed above — re-sorting every frame bought nothing,
      // since tender assignment only needs to react on the order of seconds anyway.
      tendersActive = Math.min(MAX_TENDERS, Math.floor(memories.length / 30));
      const cooling = cachedCooling;
      coldestLabel = tendersActive > 0 ? cooling[0]?.label ?? null : null;
      for (let i = 0; i < tenders.length; i++) {
        const craft = tenders[i]!;
        const tgt = i < tendersActive ? cooling[i] : null;
        if (!tgt) {
          craft.visible = false;
          continue;
        }
        craft.visible = true;
        tenderAngle[i]! += dt * 0.7;
        const r = 20 + (tgt.mass ?? 0.3) * 8;
        const tp = vecOf(tgt);
        const aim = new THREE.Vector3(
          tp.x + Math.cos(tenderAngle[i]!) * r,
          tp.y + Math.sin(tenderAngle[i]! * 1.3) * r * 0.5,
          tp.z + Math.sin(tenderAngle[i]!) * r,
        );
        const dir = aim.clone().sub(craft.position);
        const dist = dir.length();
        craft.position.addScaledVector(dir.normalize(), Math.min(dist, 240 * dt));
        if (dist > 0.01) craft.lookAt(aim);
      }
    } catch {
      /* never break the frame */
    }
  };

  const getStatus = (): SubAgentStatus[] => {
    const base = units.map((u) => ({
      id: u.id,
      active: u.craft.visible && u.target != null,
      detail: u.status,
      targetLabel: u.targetLabel,
      // IM-19 fix: u.target IS the numeric id — reading `.id` off it always
      // yielded null, so fleet statuses never carried a fly-to target id.
      targetId: u.target ?? null,
    }));
    // One aggregate line for the whole Tender squadron (grows with the galaxy).
    base.push({
      id: "tender",
      active: tendersActive > 0,
      detail: tendersActive > 0 ? `${tendersActive} tender${tendersActive === 1 ? "" : "s"} warming cooling memories` : "Squadron docked",
      targetLabel: coldestLabel,
      targetId: null,
    });
    // The Escort — her personal wing, flying formation on the flagship.
    base.push({
      id: "escort",
      active: escortActive,
      detail: escortActive ? "Flying escort on Soumaya" : "Awaiting the flagship",
      targetLabel: null,
      targetId: null,
    });
    return base;
  };

  // Followable craft for the fleet focus button — the Escort first (her direct command),
  // then the named craft + any deployed tenders, all only while visible.
  const getCraft = (): Array<{ id: SubAgentId; object: THREE.Object3D }> => {
    const out: Array<{ id: SubAgentId; object: THREE.Object3D }> = [];
    if (escort.visible) out.push({ id: "escort", object: escort });
    for (const u of units) if (u.craft.visible) out.push({ id: u.id, object: u.craft });
    for (let i = 0; i < tendersActive; i++) if (tenders[i]?.visible) out.push({ id: "tender", object: tenders[i]! });
    return out;
  };

  return { group, update, getStatus, getCraft };
}
