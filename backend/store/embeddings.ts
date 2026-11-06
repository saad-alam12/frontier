import type { Database } from './db';

export interface StoredEmbedding {
  nodeId: string;
  model: string;
  vector: Float32Array;
  textHash: string;
}

export function upsertEmbedding(db: Database, e: StoredEmbedding): void {
  const bytes = new Uint8Array(e.vector.buffer, e.vector.byteOffset, e.vector.byteLength);
  db.prepare(
    `INSERT INTO node_embeddings (node_id, model, dims, vector, text_hash) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET model = excluded.model, dims = excluded.dims, vector = excluded.vector, text_hash = excluded.text_hash`,
  ).run(e.nodeId, e.model, e.vector.length, bytes, e.textHash);
}

export function getEmbeddingHash(db: Database, nodeId: string): string | undefined {
  const row = db.prepare('SELECT text_hash FROM node_embeddings WHERE node_id = ?').get(nodeId) as { text_hash: string } | undefined;
  return row?.text_hash;
}

export function listEmbeddings(db: Database, model: string): StoredEmbedding[] {
  const rows = db.prepare('SELECT node_id, model, dims, vector, text_hash FROM node_embeddings WHERE model = ?').all(model) as {
    node_id: string;
    model: string;
    dims: number;
    vector: Uint8Array;
    text_hash: string;
  }[];
  return rows.map((r) => ({
    nodeId: r.node_id,
    model: r.model,
    textHash: r.text_hash,
    vector: new Float32Array(r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.dims * 4)),
  }));
}

export function deleteEmbeddings(db: Database, nodeIds: Iterable<string>): void {
  const stmt = db.prepare('DELETE FROM node_embeddings WHERE node_id = ?');
  for (const id of nodeIds) stmt.run(id);
}

export function countEmbeddings(db: Database): number {
  return (db.prepare('SELECT count(*) AS n FROM node_embeddings').get() as { n: number }).n;
}
