import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Local text embeddings for the matcher's candidate search and for lookup. */
export interface Embedder {
  readonly model: string;
  readonly dims: number;
  /**
   * The cosine this model gives two texts that have nothing to do with each other. Models differ a
   * lot here, so how related two texts are is counted from this up (`relatedness`), never read off
   * the raw cosine.
   */
  readonly floor: number;
  /**
   * How related (0 to 1, see `relatedness`) an existing idea has to be to go to the matcher as
   * possibly the same idea. Set per model, from what it gives two wordings of one idea; the matcher
   * decides, so the bar is low rather than high.
   */
  readonly sameIdeaBar: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
/**
 * The model was trained with a marker in front of every text. "query: " is the one for comparing
 * texts of the same kind (an idea with an idea, a question with an idea); without it results get worse.
 */
const MARKER = 'query: ';

/**
 * multilingual-e5-small through transformers.js (library Apache-2.0; model weights MIT, from
 * intfloat/multilingual-e5-small, converted for transformers.js). About a hundred languages, so a
 * German source matches an English one; 384 dimensions like the English-only model before it.
 * Downloads once into the cache dir (the 8-bit weights, about 120 MB). Sentences are the mean of
 * their tokens, normalized, as the model card says.
 */
export class TransformersEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL;
  readonly dims = 384;
  /** Its cosines sit between about 0.7 and 1 (it was trained that way); unrelated texts get about 0.75. */
  readonly floor = 0.75;
  /** A cosine of about 0.825: two wordings of one idea, also across languages, sit above it. */
  readonly sameIdeaBar = 0.3;
  private pipe: Promise<(texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>> | null = null;

  constructor(private readonly cacheDir: string) {}

  private load() {
    if (!this.pipe) {
      this.pipe = import('@huggingface/transformers').then(async (t) => {
        t.env.cacheDir = this.cacheDir;
        // the English-only model used before is no longer read: its download can go
        await rm(join(this.cacheDir, 'Xenova', 'bge-small-en-v1.5'), { recursive: true, force: true }).catch(() => undefined);
        const pipeline = await t.pipeline('feature-extraction', this.model, { dtype: 'q8' });
        return (texts, opts) => pipeline(texts, opts) as Promise<{ tolist(): number[][] }>;
      });
    }
    return this.pipe;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const run = await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((text) => `${MARKER}${text}`);
      const result = await run(batch, { pooling: 'mean', normalize: true });
      for (const row of result.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }
}

/**
 * Deterministic bag-of-words hashing embedder for tests: texts that share words are similar, with no
 * network and no model. 64 dimensions, L2-normalized.
 */
export class FakeEmbedder implements Embedder {
  readonly model = 'fake-hash-64';
  readonly dims = 64;
  readonly floor = 0;
  readonly sameIdeaBar = 0.55;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => hashEmbed(t, this.dims));
  }
}

export function hashEmbed(text: string, dims: number): Float32Array {
  const v = new Float32Array(dims);
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  for (const w of words) {
    const h = createHash('sha1').update(w).digest();
    const idx = h.readUInt16BE(0) % dims;
    const sign = h[2] !== undefined && h[2] % 2 === 0 ? 1 : -1;
    v[idx] = (v[idx] as number) + sign;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i += 1) v[i] = (v[i] as number) / norm;
  return v;
}

export function textHash(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}
