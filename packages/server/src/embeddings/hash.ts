import { normalize, type EmbeddingProvider } from "./adapter.js";

/**
 * Deterministic, dependency-free embedding provider. Hashes word tokens into a
 * fixed-width bag-of-words vector, then L2-normalizes. Texts that share tokens
 * produce similar vectors, so associative linking still works — used for tests
 * and as an offline/no-model fallback. NOT semantically strong; the local
 * transformers.js provider is the real default.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly model = "hash-bow";
  constructor(readonly dim: number) {}

  private hashEmbed(text: string): Float32Array {
    const v = new Float32Array(this.dim);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    for (const tok of tokens) {
      let h = 2166136261; // FNV-1a
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % this.dim;
      const sign = (h & 1) === 0 ? 1 : -1;
      v[idx] = v[idx]! + sign;
    }
    return normalize(v);
  }

  async embed(text: string): Promise<Float32Array> {
    return this.hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.hashEmbed(t));
  }
}
