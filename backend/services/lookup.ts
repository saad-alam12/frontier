/**
 * Lookup (design §8): find ideas by meaning (local embeddings) and by name (fuzzy), find passages of
 * the learner's sources (full text), answer the question from the learner's own cards and those
 * passages (librarian), with follow-up questions, and count opening a card as a weak review.
 */
import { askLibrarian } from '../agents/librarian';
import type { Embedder } from '../ingest/embedder';
import { cosine, nameSimilarity, relatedness } from '../ingest/similarity';
import { isCancelled } from '../llm/provider';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { logEvent } from '../store/activity';
import { listEvidenceForNode } from '../store/evidence';
import { listEmbeddings } from '../store/embeddings';
import { searchPassages } from '../store/sources';
import type { PassageHit } from '../store/sources';
import { recordEvidence } from './evidence';
import type { IngestionService } from './ingestion';
import { loadKnowledge } from './knowledge';
import { nodeCard } from './map';
import type { MapState, NodeCard } from './map';

export interface LookupHit {
  nodeId: string;
  name: string;
  kind: string;
  statement: string;
  ownStatement: string | null;
  state: MapState;
  score: number;
  /** How it was found, for the result line. */
  match: 'meaning' | 'name';
}

export interface LookupDeps {
  db: Database;
  provider?: LlmProvider;
  embedder?: Embedder;
  /** Used to embed ideas that have no embedding yet (seeded ideas, a changed model). */
  ingestion?: IngestionService;
}

const MIN_SCORE = 0.2;

/** How well the query matches an idea's name, aliases, own words and handle. */
export function fuzzyScore(query: string, fields: string[]): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  let best = 0;
  for (const field of fields) {
    const f = field.toLowerCase().replace(/\$/g, '');
    if (!f) continue;
    if (f === q) return 1;
    if (f.includes(q)) best = Math.max(best, 0.6 + 0.3 * (q.length / f.length));
    // the question names the idea outright ("difference between X and Y"); a one-word name inside
    // a sentence ("strategy") is weak evidence, a multi-word name is strong
    if (f.length >= 4 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(f)}(?![\\p{L}\\p{N}])`, 'u').test(q)) best = Math.max(best, f.includes(' ') ? 0.8 + 0.1 * Math.min(1, f.length / 30) : 0.45);
    best = Math.max(best, nameSimilarity(q, f));
    // prefixes: "nash eq" finds "Nash equilibrium"
    const words = f.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const qWords = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (qWords.length && qWords.every((w) => words.some((x) => x.startsWith(w)))) best = Math.max(best, 0.55 + 0.05 * Math.min(4, qWords.length));
    // an abbreviation of a name of several words: "SPE" for subgame perfect equilibrium
    const initials = words.length >= 2 ? words.map((w) => w[0]).join('') : '';
    if (initials.length >= 2 && qWords.includes(initials)) best = Math.max(best, 0.75);
    // the name's first telling word in the question ("Nash" in "SPE versus Nash"); shorter names first
    const telling = words.find((w) => w.length >= 4 && !COMMON_WORDS.has(w));
    if (telling && qWords.includes(telling)) best = Math.max(best, 0.45 + 0.1 / words.length);
  }
  return Math.min(1, best);
}

/** Words that tell nothing about which idea is meant, in a name or in a question. */
const COMMON_WORDS = new Set('what which when where does with from that this these those than then them they have between difference compare explain about there their into over under every each some more most less also only same other is are the and for not why how can and'.split(' '));

/** The words of a question worth searching sources for: no question words or fillers, each once. */
export function searchTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/\$[^$]*\$/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !COMMON_WORDS.has(w) && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 12);
}
const STOP_WORDS = new Set('a an of to in on at by as is it its be was were or if so do did done does you your me my we our us i'.split(' '));

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchIdeas(deps: LookupDeps, query: string, limit = 8): Promise<LookupHit[]> {
  const { db } = deps;
  if (!query.trim()) return [];
  const view = loadKnowledge(db);
  const semantic = new Map<string, number>();
  if (deps.embedder) {
    try {
      await deps.ingestion?.ensureEmbeddings();
      const [q] = await deps.embedder.embed([query]);
      if (q) for (const e of listEmbeddings(db, deps.embedder.model)) semantic.set(e.nodeId, relatedness(cosine(q, e.vector), deps.embedder.floor));
    } catch {
      // the embedding model may be unavailable (offline first run); name matching still works
    }
  }
  const hits: LookupHit[] = [];
  for (const node of view.nodes.values()) {
    const state = view.states.get(node.id);
    const fuzzy = fuzzyScore(query, [node.name, ...node.aliases, state?.ownStatement ?? '', state?.handle ?? '']);
    const meaning = semantic.get(node.id) ?? 0;
    const score = Math.max(fuzzy, meaning);
    if (score < MIN_SCORE) continue;
    hits.push({
      nodeId: node.id,
      name: node.name,
      kind: node.kind,
      statement: node.statement,
      ownStatement: state?.ownStatement ?? null,
      state: view.owned.has(node.id) ? 'owned' : view.fringe.has(node.id) ? 'fringe' : 'beyond',
      score,
      match: meaning > fuzzy ? 'meaning' : 'name',
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface LookupAnswer {
  hits: LookupHit[];
  /** Passages of the learner's sources that hold the question's words, with where they are. */
  passages: (Omit<PassageHit, 'text'> & { id: string })[];
  answer: { text: string; cited: string[]; passages: string[] } | null;
  /** Why no answer was written although one was asked for (the model failed); what was found still shows. */
  answerError?: string;
}

/** An earlier question and answer of the same lookup, for a follow-up. */
export interface LookupTurn {
  question: string;
  answer: string;
}

/** Turns of a conversation the librarian reads for a follow-up. */
export const MAX_TURNS = 6;

/**
 * Search, then have the librarian answer from the top cards and passages. Questions get answers; bare
 * names only hits. A follow-up searches with the question before it too, and the librarian reads the
 * conversation so far.
 */
export async function lookup(deps: LookupDeps, query: string, history: LookupTurn[] = []): Promise<LookupAnswer> {
  const earlier = history.slice(-MAX_TURNS);
  const context = earlier.at(-1)?.question ?? '';
  const hits = await searchIdeas(deps, query);
  // a follow-up ("and why?") says little on its own: the question before it keeps the subject
  const contextHits = context ? (await searchIdeas(deps, context, 4)).filter((h) => !hits.some((x) => x.nodeId === h.nodeId)) : [];
  const allHits = [...hits, ...contextHits].slice(0, 8);
  const found = searchPassages(deps.db, searchTerms(`${context} ${query}`), 4);
  const passages = found.map((p, i) => ({ id: `s${i + 1}`, chunkId: p.chunkId, sourceId: p.sourceId, title: p.title, locator: p.locator, snippet: p.snippet }));
  logEvent(deps.db, 'lookup', {}, { query, hits: allHits.length, passages: passages.length, question: looksLikeQuestion(query), followUp: earlier.length > 0 });
  const asks = looksLikeQuestion(query) || earlier.length > 0;
  if (!deps.provider || (allHits.length === 0 && passages.length === 0) || !asks) return { hits: allHits, passages, answer: null };
  const view = loadKnowledge(deps.db);
  const cards = allHits.slice(0, 6).map((h) => ({
    id: h.nodeId,
    name: h.name,
    statement: h.statement,
    ownStatement: h.ownStatement,
    builtOn: (view.index.into.get(h.nodeId) ?? []).map((c) => c.premises.map((p) => view.nodes.get(p)?.name ?? p).join(' + ')),
  }));
  let result: { answer: string; cited: string[] };
  try {
    result = await askLibrarian(deps.provider, query, cards, {
      passages: found.map((p, i) => ({ id: `s${i + 1}`, where: p.locator ? `${p.title}, ${p.locator}` : p.title, text: p.text })),
      history: earlier,
    });
  } catch (error) {
    if (isCancelled(error)) throw error;
    // the ideas and passages found are still worth showing
    return { hits: allHits, passages, answer: null, answerError: error instanceof Error ? error.message : String(error) };
  }
  const passageIds = new Set(passages.map((p) => p.id));
  return {
    hits: allHits,
    passages,
    answer: { text: result.answer, cited: result.cited.filter((id) => !passageIds.has(id)), passages: result.cited.filter((id) => passageIds.has(id)) },
  };
}

/** A question rather than a name: several words, or a question word or mark. */
export function looksLikeQuestion(query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.endsWith('?') || /^(what|why|how|when|which|who|is|are|does|do|can|difference|compare|explain)\b/.test(q) || q.split(/\s+/).length >= 5;
}

/**
 * Open an idea's card. It records `lookup` evidence at most once per idea per day (design §8): a
 * trace that the idea was needed. The card shows the answer, so a lookup never counts as a review.
 */
export function openCard(db: Database, nodeId: string, now = new Date()): NodeCard {
  const today = now.toISOString().slice(0, 10);
  const already = listEvidenceForNode(db, nodeId).some((e) => e.kind === 'lookup' && e.at.slice(0, 10) === today);
  if (!already) recordEvidence(db, { nodeId, kind: 'lookup', score: 0.6, reasoning: 'Looked up', at: now.toISOString(), context: { step: 'lookup' } });
  return nodeCard(db, nodeId, now);
}
