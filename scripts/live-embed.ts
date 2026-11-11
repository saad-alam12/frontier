/**
 * Live check of the local model for "search by meaning": `npm run live:embed`. It downloads the
 * model into ./models-cache on first use (about 120 MB), embeds a few pairs of texts in English and
 * German and prints how close the model puts them. Use it after changing the model, to see that it
 * loads and that the two numbers in `TransformersEmbedder` fit it: `floor` (what unrelated texts
 * get) and `sameIdeaBar` (from where an idea is shown to the matcher as possibly the same).
 */
import { resolve } from 'node:path';
import { TransformersEmbedder } from '../backend/ingest/embedder';
import { cosine, relatedness } from '../backend/ingest/similarity';

const PAIRS: { kind: 'same' | 'near' | 'unrelated'; a: string; b: string }[] = [
  { kind: 'same', a: 'Nash equilibrium: A strategy profile in which no player can gain by changing only their own strategy.', b: 'Nash-Gleichgewicht: Ein Strategieprofil, bei dem kein Spieler sich verbessern kann, indem er allein seine Strategie ändert.' },
  { kind: 'same', a: 'Best response: A strategy that maximizes a player\'s payoff given the strategies of the others.', b: 'Beste Antwort: Eine Strategie, die die Auszahlung eines Spielers maximiert, gegeben die Strategien der anderen.' },
  { kind: 'same', a: 'Gradient descent: Repeatedly step against the gradient of the loss to reduce it.', b: 'Gradient descent lowers a loss by moving the parameters a small step in the direction of steepest decrease, again and again.' },
  { kind: 'same', a: 'Eigenwert: Eine Zahl λ, für die es einen Vektor v ≠ 0 mit Av = λv gibt.', b: 'Eigenvalue: A scalar λ such that Av = λv for some nonzero vector v.' },
  { kind: 'near', a: 'Nash equilibrium: A strategy profile in which no player can gain by changing only their own strategy.', b: 'Strictly dominant strategy: A strategy that beats every other strategy of the same player whatever the others do.' },
  { kind: 'near', a: 'Eigenwert: Eine Zahl λ, für die es einen Vektor v ≠ 0 mit Av = λv gibt.', b: 'Determinante: Eine Zahl, die angibt, wie eine Matrix Volumen streckt.' },
  { kind: 'unrelated', a: 'Nash equilibrium: A strategy profile in which no player can gain by changing only their own strategy.', b: 'Photosynthese: Pflanzen wandeln Licht, Wasser und Kohlendioxid in Zucker und Sauerstoff um.' },
  { kind: 'unrelated', a: 'Gradient descent: Repeatedly step against the gradient of the loss to reduce it.', b: 'The French Revolution began in 1789 with the storming of the Bastille.' },
];

const embedder = new TransformersEmbedder(resolve('models-cache'));
console.log(`Model: ${embedder.model} · floor ${embedder.floor} · same-idea bar ${embedder.sameIdeaBar}`);
const started = Date.now();
const vectors = await embedder.embed(PAIRS.flatMap((p) => [p.a, p.b]));
console.log(`Loaded and embedded ${vectors.length} texts in ${((Date.now() - started) / 1000).toFixed(1)} s · ${vectors[0]?.length ?? 0} dimensions\n`);
const byKind: Record<string, number[]> = { same: [], near: [], unrelated: [] };
PAIRS.forEach((pair, i) => {
  const c = cosine(vectors[2 * i] as Float32Array, vectors[2 * i + 1] as Float32Array);
  const r = relatedness(c, embedder.floor);
  byKind[pair.kind]?.push(c);
  console.log(`${pair.kind.padEnd(9)} cosine ${c.toFixed(3)} · related ${r.toFixed(2)} · ${r >= embedder.sameIdeaBar ? 'goes to the matcher' : 'not a candidate'}\n  ${pair.a.slice(0, 70)}\n  ${pair.b.slice(0, 70)}`);
});
const range = (xs: number[]) => `${Math.min(...xs).toFixed(3)} to ${Math.max(...xs).toFixed(3)}`;
console.log(`\nSame idea: ${range(byKind['same'] ?? [])} · same subject: ${range(byKind['near'] ?? [])} · unrelated: ${range(byKind['unrelated'] ?? [])}`);
const sameOk = (byKind['same'] ?? []).every((c) => relatedness(c, embedder.floor) >= embedder.sameIdeaBar);
const unrelatedOk = (byKind['unrelated'] ?? []).every((c) => relatedness(c, embedder.floor) < embedder.sameIdeaBar);
console.log(sameOk && unrelatedOk ? '\nFits: every same-idea pair is a candidate and no unrelated pair is.' : '\nDOES NOT FIT: send this output to the build session, the two numbers need adjusting.');
process.exit(sameOk && unrelatedOk ? 0 : 1);
