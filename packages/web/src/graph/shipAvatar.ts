import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { loadSoumayaShip } from "./soumayaShip.js";
import { buildProceduralShip } from "./transitScene.js";
import { glowTexture, heatColor, heatGlow } from "./shipHeat.js";
import { createEngineFlame } from "./enginePlume.js";
import type { V3 } from "./worldFlight.js";

/**
 * Her ship as the traveller's avatar inside a world (docs/specs/worlds-flight-2026-10-29.md): true size
 * (12 units nose to tail), the real hull when it has loaded (the procedural stand-in until then, and
 * forever if the load fails), and an engine glow whose colour is the engine heat.
 */
export interface ShipAvatar {
  group: THREE.Group;
  /** Position and heading. Her nose points down −z, so the yaw is turned half a revolution. */
  setPose: (pos: V3, yaw: number, pitch: number) => void;
  setHeat: (heat: number) => void;
  /** 0..1 thrust: the flame at the nozzle lengthens with it. */
  setThrust: (level: number) => void;
  /** The exhaust's world position (for the host's plume) — call after setPose. */
  exhaust: (out: THREE.Vector3) => THREE.Vector3;
  setTrail: (trail: string) => void;
  dispose: () => void;
}

export function createShipAvatar(trail = "blue"): ShipAvatar {
  const group = new THREE.Group();
  group.name = "ship-avatar";
  group.rotation.order = "YXZ";
  const body = new THREE.Group();
  // Hidden until her real hull is ready — nobody sees a placeholder. The procedural hull is the
  // load-FAILURE fallback only.
  body.visible = false;
  group.add(body);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fe8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  glow.name = "avatar-engine-glow";
  glow.position.set(0, 0, 7.5);
  body.add(glow);
  const flame = createEngineFlame(trail);
  flame.group.position.set(0, 0, 7.5);
  body.add(flame.group);

  let disposed = false;
  void loadSoumayaShip().then((hero) => {
    if (disposed) {
      if (hero) disposeObject3D(hero);
      return;
    }
    if (hero) body.add(hero);
    else {
      const stand = buildProceduralShip();
      stand.scale.setScalar(0.6); // modelled larger than her real hull
      body.add(stand);
    }
    body.visible = true;
  });

  const tmp = new THREE.Color();
  return {
    group,
    setPose(pos, yaw, pitch) {
      group.position.set(pos[0], pos[1], pos[2]);
      group.rotation.set(pitch, yaw + Math.PI, 0);
    },
    setHeat(h) {
      heatColor(h, tmp);
      (glow.material as THREE.SpriteMaterial).color.copy(tmp);
      const g = heatGlow(h);
      glow.scale.setScalar(g.scale);
      (glow.material as THREE.SpriteMaterial).opacity = g.opacity;
    },
    setThrust: (level) => flame.setThrust(level),
    exhaust: (out) => out.set(0, 0, 8.5).applyMatrix4(group.matrixWorld),
    setTrail: (t) => flame.setTrail(t),
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
