import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/**
 * Shared glTF loader, configured once for the whole app.
 *
 * Why this exists: some of our models (e.g. aura-satellite.glb) are exported with
 * KHR_draco_mesh_compression. A bare GLTFLoader has no Draco decoder, so it throws
 * on load — the model silently falls back to its procedural stand-in (right shape,
 * but none of the real textures/designs). We attach a DRACOLoader pointing at the
 * decoder we bundle in /public/draco (served as static assets, so it works offline
 * and behind any network policy — no CDN dependency). WebP textures
 * (EXT_texture_webp) are handled by three's GLTFLoader natively.
 *
 * The decoder is only fetched the first time a Draco mesh is actually decoded, so
 * non-Draco models (ship, station) pay nothing.
 *
 * KTX2 (Basis Universal / KHR_texture_basisu): our hero models' textures are baked
 * to KTX2/UASTC so they upload to the GPU already block-compressed instead of as
 * raw decoded RGBA — the actual VRAM cost of a texture (not just its download size)
 * drops by roughly 4-6x. `KTX2Loader.detectSupport(renderer)` is a SYNCHRONOUS
 * capability query (which GPU compressed-texture formats this device supports) that
 * must run before any KTX2-containing model loads, so `ensureKtx2Support` is called
 * once from Graph3D.tsx as early as the renderer exists — before any of the other
 * modules that call `gltfLoader()` (sun/satellites/soumaya/etc.) get a chance to.
 * If that ordering were ever violated (e.g. a future call site loading a model
 * before Graph3D finishes its own setup), every one of those `.load()` calls already
 * has an error callback that falls back to a procedural stand-in — the same
 * resilience path that already covers a slow network or a decode failure — so this
 * degrades gracefully rather than throwing into the void.
 */
let loader: GLTFLoader | null = null;
let ktx2: KTX2Loader | null = null;

export function gltfLoader(): GLTFLoader {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  if (ktx2) loader.setKTX2Loader(ktx2);
  return loader;
}

/**
 * IM-24 — model-fallback registry. A glTF that fails to load used to swap to
 * its procedural stand-in with only a console line, so the user saw a pop
 * (or a permanently simpler object) with no explanation anywhere. Callers
 * now record the failure here; Settings → diagnostics surfaces it as a
 * visible note via getModelFallbacks(), and the "brain-model-fallback"
 * window event lets an already-open surface refresh.
 */
const modelFallbacks: string[] = [];

export function noteModelFallback(asset: string): void {
  if (!modelFallbacks.includes(asset)) modelFallbacks.push(asset);
  try {
    window.dispatchEvent(new CustomEvent("brain-model-fallback"));
  } catch {
    /* no window (tests / SSR) — the registry itself still holds the note */
  }
}

export function getModelFallbacks(): string[] {
  return [...modelFallbacks];
}

/**
 * IM-24 — soften a model swap-in: fade the loaded model in over ~0.6s
 * instead of popping it in, hiding the procedural fallback once the model
 * is mostly visible (a crossfade, not a cut). Materials are set transparent
 * for the fade and restored afterwards. Never throws — a failed fade still
 * leaves the model fully visible.
 */
export function fadeSwapIn(model: THREE.Object3D, hideFallback: () => void): void {
  try {
    const mats = new Set<THREE.Material>();
    model.traverse((o: any) => {
      const m = o?.material;
      if (Array.isArray(m)) m.forEach((x) => x && mats.add(x));
      else if (m) mats.add(m);
    });
    // Capture each material's resting state BEFORE zeroing opacity.
    const saved = [...mats].map((m) => ({ m, transparent: m.transparent, target: m.opacity }));
    for (const s of saved) {
      s.m.transparent = true;
      s.m.opacity = 0;
    }
    const DURATION = 600;
    const start = performance.now();
    let hidFallback = false;
    const stepFn = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      for (const s of saved) s.m.opacity = s.target * t;
      if (t >= 0.5 && !hidFallback) {
        hidFallback = true;
        hideFallback();
      }
      if (t < 1) {
        requestAnimationFrame(stepFn);
      } else {
        for (const s of saved) {
          s.m.opacity = s.target;
          s.m.transparent = s.transparent;
        }
      }
    };
    requestAnimationFrame(stepFn);
  } catch {
    try {
      hideFallback();
    } catch {
      /* ignore */
    }
  }
}

/** Call once, as early as a renderer exists (see gltfLoader's doc comment for why). */
export function ensureKtx2Support(renderer: THREE.WebGLRenderer): void {
  if (!ktx2) {
    ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath("/basis/");
  }
  ktx2.detectSupport(renderer);
  gltfLoader().setKTX2Loader(ktx2);
}

