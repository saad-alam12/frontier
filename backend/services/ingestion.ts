/**
 * The ingestion pipeline (design §7): read → chunk → extract → embed → match → merge, per source,
 * chunks in order, sources in parallel under a global limit, failures isolated per chunk.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { runExtractor } from '../agents/extractor';
import type { DigestEntry } from '../agents/extractor';
import { runMatcher } from '../agents/matcher';
import type { MatchQuery } from '../agents/matcher';
import { planMerge } from '../core/merge';
import type { KnowledgeNode, Source, SourceKind } from '../core/types';
import { chunkBlocks, collapseBuildPages } from '../ingest/chunker';
import { textHash } from '../ingest/embedder';
import type { Embedder } from '../ingest/embedder';
import { readBytes, readSourceFile } from '../ingest/readers';
import { nameSimilarity, topK } from '../ingest/similarity';
import type { TextBlock } from '../ingest/types';
import type { LlmProvider } from '../llm/provider';
import { Semaphore } from '../llm/queue';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { getEmbeddingHash, listEmbeddings, upsertEmbedding } from '../store/embeddings';
import { newId } from '../store/ids';
import { addCoverage, coveredNodeIds, createSource, findSourceByHash, getSource, listChunks, updateChunk, updateSourceStatus } from '../store/sources';
import type { SourceChunk } from '../store/sources';
import { applyMergePlan, getNodes, listChains, listNodes } from '../store/world';
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
}

const CANDIDATES = 5;
const MIN_COSINE = 0.55;
const MIN_NAME_SIMILARITY = 0.5;

export class IngestionService {
  private readonly sources: Semaphore;
  private readonly running = new Set<string>();

  constructor(private readonly options: IngestionOptions) {
    this.sources = new Semaphore(options.concurrency ?? 3);
  }

  get db(): Database {
    return this.options.db;
  }

  /** Copy a file into the data folder, read and chunk it. Same content twice is a no-op. */
  async addFile(path: string): Promise<{ source: Source; existed: boolean }> {
    const { kind, bytes, result } = await readSourceFile(path);
    const hash = sha256(bytes);
    const existing = findSourceByHash(this.db, hash);
    if (existing) return { source: existing, existed: true };
    await mkdir(this.options.sourcesDir, { recursive: true });
    const stored = `${hash.slice(0, 12)}-${basename(path)}`;
    await copyFile(path, join(this.options.sourcesDir, stored));
    const title = result.title || basename(path, extname(path));
    return { source: this.createFromBlocks(kind, title, stored, hash, result.blocks), existed: false };
  }

  /** Add text that is not a file (a session transcript, pasted notes). */
  async addText(input: { kind: SourceKind; title: string; text: string }): Promise<{ source: Source; existed: boolean }> {
    const bytes = Buffer.from(input.text, 'utf8');
    const hash = sha256(bytes);
    const existing = findSourceByHash(this.db, hash);
    if (existing) return { source: existing, existed: true };
    const result = await readBytes(input.kind, bytes, input.title);
    return { source: this.createFromBlocks(input.kind, input.title, null, hash, result.blocks), existed: false };
  }

  private createFromBlocks(kind: SourceKind, title: string, path: string | null, hash: string, blocks: TextBlock[]): Source {
    const chunks = chunkBlocks(kind === 'pdf' ? collapseBuildPages(blocks) : blocks);
    return createSource(this.db, { kind, title, path, hash }, chunks);
  }

  /** Queue a source run; returns immediately. */
  start(sourceId: string): void {
    if (this.running.has(sourceId)) return;
    this.running.add(sourceId);
    void this.sources
      .run(() => this.runSource(sourceId))
      .catch((error: unknown) => this.emit(sourceId, { message: error instanceof Error ? error.message : String(error) }))
      .finally(() => this.running.delete(sourceId));
  }

  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId);
  }

  /** Process every pending or failed chunk of a source, in order. Safe to call again after failures. */
  async runSource(sourceId: string): Promise<Source> {
    const source = getSource(this.db, sourceId);
    if (!source) throw new Error(`unknown source ${sourceId}`);
    updateSourceStatus(this.db, sourceId, { status: 'running', error: null });
    this.emit(sourceId);
    await this.ensureEmbeddings();
    let failures = 0;
    for (const chunk of listChunks(this.db, sourceId)) {
      if (chunk.status === 'done') continue;
      try {
        await this.processChunk(source, chunk);
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        updateChunk(this.db, chunk.id, { status: 'failed', attempts: chunk.attempts + 1, error: message });
        this.emit(sourceId, { message: `Chunk ${chunk.idx + 1} failed: ${message}` });
      }
    }
    const done = listChunks(this.db, sourceId).filter((c) => c.status === 'done').length;
    updateSourceStatus(this.db, sourceId, {
      status: failures === 0 ? 'done' : 'failed',
      chunksDone: done,
      error: failures === 0 ? null : `${failures} chunk${failures === 1 ? '' : 's'} failed; run again to retry`,
    });
    if (done > 0) refreshGoalFields(this.db);
    this.emit(sourceId);
    this.options.onSourceDone?.(sourceId);
    return getSource(this.db, sourceId) as Source;
  }

  private async processChunk(source: Source, chunk: SourceChunk): Promise<void> {
    updateChunk(this.db, chunk.id, { status: 'running', attempts: chunk.attempts + 1, error: null });
    const chunkCount = (this.db.prepare('SELECT count(*) AS n FROM source_chunks WHERE source_id = ?').get(source.id) as { n: number }).n;
    const digest = this.digestFor(source.id);
    const extraction = await runExtractor(this.options.provider, {
      sourceTitle: source.title,
      sourceKind: source.kind,
      locator: chunk.locator,
      chunkIndex: chunk.idx,
      chunkCount,
      text: chunk.text,
      digest,
    });

    const queries = await this.candidatesFor(extraction.nodes);
    const decisions = await runMatcher(this.options.provider, queries);
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

    const vectors = await this.options.embedder.embed(plan.newNodes.map(embeddingText));
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
    const vectors = await this.options.embedder.embed(nodes.map(embeddingText));
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
    const missing = listNodes(this.db).filter((n) => getEmbeddingHash(this.db, n.id) !== textHash(embeddingText(n)));
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

  private emit(sourceId: string, extra: { message?: string } = {}): void {
    const s = getSource(this.db, sourceId);
    if (!s) return;
    this.options.onProgress?.({ sourceId, status: s.status, chunkCount: s.chunkCount, chunksDone: s.chunksDone, ...extra });
  }
}

export function embeddingText(node: Pick<KnowledgeNode, 'name' | 'statement'>): string {
  return `${node.name}: ${node.statement}`;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
