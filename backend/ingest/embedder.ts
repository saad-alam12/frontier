import { createHash } from 'node:crypto';

/** Local text embeddings for the matcher's candidate search and for lookup. */
export interface Embedder {
  readonly model: string;
  readonly dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

/** bge-small-en-v1.5 through transformers.js (Apache-2.0; model weights MIT). Downloads once into the cache dir. */
export class TransformersEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL;
  readonly dims = 384;
  private pipe: Promise<(texts: string[], opts: { pooling: 'cls'; normalize: boolean }) => Promise<{ tolist(): number[][] }>> | null = null;

  constructor(private readonly cacheDir: string) {}

  private load() {
    if (!this.pipe) {
      this.pipe = import('@huggingface/transformers').then(async (t) => {
        t.env.cacheDir = this.cacheDir;
        const pipeline = await t.pipeline('feature-extraction', this.model, { dtype: 'fp32' });
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
      const batch = texts.slice(i, i + 16);
      const result = await run(batch, { pooling: 'cls', normalize: true });
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

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => hashEmbed(t, this.dims));
  }
}

export function hashEmbed(text: string, dims: number): Float32Array {
  const v = new Float32Array(dims);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
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
