import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";

/**
 * The Sun — the gigantic star at the center of the galaxy that every cluster
 * revolves around. It is NOT a memory: it's the fixed heart of the system at the
 * origin. Memories render at ~2–16 world units, so the sun (hundreds of units)
 * dwarfs everything — the sun-to-earth scale the user asked for.
 *
 * Role (provisional): the user's "core self". It grows a little as the brain grows
 * but is hard-clamped so it can never overgrow and look ridiculous.
 */
export const SUN_RADIUS = 460; // base render radius (world units)
export const SUN_RADIUS_MAX = 600; // clamp — orbits clear THIS so bodies never clip the sun

/**
 * Make one of the sun model's glTF materials safe to render, in both senses.
 *
 * `envMapIntensity = 0`: the sun reads as uniformly self-luminous, never as a reflective
 * studio object. With the scene-wide PMREM environment map applied, its PBR materials were
 * catching a visible reflected highlight from the environment's room geometry (the reported
 * "square block of light" on the sun). Other bodies still get the ambient sheen.
 *
 * `transmission = 0` — THE CRITICAL ONE. `sun.glb` ships `KHR_materials_transmission` with
 * `transmissionFactor: 1`, which `GLTFLoader` maps onto `MeshPhysicalMaterial.transmission`.
 * In three.js, ANY material with `transmission > 0` diverts the entire frame through
 * `renderTransmissionPass()`: a full-resolution multisampled half-float render target that
 * is cleared, has the scene background drawn into it, has EVERY opaque object re-rendered
 * into it, is then MSAA-resolved and has a complete mipmap chain regenerated — all inside
 * `renderer.render()`, before the visible frame is drawn at all. The sun is the only
 * transmissive object in the galaxy, so this single material was buying that whole pass for
 * the entire scene, on every frame, at every graphics tier, with no setting able to turn it
 * off. The sun still reads correctly without it: the material stays emissive, and the sun
 * keeps its additive corona sprite and its own point light.
 *
 * See docs/specs/soumaya-galaxy-large-render-forensic-audit.md.
 */
export function neutralizeSunMaterial(mat: THREE.Material): void {
  const m = mat as THREE.MeshPhysicalMaterial;
  if ("envMapIntensity" in m) m.envMapIntensity = 0;
  if ("transmission" in m && m.transmission > 0) m.transmission = 0;
}

export function makeSun(): THREE.Object3D {
  const group = new THREE.Group();
  let currentRadius = SUN_RADIUS;

  // Procedural glowing fallback until the glTF loads (and a base for the corona).
  const fallback = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({ color: "#ffcf6b" }),
  );
  fallback.scale.setScalar(SUN_RADIUS);
  group.add(fallback);

  // Soft additive corona so the sun reads as a luminous body, not a flat ball.
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 58);
  g.addColorStop(0, "rgba(255,240,200,0.9)");
  g.addColorStop(0.35, "rgba(255,180,90,0.45)");
  g.addColorStop(1, "rgba(255,140,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  corona.scale.setScalar(SUN_RADIUS * 3.2);
  group.add(corona);

  // The sun is the system's primary light source (calmer than before).
  const light = new THREE.PointLight(new THREE.Color("#fff2d0"), 1.6, 0, 1.5);
  group.add(light);

  let mixer: THREE.AnimationMixer | null = null;
  let model: THREE.Object3D | null = null;
  let baseModelScale = 1;
  let last = 0;
  let spin = 0;
  // Focus dim: fade the sun's glow when the camera focuses a body so it can't blind.
  let dimTarget = 1;
  let dim = 1;
  const CORONA_OPACITY = 0.7;
  // Flare: a brief eruption when Soumaya flings a discarded memory into the sun.
  let flareT = 0;

  gltfLoader().load(
    "/sun.glb",
    (gltf) => {
      model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const dim2 = new THREE.Vector3();
      box.getSize(dim2);
      const maxDim = Math.max(dim2.x, dim2.y, dim2.z) || 1;
      baseModelScale = (currentRadius * 2) / maxDim; // diameter = 2 * radius
      model.scale.setScalar(baseModelScale);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.copy(center.multiplyScalar(-baseModelScale)); // recenter
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        mixer.timeScale = 0.08; // the baked clip spins fast — slow it way down
        for (const clip of gltf.animations) mixer.clipAction(clip).play();
      }
      model.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) neutralizeSunMaterial(m);
      });
      fallback.visible = false;
      group.add(model);
      applyRadius();
    },
    undefined,
    (err) => {
      console.warn("[sun] model failed to load; using glowing fallback", err);
      noteModelFallback("The Sun model");
    },
  );

  const applyRadius = () => {
    fallback.scale.setScalar(currentRadius);
    corona.scale.setScalar(currentRadius * 2.8);
    light.intensity = (1.2 + (currentRadius / SUN_RADIUS_MAX) * 0.6) * dim;
    if (model) {
      // Re-fit the model to the current radius (baseModelScale was for SUN_RADIUS).
      model.scale.setScalar(baseModelScale * (currentRadius / SUN_RADIUS));
    }
  };

  // Core-self sizing: grow gently with brain size, hard-clamped so it never bloats.
  group.userData.setBrainScale = (count: number) => {
    const t = Math.min(1, Math.log10(Math.max(1, count)) / 2.5); // saturates ~300 memories
    const target = SUN_RADIUS + (SUN_RADIUS_MAX - SUN_RADIUS) * t;
    if (Math.abs(target - currentRadius) > 1) {
      currentRadius = target;
      applyRadius();
    }
  };

  // Called by Graph3D: dim the sun's glow while focusing/zoomed into a body.
  group.userData.setFocusDim = (on: boolean) => {
    dimTarget = on ? 0.25 : 1;
  };

  // The sun's current world radius (so the ship knows where its surface is).
  // Erupt: a brief corona + light flare when a memory is consumed by the sun.
  group.userData.flare = (): void => {
    flareT = 1;
  };

  group.userData.update = (time: number) => {
    const dt = last ? Math.min(0.05, time - last) : 0;
    last = time;
    mixer?.update(dt);
    spin += dt * 0.015; // slow, ponderous rotation
    if (model) model.rotation.y = spin;
    else fallback.rotation.y = spin;
    // Ease the focus-dim and apply to corona opacity + light.
    if (Math.abs(dim - dimTarget) > 0.01) {
      dim += (dimTarget - dim) * Math.min(1, dt * 4);
      (corona.material as THREE.SpriteMaterial).opacity = CORONA_OPACITY * dim;
      light.intensity = (1.2 + (currentRadius / SUN_RADIUS_MAX) * 0.6) * Math.max(0.4, dim);
    }
    // Consumption flare: erupt the corona + light briefly, then settle back.
    if (flareT > 0) {
      flareT = Math.max(0, flareT - dt * 1.1);
      const fb = flareT; // 1 → 0
      corona.scale.setScalar(currentRadius * (2.8 + fb * 1.6));
      (corona.material as THREE.SpriteMaterial).opacity = Math.min(1, CORONA_OPACITY * dim * (1 + fb * 2.2));
      light.intensity = (1.2 + (currentRadius / SUN_RADIUS_MAX) * 0.6) * Math.max(0.4, dim) * (1 + fb * 2.5);
      if (flareT === 0) applyRadius(); // restore baseline corona scale + light
    }
  };

  return group;
}
