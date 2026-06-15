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
): void {
  const composer = fg.postProcessingComposer();
  if (!composer) return;
  const size = fg.renderer().getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(
    size,
    opts.strength ?? 1.7,
    opts.radius ?? 0.85,
    opts.threshold ?? 0.08,
  );
  composer.addPass(bloom);
}
