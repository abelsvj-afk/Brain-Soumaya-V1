import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBED_DIM } from "../db/vec.js";
import type { EmbeddingProvider } from "./adapter.js";

const MODEL = process.env.EMBED_MODEL ?? "Xenova/all-MiniLM-L6-v2";

// Allow baking the model into the image: point the cache at a fixed dir at build
// time (see warm.ts + Dockerfile) and reuse it offline at runtime.
if (process.env.EMBED_CACHE_DIR) {
  env.cacheDir = process.env.EMBED_CACHE_DIR;
}

/**
 * Server-side local embeddings via transformers.js. Uses mean pooling +
 * normalization so output vectors are unit-length (cosine == inner product),
 * matching the vec0 cosine metric. The model is downloaded + cached on first use.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dim = EMBED_DIM;
  readonly model = MODEL;
  private extractor: FeatureExtractionPipeline | null = null;

  async warm(): Promise<void> {
    if (!this.extractor) {
      this.extractor = await pipeline("feature-extraction", MODEL);
    }
  }

  private async run(texts: string[]): Promise<Float32Array[]> {
    await this.warm();
    const out = await this.extractor!(texts, { pooling: "mean", normalize: true });
    const data = out.data as Float32Array;
    const dim = out.dims[out.dims.length - 1]!;
    if (dim !== this.dim) {
      throw new Error(
        `Model ${MODEL} produced dim ${dim} but EMBED_DIM is ${this.dim}. ` +
          `Set EMBED_DIM to match and re-embed.`,
      );
    }
    const result: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(new Float32Array(data.subarray(i * dim, (i + 1) * dim)));
    }
    return result;
  }

  async embed(text: string): Promise<Float32Array> {
    return (await this.run([text]))[0]!;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.run(texts);
  }
}
