/**
 * The ingestion pipeline (design §7): read → split into parts → extract → embed → match → merge. A
 * paper or lecture is one part, so it is one extractor call and at most one matcher call; only
 * book-length sources have several parts, read in order. Sources run in parallel under a global limit;
 * a failing part writes nothing and is retried on the next run.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { runExtractor } from '../agents/extractor';
import type { DigestEntry } from '../agents/extractor';
import { runMatcher } from '../agents/matcher';
import type { MatchQuery } from '../agents/matcher';
import { planMerge } from '../core/merge';
import type { KnowledgeNode, Source, SourceKind } from '../core/types';
import { blocksFromParts, chunkBlocks, collapseBuildPages, PART_TOKENS } from '../ingest/chunker';
import { textHash } from '../ingest/embedder';
import type { Embedder } from '../ingest/embedder';
import { hasNoText, kindForFile, readBytes, readSourceFile } from '../ingest/readers';
import { nameSimilarity, topK } from '../ingest/similarity';
import type { TextBlock } from '../ingest/types';
import { isCancelled } from '../llm/provider';
import type { LlmProvider } from '../llm/provider';
import { Semaphore } from '../llm/queue';
import { nodesWithCards } from '../store/cards';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { embeddingHashes, listEmbeddings, upsertEmbedding } from '../store/embeddings';
import { newId } from '../store/ids';
import { nodesWithEvidence } from '../store/evidence';
import { nodesInOpenSets } from '../store/practice';
import { nodesInSessions } from '../store/sessions';
import { addCoverage, coveredElsewhere, coveredNodeIds, createSource, findSourceByHash, getSource, listChunks, resetSourceParts, updateChunk, updateSourceStatus } from '../store/sources';
import type { SourceChunk } from '../store/sources';
import { applyMergePlan, getNodes, listChains, listNodes, retireNodes } from '../store/world';
import { refreshGoalFields } from './knowledge';

export interface IngestProgress {
  sourceId: string;
  status: Source['status'];
  chunkCount: number;
  chunksDone: number;
  message?: string;
}

export interface IngestionOptions {
  db: Database;
  provider: LlmProvider;
  embedder: Embedder;
  sourcesDir: string;
  concurrency?: number;
  onProgress?: (p: IngestProgress) => void;
  /** Called after every run of a source, so goals using it can move on. */
  onSourceDone?: (sourceId: string) => void;
  /** Tokens per part; tests use small parts to exercise multi-part sources. */
  partTokens?: number;
}

const CANDIDATES = 5;
const MIN_COSINE = 0.55;
const MIN_NAME_SIMILARITY = 0.5;
/** What the learner reads on a source they stopped. Its unread parts wait; "Run again" reads them. */
export const STOPPED_MESSAGE = 'You stopped the reading. Run it again to read the rest.';
/** A part takes at least this long, however short (two model calls and the search model). */
const MIN_PART_SECONDS = 15;

export class IngestionService {
  private readonly sources: Semaphore;
  private readonly running = new Set<string>();
  /**
   * Matching and merging run one source at a time. Sources are read in parallel, and a source that
   * looked for existing ideas before another one merged would not find them, so both would create
   * the same idea (lecture slides and the script of the same lecture, added together).
   */
  private readonly merging = new Semaphore(1);
  /** One per source that is queued or being read: "Stop reading" aborts it. */
  private readonly stops = new Map<string, AbortController>();
  /** The part being read right now, per source: when it began and how long it should take. */
  private readonly reading = new Map<string, { chunkId: string; startedAt: number }>();
  /** Seconds a part takes per 1,000 characters; starts as a guess and follows what reading here takes. */
  private pace = 1;

  constructor(private readonly options: IngestionOptions) {
    this.sources = new Semaphore(options.concurrency ?? 3);
  }

  get db(): Database {
    return this.options.db;
  }

  /** How many sources are read at once; a change applies to sources not yet started. */
  setConcurrency(limit: number): void {
    this.sources.setLimit(limit);
  }

  /** Copy a file into the data folder, read and chunk it. Same content twice is a no-op. */
  async addFile(path: string): Promise<{ source: Source; existed: boolean }> {
    const kind = kindForFile(path);
    if (!kind) throw new Error(`Unsupported file type: ${basename(path)}`);
    return this.addDocument({ kind, name: basename(path), bytes: await readFile(path) });
  }

  /**
   * Keep a document in the data folder, read and chunk it: a file from disk, or a page or a PDF
   * fetched from `origin`. Same content twice is a no-op.
   */
  async addDocument(input: { kind: SourceKind; name: string; bytes: Buffer; origin?: string | null }): Promise<{ source: Source; existed: boolean }> {
    const { kind, name, bytes } = input;
    const result = await readBytes(kind, bytes, basename(name, extname(name)));
    if (hasNoText(result)) throw new Error(kind === 'pdf' ? `${name} has no text to read: it looks like a scan or pictures of pages. Frontier reads text only for now.` : `${name} has no text to read.`);
    const hash = sha256(bytes);
    const existing = findSourceByHash(this.db, hash);
    if (existing) return { source: existing, existed: true };
    await mkdir(this.options.sourcesDir, { recursive: true });
    const stored = `${hash.slice(0, 12)}-${name}`;
    await writeFile(join(this.options.sourcesDir, stored), bytes);
    const title = result.title || basename(name, extname(name));
    return { source: this.createFromBlocks(kind, title, stored, hash, result.blocks, input.origin), existed: false };
  }

  /**
   * Add text that is not a file (a session transcript, pasted notes). With `blocks` the text already
   * comes in parts that say where they are from (a video transcript by the minute).
   */
  async addText(input: { kind: SourceKind; title: string; text: string; blocks?: TextBlock[]; origin?: string | null }): Promise<{ source: Source; existed: boolean }> {
    const bytes = Buffer.from(input.text, 'utf8');
    const hash = sha256(bytes);
    const existing = findSourceByHash(this.db, hash);
    if (existing) return { source: existing, existed: true };
    const blocks = input.blocks ?? (await readBytes(input.kind, bytes, input.title)).blocks;
    if (hasNoText({ title: input.title, blocks })) throw new Error('There is no text to read.');
    return { source: this.createFromBlocks(input.kind, input.title, null, hash, blocks, input.origin), existed: false };
  }

  private createFromBlocks(kind: SourceKind, title: string, path: string | null, hash: string, blocks: TextBlock[], origin?: string | null): Source {
    return createSource(this.db, { kind, title, path, hash, origin }, this.parts(kind, blocks));
  }

  private parts(kind: SourceKind, blocks: TextBlock[]) {
    return chunkBlocks(kind === 'pdf' ? collapseBuildPages(blocks) : blocks, this.options.partTokens ?? PART_TOKENS);
  }

  /**
   * Prepare a source to be read again with the current extraction: split it into parts afresh (from its
   * file, or from its stored text when it has none) and retire the ideas only it gave that nothing
   * depends on: no evidence, no other source, no flashcard, not in any session or open practice or probe. Ideas
   * that stay are matched again like any other. Call `start` afterwards.
   */
  async prepareReread(sourceId: string): Promise<{ retired: string[] }> {
    const source = getSource(this.db, sourceId);
    if (!source) throw new Error(`unknown source ${sourceId}`);
    if (this.running.has(sourceId)) throw new Error('This source is being read right now.');
    const blocks = source.path ? (await readSourceFile(join(this.options.sourcesDir, source.path))).result.blocks : blocksFromParts(listChunks(this.db, sourceId));
    const parts = this.parts(source.kind, blocks);
    if (parts.length === 0) throw new Error('There is no text in this source to read again.');
    const old = coveredNodeIds(this.db, sourceId);
    const keep = new Set([...nodesWithEvidence(this.db), ...coveredElsewhere(this.db, sourceId), ...nodesInOpenSets(this.db), ...nodesInSessions(this.db, old), ...nodesWithCards(this.db)]);
    const retired = old.filter((id) => !keep.has(id));
    transaction(this.db, () => {
      retireNodes(this.db, retired);
      resetSourceParts(this.db, sourceId, parts);
    });
    this.emit(sourceId);
    return { retired };
  }

  /** Queue a source run; returns immediately. */
  start(sourceId: string): void {
    if (this.running.has(sourceId)) return;
    this.running.add(sourceId);
    const stop = new AbortController();
    this.stops.set(sourceId, stop);
    void this.sources
      .run(() => this.runSource(sourceId, stop.signal), stop.signal)
      .catch((error: unknown) => {
        // stopped while it still waited its turn: nothing was read
        if (isCancelled(error)) this.markStopped(sourceId);
        else this.emit(sourceId, { message: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        this.running.delete(sourceId);
        this.stops.delete(sourceId);
        this.reading.delete(sourceId);
      });
  }

  /** Stop reading a source: the call in flight is dropped, parts already read stay, the rest wait for "Run again". */
  stop(sourceId: string): void {
    this.stops.get(sourceId)?.abort();
  }

  /**
   * About how many seconds until a source that is being read is done; null when it is not being read
   * (or still waits its turn). A guess from the length of its unread parts and how fast parts were
   * read so far; 0 when the part in hand already takes longer than expected.
   */
  secondsLeft(sourceId: string, now = Date.now()): number | null {
    const current = this.reading.get(sourceId);
    if (!current) return null;
    let seconds = 0;
    for (const chunk of listChunks(this.db, sourceId)) {
      if (chunk.status === 'done') continue;
      const expected = this.expectedSeconds(chunk.text.length);
      seconds += chunk.id === current.chunkId ? Math.max(0, expected - (now - current.startedAt) / 1000) : expected;
    }
    return Math.round(seconds);
  }

  private expectedSeconds(characters: number): number {
    return Math.max(MIN_PART_SECONDS, (characters / 1000) * this.pace);
  }

  private markStopped(sourceId: string): void {
    const done = listChunks(this.db, sourceId).filter((c) => c.status === 'done').length;
    updateSourceStatus(this.db, sourceId, { status: 'failed', chunksDone: done, error: STOPPED_MESSAGE });
    this.emit(sourceId);
    this.options.onSourceDone?.(sourceId);
  }

  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId);
  }

  /** True while any source is being read. */
  isBusy(): boolean {
    return this.running.size > 0;
  }

  /** Process every pending or failed part of a source, in order. Safe to call again after failures. */
  async runSource(sourceId: string, signal?: AbortSignal): Promise<Source> {
    const source = getSource(this.db, sourceId);
    if (!source) throw new Error(`unknown source ${sourceId}`);
    updateSourceStatus(this.db, sourceId, { status: 'running', error: null });
    this.emit(sourceId);
    // ideas without an embedding for this model (a goal's own ideas, a changed model) get one first;
    // when the model cannot be loaded, reading goes on and ideas are matched by name only
    await this.ensureEmbeddings().catch((error: unknown) => this.emit(sourceId, { message: byNameOnly(error) }));
    let failures = 0;
    for (const chunk of listChunks(this.db, sourceId)) {
      if (chunk.status === 'done') continue;
      if (signal?.aborted) break;
      const startedAt = Date.now();
      this.reading.set(sourceId, { chunkId: chunk.id, startedAt });
      try {
        await this.processChunk(source, chunk, signal);
        // long parts say how fast reading is here; short ones are mostly waiting
        if (chunk.text.length >= 5000) this.pace = (this.pace + (Date.now() - startedAt) / chunk.text.length) / 2;
      } catch (error) {
        if (isCancelled(error)) {
          // the learner stopped it: the part was not read and did not fail
          updateChunk(this.db, chunk.id, { status: 'pending', attempts: chunk.attempts, error: null });
          break;
        }
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        updateChunk(this.db, chunk.id, { status: 'failed', attempts: chunk.attempts + 1, error: message });
        this.emit(sourceId, { message: `Part ${chunk.idx + 1} failed: ${message}` });
      }
    }
    this.reading.delete(sourceId);
    const done = listChunks(this.db, sourceId).filter((c) => c.status === 'done').length;
    if (signal?.aborted && done < listChunks(this.db, sourceId).length) {
      if (done > 0) refreshGoalFields(this.db);
      this.markStopped(sourceId);
      return getSource(this.db, sourceId) as Source;
    }
    updateSourceStatus(this.db, sourceId, {
      status: failures === 0 ? 'done' : 'failed',
      chunksDone: done,
      error: failures === 0 ? null : `${failures} part${failures === 1 ? '' : 's'} failed; run again to retry`,
    });
    if (done > 0) refreshGoalFields(this.db);
    this.emit(sourceId);
    this.options.onSourceDone?.(sourceId);
    return getSource(this.db, sourceId) as Source;
  }

  private async processChunk(source: Source, chunk: SourceChunk, signal?: AbortSignal): Promise<void> {
    updateChunk(this.db, chunk.id, { status: 'running', attempts: chunk.attempts + 1, error: null });
    const chunkCount = (this.db.prepare('SELECT count(*) AS n FROM source_chunks WHERE source_id = ?').get(source.id) as { n: number }).n;
    const digest = this.digestFor(source.id);
    const extraction = await runExtractor(
      this.options.provider,
      {
        sourceTitle: source.title,
        sourceKind: source.kind,
        locator: chunk.locator,
        chunkIndex: chunk.idx,
        chunkCount,
        text: chunk.text,
        digest,
      },
      signal,
    );

    await this.merging.run(async () => {
      const queries = await this.candidatesFor(extraction.nodes);
      const decisions = await runMatcher(this.options.provider, queries, signal);
      const identities = new Map<string, string>();
      for (const d of decisions) if (d.match) identities.set(d.tempId, d.match);

      const existingNodes = new Map(listNodes(this.db).map((n) => [n.id, n]));
      const plan = planMerge({
        sourceId: source.id,
        extractedNodes: extraction.nodes.map((n) => ({ ...n, locator: n.locator ?? chunk.locator })),
        extractedChains: extraction.chains.map((c) => ({ ...c, locator: c.locator ?? chunk.locator })),
        extractedExamples: extraction.examples.map((e) => ({ ...e, locator: e.locator ?? chunk.locator })),
        identities,
        existingNodes,
        existingChains: listChains(this.db),
        newId: (prefix) => newId(prefix),
      });

      const vectors = await this.embed(plan.newNodes.map(embeddingText));
      transaction(this.db, () => {
        applyMergePlan(this.db, plan);
        addCoverage(this.db, source.id, plan.coveredNodeIds);
        plan.newNodes.forEach((n, i) => {
          const vector = vectors[i];
          if (vector) upsertEmbedding(this.db, { nodeId: n.id, model: this.options.embedder.model, vector, textHash: textHash(embeddingText(n)) });
        });
        updateChunk(this.db, chunk.id, { status: 'done', error: null, nodeIds: plan.coveredNodeIds, conflicts: extraction.conflicts });
        const done = listChunks(this.db, source.id).filter((c) => c.status === 'done').length;
        updateSourceStatus(this.db, source.id, { chunksDone: done });
      });
    }, signal);
    this.emit(source.id);
  }

  private digestFor(sourceId: string): DigestEntry[] {
    const nodes = getNodes(this.db, coveredNodeIds(this.db, sourceId));
    return [...nodes.values()].map((n) => ({ id: n.id, kind: n.kind, name: n.name, statement: n.statement }));
  }

  private async candidatesFor(nodes: { tempId: string; kind: string; name: string; statement: string }[]): Promise<MatchQuery[]> {
    if (nodes.length === 0) return [];
    const world = listNodes(this.db);
    const byId = new Map(world.map((n) => [n.id, n]));
    const embeddings = listEmbeddings(this.db, this.options.embedder.model).map((e) => ({ id: e.nodeId, vector: e.vector }));
    const vectors = await this.embed(nodes.map(embeddingText));
    return nodes.map((n, i) => {
      const scores = new Map<string, number>();
      const vector = vectors[i];
      if (vector) for (const hit of topK(vector, embeddings, CANDIDATES, MIN_COSINE)) scores.set(hit.id, hit.score);
      for (const w of world) {
        const s = Math.max(nameSimilarity(n.name, w.name), ...w.aliases.map((a) => nameSimilarity(n.name, a)));
        if (s >= MIN_NAME_SIMILARITY) scores.set(w.id, Math.max(scores.get(w.id) ?? 0, s));
      }
      const candidates = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, CANDIDATES)
        .map(([id, score]) => {
          const w = byId.get(id) as KnowledgeNode;
          return { id, kind: w.kind, name: w.name, statement: w.statement, score };
        });
      return { tempId: n.tempId, kind: n.kind, name: n.name, statement: n.statement, candidates };
    });
  }

  /** Embed nodes that have no embedding for the current model (seeded or unverified nodes, model changes). */
  async ensureEmbeddings(): Promise<number> {
    const have = embeddingHashes(this.db, this.options.embedder.model);
    const missing = listNodes(this.db).filter((n) => have.get(n.id) !== textHash(embeddingText(n)));
    if (missing.length === 0) return 0;
    const vectors = await this.options.embedder.embed(missing.map(embeddingText));
    transaction(this.db, () => {
      missing.forEach((n, i) => {
        const vector = vectors[i];
        if (vector) upsertEmbedding(this.db, { nodeId: n.id, model: this.options.embedder.model, vector, textHash: textHash(embeddingText(n)) });
      });
    });
    return missing.length;
  }

  /**
   * Embeddings for matching by meaning. When the model cannot be loaded (no network on the first run,
   * a broken download) reading must not stop: no vectors come back, ideas are matched by name, and
   * the missing embeddings are made the next time a source is read with the model available.
   */
  private async embed(texts: string[]): Promise<(Float32Array | undefined)[]> {
    if (texts.length === 0) return [];
    try {
      return await this.options.embedder.embed(texts);
    } catch {
      return [];
    }
  }

  private emit(sourceId: string, extra: { message?: string } = {}): void {
    const s = getSource(this.db, sourceId);
    if (!s) return;
    this.options.onProgress?.({ sourceId, status: s.status, chunkCount: s.chunkCount, chunksDone: s.chunksDone, ...extra });
  }
}

function byNameOnly(error: unknown): string {
  return `The model for matching by meaning could not be loaded, so ideas are matched by name only for now. (${error instanceof Error ? error.message : String(error)})`;
}

export function embeddingText(node: Pick<KnowledgeNode, 'name' | 'statement'>): string {
  return `${node.name}: ${node.statement}`;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
