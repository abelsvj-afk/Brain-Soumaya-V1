import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export interface BloomOptions {
  strength?: number;
  radius?: number;
  threshold?: number;
}

/**
 * Add the neon-glow bloom pass to react-force-graph-3d's post-processing
 * composer. Must be called after the first render (when the composer exists).
 * Pin Three.js to the version 3d-force-graph expects (handled by package.json).
 */
export function addBloom(
  fg: {
    postProcessingComposer: () => { addPass: (p: unknown) => void } | undefined;
    renderer: () => THREE.WebGLRenderer;
  },
  opts: BloomOptions = {},
): UnrealBloomPass | null {
  const composer = fg.postProcessingComposer();
  if (!composer) return null;
  const size = fg.renderer().getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(
    size,
    opts.strength ?? 0.28,
    opts.radius ?? 0.5,
    // UX review #5: 0.7 let mid-bright surfaces (nebulae, labels' white text) bloom
    // into a haze; only genuinely bright cores glow now.
    opts.threshold ?? 0.82,
  );
  composer.addPass(bloom);
  return bloom; // returned so callers can ramp .strength (e.g. focus-dim)
}
