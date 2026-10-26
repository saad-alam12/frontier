/** Cosine similarity over normalized vectors, and a brute-force top-k (fine for thousands of nodes). */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function topK<T>(query: Float32Array, items: { id: T; vector: Float32Array }[], k: number, minScore = 0): { id: T; score: number }[] {
  const scored: { id: T; score: number }[] = [];
  for (const item of items) {
    const score = cosine(query, item.vector);
    if (score >= minScore) scored.push({ id: item.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Simple fuzzy name match: token overlap (Jaccard) after lowercasing. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}
