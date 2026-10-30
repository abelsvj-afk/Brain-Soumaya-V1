import * as THREE from "three";
import { glowTexture } from "./shipHeat.js";
import type { V3 } from "./worldFlight.js";

/**
 * Her engine in every place (owner 2026-10-30: "the colour and flame that come off her ship in her brain should come off in the other worlds
 * and in the warp too"). At home the ship leaves a world-space plume of soft additive puffs tinted by the trail colour she wears
 * (soumaya.ts); the worlds and the warp only had a single glow. Two pieces here, shared by the world flight avatar, the garden walk,
 * the warp ship and the NPC ships:
 *  - a PLUME: world-space puffs dropped along the path the exhaust travels, fading where they were born (the trail left behind);
 *  - a FLAME: a short stretched glow attached to the tail that lengthens with thrust (the flame at the nozzle).
 */

/** The four trails she can wear — the same tints as the home galaxy's (soumaya.ts setTrailColor). */
export const TRAIL_TINTS: Readonly<Record<string, number>> = {
  blue: 0xb5dcff,
  neon: 0xff4099,
  gold: 0xffc733,
  purple: 0xb38cff,
};

export function trailTint(trail: string | undefined, out = new THREE.Color()): THREE.Color {
  return out.set(TRAIL_TINTS[trail ?? "blue"] ?? TRAIL_TINTS.blue!);
}

export const PLUME_POOL = 40;
export const PLUME_LIFE_S = 0.55;
export const PLUME_STEP = 3.2;

/**
 * Where to drop puffs for an exhaust that moved from `last` to `exhaust`: one every `step` along the segment (so a fast streak stays
 * continuous), at most `max` per frame, and none across a teleport (a jump bigger than 24 steps restarts the trail instead of streaking
 * across the void). Pure so it is unit-tested.
 */
export function plumePuffs(last: V3 | null, exhaust: V3, step = PLUME_STEP, max = PLUME_POOL): { points: V3[]; last: V3 } {
  if (!last) return { points: [], last: exhaust };
  const dx = exhaust[0] - last[0];
  const dy = exhaust[1] - last[1];
  const dz = exhaust[2] - last[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > step * 24) return { points: [], last: exhaust };
  const points: V3[] = [];
  let cur: V3 = last;
  let remaining = d;
  while (remaining >= step && points.length < max) {
    const k = step / remaining;
    cur = [cur[0] + (exhaust[0] - cur[0]) * k, cur[1] + (exhaust[1] - cur[1]) * k, cur[2] + (exhaust[2] - cur[2]) * k];
    points.push(cur);
    remaining -= step;
  }
  return { points, last: cur };
}

export interface EnginePlume {
  /** Add to the SCENE (not the ship): the puffs live in world space. */
  group: THREE.Group;
  /** Call every frame with the exhaust's world position, or null while the ship is hidden/parked-away. */
  update: (dtMs: number, exhaust: THREE.Vector3 | null) => void;
  setTrail: (trail: string) => void;
  dispose: () => void;
}

export function createEnginePlume(trail = "blue", opts: { scale?: number } = {}): EnginePlume {
  const scale = opts.scale ?? 1;
  const tex = glowTexture();
  const group = new THREE.Group();
  group.name = "engine-plume";
  group.frustumCulled = false;
  const tint = trailTint(trail);
  const puffs = Array.from({ length: PLUME_POOL }, () => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color: tint.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }),
    );
    s.visible = false;
    s.raycast = () => {};
    group.add(s);
    return { sprite: s, life: 0 };
  });
  let last: V3 | null = null;
  return {
    group,
    update(dtMs, exhaust) {
      const dt = Math.max(0, dtMs) / 1000;
      if (exhaust) {
        const r = plumePuffs(last, [exhaust.x, exhaust.y, exhaust.z]);
        last = r.last;
        for (const p of r.points) {
          const free = puffs.find((q) => q.life <= 0) ?? puffs.reduce((a, b) => (a.life < b.life ? a : b));
          free.life = PLUME_LIFE_S;
          free.sprite.position.set(p[0], p[1], p[2]);
          free.sprite.visible = true;
        }
      } else {
        last = null; // hidden or away: the next sighting starts a fresh trail
      }
      for (const p of puffs) {
        if (p.life <= 0) {
          if (p.sprite.visible) p.sprite.visible = false;
          continue;
        }
        p.life -= dt;
        const k = Math.max(0, p.life / PLUME_LIFE_S);
        (p.sprite.material as THREE.SpriteMaterial).opacity = 0.7 * k;
        const sc = (7 + (1 - k) * 7) * scale;
        p.sprite.scale.set(sc, sc, 1);
        if (p.life <= 0) p.sprite.visible = false;
      }
    },
    setTrail(t) {
      trailTint(t, tint);
      for (const p of puffs) (p.sprite.material as THREE.SpriteMaterial).color.copy(tint);
    },
    dispose() {
      for (const p of puffs) (p.sprite.material as THREE.SpriteMaterial).dispose();
      tex.dispose();
      group.removeFromParent();
    },
  };
}

export interface EngineFlame {
  /** Attach to the ship at its tail; the flame trails along +z (her nose points −z). */
  group: THREE.Group;
  /** 0..1 thrust: 0 is a bare glow, 1 a long bright flame. */
  setThrust: (level: number) => void;
  setTrail: (trail: string) => void;
  dispose: () => void;
}

const FLAME_SEGMENTS = 4;

export function createEngineFlame(trail = "blue", opts: { scale?: number } = {}): EngineFlame {
  const scale = opts.scale ?? 1;
  const tex = glowTexture();
  const group = new THREE.Group();
  group.name = "engine-flame";
  const tint = trailTint(trail);
  const segs = Array.from({ length: FLAME_SEGMENTS }, () => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color: tint.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }),
    );
    s.raycast = () => {};
    group.add(s);
    return s;
  });
  const apply = (level: number) => {
    const t = Math.min(1, Math.max(0, level));
    segs.forEach((s, i) => {
      const f = i / (FLAME_SEGMENTS - 1); // 0 at the nozzle, 1 at the tip
      s.position.set(0, 0, (1 + i * 2.6 * (0.4 + t)) * scale);
      const size = (6 - f * 3.2) * (0.5 + 0.9 * t) * scale;
      s.scale.set(size, size, 1);
      (s.material as THREE.SpriteMaterial).opacity = (0.9 - f * 0.55) * Math.min(1, 0.25 + t);
    });
  };
  apply(0);
  return {
    group,
    setThrust: apply,
    setTrail(t) {
      trailTint(t, tint);
      for (const s of segs) (s.material as THREE.SpriteMaterial).color.copy(tint);
    },
    dispose() {
      for (const s of segs) (s.material as THREE.SpriteMaterial).dispose();
      tex.dispose();
      group.removeFromParent();
    },
  };
}
