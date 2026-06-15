import { EMBED_DIM } from "../db/vec.js";

/**
 * EmbeddingProvider is the seam that lets us run embeddings locally (default,
 * private, free) now and flip to a cloud embedding API later via config — the
 * rest of the system only depends on this interface.
 *
 * All providers MUST return L2-normalized vectors of length `dim`, and `dim`
 * MUST equal EMBED_DIM (the fixed vec0 column width).
 */
export interface EmbeddingProvider {
  readonly dim: number;
  readonly model: string;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export type EmbeddingProviderKind = "local" | "hash";

/**
 * Construct the configured embedding provider. Defaults to local transformers.js
 * (lazy-loaded so tests/offline can use the dependency-free hash provider
 * without pulling onnxruntime).
 */
export async function createEmbeddingProvider(
  kind: EmbeddingProviderKind = (process.env.EMBED_PROVIDER as EmbeddingProviderKind) ?? "local",
): Promise<EmbeddingProvider> {
  if (kind === "hash") {
    const { HashEmbeddingProvider } = await import("./hash.js");
    return new HashEmbeddingProvider(EMBED_DIM);
  }
  try {
    const { LocalEmbeddingProvider } = await import("./local.js");
    const provider = new LocalEmbeddingProvider();
    await provider.warm();
    return provider;
  } catch (err) {
    // No model/network available: degrade to the deterministic hash provider
    // so the pipeline still works end-to-end.
    console.warn(
      `[embeddings] local provider unavailable (${(err as Error).message}); ` +
        `falling back to hash embeddings.`,
    );
    const { HashEmbeddingProvider } = await import("./hash.js");
    return new HashEmbeddingProvider(EMBED_DIM);
  }
}

/** L2-normalize in place and return. Shared helper for providers. */
export function normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm;
  return vec;
}
