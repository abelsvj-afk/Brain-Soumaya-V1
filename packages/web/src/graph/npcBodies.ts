import * as THREE from "three";
import type { CastMember } from "@brain/shared";
import { createEngineFlame, createEnginePlume, type EngineFlame, type EnginePlume } from "./enginePlume.js";
import { disposeObject3D } from "./graph3dHelpers.js";
import { loadStationAsset } from "./stationAssets.js";
import { PATROL_RADIUS, patrolAt, roamAt, type PatrolBerth, type PatrolPhase, type RoamAnchor } from "./npcPresence.js";

/**
 * The cast's ships in a world (docs/specs/npc-society-2026-10-30.md): real Quaternius hulls already in public/, each with the same engine flame and trail
 * Soumaya's ship has (graph/enginePlume.ts) in the NPC's own trail colour. One manager per mounted world scene. Presentation only — a body's position is a pure
 * function of the clock (npcPresence.ts), so there is no state to keep in step with a server.
 */

/** How long an NPC ship is, nose to tail, in world units (the Station controller's panel says "28 across"). */
export const NPC_SHIP_LENGTH = 28;

/**
 * Harbor Ring hub (Item 4, Stage 1): the docking band between the
 * controller's berth (3π/4, radius 222) and Bex's berth (5π/4), centred
 * near the docking arm (π/2, radius 228) — mooringPose gives [cos·r, y,
 * sin·r], so the band sits around [-105, 0, 73]. The six background
 * Station NPCs roam this ~175-radius disc; the main cast keeps the
 * whole-world anchor. Radius is a measurement, not canon: it fits inside
 * the 560 cap and inside the controller's 330 patrol disc.
 */
export const HARBOR_RING_HUB: RoamAnchor = { center: [-105, 0, 73], radius: 175 };

/** The background Station NPCs (Item 4): they live in the Harbor Ring hub. */
export const HUB_NPC_IDS: ReadonlySet<string> = new Set(["dockhand", "stallkeeper", "crate-counter", "net-mender", "lamp-trimmer", "berth-clerk"]);

/** Which anchor a body roams: hub NPCs roam the Harbor Ring, everyone else the whole world. */
export function anchorForNpc(id: string, anchor: RoamAnchor | null, hubAnchor: RoamAnchor | null): RoamAnchor | null {
  return HUB_NPC_IDS.has(id) ? (hubAnchor ?? anchor) : anchor;
}

/**
 * Crowd-aware roam radius (scale-lanes L18): the roam disc grows with
 * the number present past 4, so a crowded world spreads out instead of
 * stacking ships — capped by world size (the 560 anchor cap), never
 * beyond it. At 4 or fewer present the radius is unchanged.
 */
export function crowdAwareRadius(baseRadius: number, presentCount: number): number {
  if (presentCount <= 4) return baseRadius;
  return Math.min(560, baseRadius * (1 + 0.08 * (presentCount - 4)));
}

export interface NpcBodyFrame {
  id: string;
  /** World-space position of the ship. */
  pos: THREE.Vector3;
  phase: PatrolPhase | "roaming";
}

interface Body {
  member: CastMember;
  holder: THREE.Group;
  flame: EngineFlame;
  plume: EnginePlume;
  /** The Station controller flies the mesh the Station scene already moored at her berth. */
  existing: THREE.Object3D | null;
  ready: boolean;
  /** Tail offset along +z in holder space (nose is −z). */
  tail: number;
}

export interface NpcBodies {
  /** Create bodies for members that arrived and remove those that left. Cheap; call about once a second. */
  /** `findExisting` returns the hull the world already drew for this member, `null` when they have none, or "wait" while it is still loading. */
  sync: (present: readonly CastMember[], findExisting: (member: CastMember) => THREE.Object3D | null | "wait") => void;
  /** Move every body for this frame and return where each is, in world space. */
  update: (
    nowMs: number,
    dtMs: number,
    ctx: { reducedMotion: boolean; anchor: RoamAnchor | null; /** The Harbor Ring hub anchor (Station only): hub NPCs roam it, everyone else roams `anchor`. */ hubAnchor?: RoamAnchor | null; berth: PatrolBerth | null; /** People being talked to: they stop where they are and turn to face `faceToward` (presentation only — the clock is untouched, so they resume where it says they should be). */ hold?: ReadonlySet<string>; faceToward?: readonly [number, number, number] | null; /** People the owner stopped (the kill switch): they hold at their start point instead of flying. */ stopped?: ReadonlySet<string> },
  ) => NpcBodyFrame[];
  has: (id: string) => boolean;
  dispose: () => void;
}

const tmpV = new THREE.Vector3();

export function createNpcBodies(parent: THREE.Object3D): NpcBodies {
  const bodies = new Map<string, Body>();
  let disposed = false;

  const make = (member: CastMember, existing: THREE.Object3D | null): Body => {
    const holder = new THREE.Group();
    holder.name = `npc-${member.id}`;
    const flame = createEngineFlame(member.trail, { scale: 0.9 });
    const plume = createEnginePlume(member.trail, { scale: 0.8 });
    const body: Body = { member, holder, flame, plume, existing, ready: !!existing, tail: NPC_SHIP_LENGTH / 2 };
    parent.add(plume.group);
    if (existing) {
      // Her berthed mesh already exists (and turns with the Station's frame): the flame rides it.
      existing.add(flame.group);
      const geo = (existing as THREE.Mesh).geometry;
      geo?.computeBoundingBox();
      body.tail = geo?.boundingBox ? geo.boundingBox.max.z : body.tail;
      flame.group.position.set(0, 0, body.tail);
      return body;
    }
    holder.visible = false;
    parent.add(holder);
    if (member.shipUrl) {
      void loadStationAsset(member.shipUrl).then((loaded) => {
        if (!loaded || disposed || !bodies.has(member.id)) {
          if (loaded) disposeObject3D(loaded);
          return;
        }
        const box = new THREE.Box3().setFromObject(loaded);
        const size = box.getSize(new THREE.Vector3());
        const len = Math.max(0.001, size.z);
        const k = NPC_SHIP_LENGTH / len;
        const c = box.getCenter(new THREE.Vector3());
        loaded.position.sub(c); // centre the hull on the holder
        const wrap = new THREE.Group();
        wrap.scale.setScalar(k);
        wrap.add(loaded);
        holder.add(wrap);
        body.tail = NPC_SHIP_LENGTH / 2;
        flame.group.position.set(0, 0, body.tail);
        holder.add(flame.group);
        body.ready = true;
        holder.visible = true;
      });
    }
    return body;
  };

  return {
    sync(present, findExisting) {
      const want = new Set(present.filter((m) => !!m.shipUrl).map((m) => m.id));
      for (const [id, b] of bodies) {
        if (!want.has(id)) {
          b.plume.dispose();
          b.flame.dispose();
          if (b.existing) b.existing.visible = true; // she goes back to being the moored hull the Station drew
          b.holder.removeFromParent();
          disposeObject3D(b.holder);
          bodies.delete(id);
        }
      }
      for (const m of present) {
        if (!m.shipUrl || bodies.has(m.id)) continue;
        const ex = findExisting(m);
        if (ex === "wait") continue; // her moored hull is still loading: wait for it rather than drawing a second ship
        bodies.set(m.id, make(m, ex));
      }
    },
    update(nowMs, dtMs, ctx) {
      const out: NpcBodyFrame[] = [];
      for (const [id, b] of bodies) {
        if (!b.ready) continue;
        // Hub NPCs roam the Harbor Ring; everyone else roams the whole world.
        const anchor = anchorForNpc(id, ctx.anchor, ctx.hubAnchor ?? null);
        let phase: PatrolPhase | "roaming" = "roaming";
        if (b.existing && ctx.berth) {
          // The Station's own controller: docked → leaves → wanders her patrol → returns, in the Station's frame.
          const pose = patrolAt(nowMs, ctx.berth, { reducedMotion: ctx.reducedMotion, stopped: ctx.stopped?.has(id) });
          b.existing.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
          b.existing.rotation.y = pose.rotationY;
          phase = pose.phase;
          b.existing.updateWorldMatrix(true, false);
          tmpV.setFromMatrixPosition(b.existing.matrixWorld);
        } else if (anchor && ctx.stopped?.has(id)) {
          // Stopped (the kill switch): parked at their start point, not flying.
          const pose = roamAt(nowMs, id, anchor, { reducedMotion: ctx.reducedMotion, stopped: true });
          b.holder.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
          b.holder.rotation.y = pose.rotationY;
          b.holder.updateWorldMatrix(true, false);
          tmpV.setFromMatrixPosition(b.holder.matrixWorld);
          phase = "docked";
        } else if (anchor && ctx.hold?.has(id)) {
          // Stopped to talk: keep the place they were in, and turn toward the one speaking to them.
          if (ctx.faceToward) b.holder.rotation.y = Math.atan2(ctx.faceToward[0] - b.holder.position.x, ctx.faceToward[2] - b.holder.position.z) + Math.PI;
          b.holder.updateWorldMatrix(true, false);
          tmpV.setFromMatrixPosition(b.holder.matrixWorld);
          phase = "docked";
        } else if (anchor) {
          const pose = roamAt(nowMs, id, anchor, { reducedMotion: ctx.reducedMotion });
          b.holder.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
          b.holder.rotation.y = pose.rotationY;
          b.holder.updateWorldMatrix(true, false);
          tmpV.setFromMatrixPosition(b.holder.matrixWorld);
        } else continue;
        const moving = !ctx.reducedMotion && (phase === "roaming" || phase === "leaving" || phase === "patrolling" || phase === "returning");
        b.flame.setThrust(moving ? 0.55 : 0.1);
        // Exhaust: a point behind the tail along the ship's own axis, in world space.
        const obj = b.existing ?? b.holder;
        const exhaust = new THREE.Vector3(0, 0, b.tail + 1.5).applyMatrix4(obj.matrixWorld);
        b.plume.update(dtMs, moving ? exhaust : null);
        out.push({ id, pos: tmpV.clone(), phase });
      }
      return out;
    },
    has: (id) => bodies.has(id),
    dispose() {
      disposed = true;
      for (const b of bodies.values()) {
        b.plume.dispose();
        b.flame.dispose();
        if (b.existing) b.existing.visible = true;
        b.holder.removeFromParent();
        disposeObject3D(b.holder);
      }
      bodies.clear();
    },
  };
}

/** A roam anchor from a built world's own bounds: the middle of what is there, and a fence round most of it. */
export function anchorFromBounds(root: THREE.Object3D, exclude: readonly THREE.Object3D[] = []): RoamAnchor | null {
  const hidden = exclude.map((o) => [o, o.visible] as const);
  for (const [o] of hidden) o.visible = false;
  const box = new THREE.Box3().setFromObject(root);
  for (const [o, v] of hidden) o.visible = v;
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  // Every world is built round its own origin; the box's centre is dragged off by far-away backdrop pieces, so only its SIZE is used.
  const center = new THREE.Vector3(0, 0, 0);
  // Capped so a big world (the garden is ~1,800 across) still has its people pass within sight of where you stand.
  const radius = Math.max(140, Math.min(560, 0.5 * Math.hypot(size.x, size.z)));
  return { center: [center.x, center.y, center.z], radius };
}

export { PATROL_RADIUS };
