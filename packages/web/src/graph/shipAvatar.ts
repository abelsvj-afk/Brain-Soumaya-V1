import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { loadSoumayaShip } from "./soumayaShip.js";
import { buildProceduralShip } from "./transitScene.js";
import { glowTexture, heatColor, heatGlow } from "./shipHeat.js";
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
  dispose: () => void;
}

export function createShipAvatar(): ShipAvatar {
  const group = new THREE.Group();
  group.name = "ship-avatar";
  group.rotation.order = "YXZ";
  const body = new THREE.Group();
  const stand = buildProceduralShip();
  stand.scale.setScalar(0.6); // modelled larger than her real hull
  body.add(stand);
  group.add(body);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fe8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  glow.name = "avatar-engine-glow";
  glow.position.set(0, 0, 7.5);
  body.add(glow);

  let disposed = false;
  void loadSoumayaShip().then((hero) => {
    if (!hero || disposed) {
      if (hero) disposeObject3D(hero);
      return;
    }
    body.remove(stand);
    disposeObject3D(stand);
    body.add(hero);
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
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
