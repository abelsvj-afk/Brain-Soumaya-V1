import { LocalEmbeddingProvider } from "./local.js";

/**
 * Build-time warm-up: downloads the embedding model into EMBED_CACHE_DIR so it
 * can be baked into the Docker image and loaded offline at runtime. Uses the
 * local provider directly (no hash fallback) so the build fails loudly if the
 * model can't be fetched.
 */
const provider = new LocalEmbeddingProvider();
const v = await provider.embed("warmup");
console.log(`[warm] cached ${provider.model} (${v.length}d) -> ${process.env.EMBED_CACHE_DIR ?? "default cache"}`);
