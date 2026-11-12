/**
 * World layer: nodes and chains, read. Reads are open to everyone; the writes are in `worldWrites.ts`,
 * and only the merger (`services/merger.ts`) may call them.
 */
import type { Database } from './db';
import { parseJson } from './db';
import type { Chain, KnowledgeNode, SourceRef, WorkedExample } from '../core/types';

interface NodeRow {
  id: string;
  kind: KnowledgeNode['kind'];
  name: string;
  statement: string;
  aliases: string;
  sources: string;
  status: KnowledgeNode['status'];
}

interface ChainRow {
  id: string;
  premises: string;
  conclusion: string;
  sources: string;
}

function rowToNode(r: NodeRow): KnowledgeNode {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    statement: r.statement,
    aliases: parseJson<string[]>(r.aliases, []),
    sources: parseJson<SourceRef[]>(r.sources, []),
    status: r.status,
  };
}

function rowToChain(r: ChainRow): Chain {
  return { id: r.id, premises: parseJson<string[]>(r.premises, []), conclusion: r.conclusion, sources: parseJson<SourceRef[]>(r.sources, []) };
}

export function getNode(db: Database, id: string): KnowledgeNode | undefined {
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
  return row ? rowToNode(row) : undefined;
}

export function getNodes(db: Database, ids: Iterable<string>): Map<string, KnowledgeNode> {
  const out = new Map<string, KnowledgeNode>();
  const stmt = db.prepare('SELECT * FROM nodes WHERE id = ?');
  for (const id of ids) {
    const row = stmt.get(id) as NodeRow | undefined;
    if (row) out.set(id, rowToNode(row));
  }
  return out;
}

export function listNodes(db: Database): KnowledgeNode[] {
  return (db.prepare('SELECT * FROM nodes ORDER BY created_at, id').all() as unknown as NodeRow[]).map(rowToNode);
}

export function countNodes(db: Database): number {
  return (db.prepare('SELECT count(*) AS n FROM nodes').get() as { n: number }).n;
}

export function listChains(db: Database): Chain[] {
  return (db.prepare('SELECT * FROM chains ORDER BY created_at, id').all() as unknown as ChainRow[]).map(rowToChain);
}

/** Chains touching a node, as premise or conclusion. */
export function chainsAround(db: Database, nodeId: string): Chain[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT c.* FROM chains c
       LEFT JOIN chain_premises p ON p.chain_id = c.id
       WHERE c.conclusion = ? OR p.node_id = ?`,
    )
    .all(nodeId, nodeId) as unknown as ChainRow[];
  return rows.map(rowToChain);
}

export function searchNodesByName(db: Database, query: string, limit = 20): KnowledgeNode[] {
  const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(`SELECT * FROM nodes WHERE name LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\' OR statement LIKE ? ESCAPE '\\' LIMIT ?`)
    .all(like, like, like, limit) as unknown as NodeRow[];
  return rows.map(rowToNode);
}

export function listExamplesForNode(db: Database, nodeId: string): WorkedExample[] {
  const rows = db.prepare('SELECT id, node_id, source_id, locator, title, body FROM examples WHERE node_id = ? ORDER BY created_at, id').all(nodeId) as unknown as {
    id: string;
    node_id: string;
    source_id: string;
    locator: string;
    title: string;
    body: string;
  }[];
  return rows.map((r) => ({ id: r.id, nodeId: r.node_id, sourceId: r.source_id, locator: r.locator, title: r.title, body: r.body }));
}
