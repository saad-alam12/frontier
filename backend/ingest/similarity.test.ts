import { describe, expect, it } from 'vitest';
import { fuzzyScore } from '../services/lookup';
import { FakeEmbedder, hashEmbed } from './embedder';
import { cosine, nameSimilarity, relatedness, topK } from './similarity';

describe('how related two texts are', () => {
  it('counts similarity from the cosine the model gives unrelated texts', () => {
    // a model whose cosines start at 0: relatedness is the cosine
    expect(relatedness(0.55, 0)).toBeCloseTo(0.55);
    // a model whose cosines sit between 0.75 and 1: unrelated is 0, the same is 1
    expect(relatedness(0.75, 0.75)).toBe(0);
    expect(relatedness(0.7, 0.75)).toBe(0);
    expect(relatedness(0.875, 0.75)).toBeCloseTo(0.5);
    expect(relatedness(1, 0.75)).toBe(1);
  });

  it('ranks by relatedness and leaves out what is below the bar', () => {
    const v = (text: string) => hashEmbed(text, 64);
    const items = [
      { id: 'same', vector: v('nash equilibrium strategy profile') },
      { id: 'near', vector: v('nash equilibrium of a game') },
      { id: 'far', vector: v('photosynthesis in green plants') },
    ];
    const hits = topK(v('nash equilibrium strategy profile'), items, 5, 0.3, new FakeEmbedder().floor);
    expect(hits.map((h) => h.id)).toEqual(['same', 'near']);
    expect(hits[0]?.score).toBeCloseTo(1);
    expect(cosine(items[0]?.vector as Float32Array, items[2]?.vector as Float32Array)).toBeLessThan(0.3);
  });
});

describe('matching names in any language', () => {
  it('keeps letters with accents and umlauts whole', () => {
    expect(nameSimilarity('Lösung eines Spiels', 'Lösung eines Spiels')).toBe(1);
    expect(nameSimilarity('Gemischte Strategie', 'gemischte strategie (Spieltheorie)')).toBeCloseTo(2 / 3);
    // "Lösung" and "Losung" are different words, not both "l" and "sung"
    expect(nameSimilarity('Lösung', 'Losung')).toBe(0);
    expect(nameSimilarity('équilibre de Nash', 'Nash équilibre')).toBeCloseTo(2 / 3);
  });

  it('finds a German idea by its name, a prefix of it, or its name inside a question', () => {
    expect(fuzzyScore('Übergangsmatrix', ['Übergangsmatrix'])).toBe(1);
    expect(fuzzyScore('überg', ['Übergangsmatrix'])).toBeGreaterThan(0.5);
    expect(fuzzyScore('was ist eine Übergangsmatrix?', ['Übergangsmatrix'])).toBeGreaterThanOrEqual(0.45);
    // the name inside another word is not the name
    expect(fuzzyScore('Vorübergangsmatrixen', ['übergangsmatrix'])).toBeLessThan(0.9);
  });

  it('gives a test embedding to words in any alphabet', () => {
    const [a, b, c] = [hashEmbed('Lösung eines Gleichungssystems', 64), hashEmbed('Gleichungssystems Lösung', 64), hashEmbed('Photosynthese der Pflanzen', 64)];
    expect(cosine(a, b)).toBeGreaterThan(0.6);
    expect(cosine(a, c)).toBeLessThan(0.3);
  });
});
