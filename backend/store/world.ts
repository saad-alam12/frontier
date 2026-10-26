/**
 * World layer: nodes and chains. Reads are open to everyone; the only write path is `applyMergePlan`
 * and `createUnverifiedNodes` (goal compile), both merger-owned entry points.
 */
import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { chainKey } from '../core/chains';
import type { MergePlan } from '../core/merge';
import type { Chain, KnowledgeNode, SourceRef } from '../core/types';

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

/** The merger's write path. Runs inside the caller's transaction. */
export function applyMergePlan(db: Database, plan: MergePlan): void {
  const now = nowIso();
  const insertNode = db.prepare(
    'INSERT INTO nodes (id, kind, name, statement, aliases, sources, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const n of plan.newNodes) {
    insertNode.run(n.id, n.kind, n.name, n.statement, JSON.stringify(n.aliases), JSON.stringify(n.sources), n.status, now, now);
  }
  const selectNode = db.prepare('SELECT aliases, sources FROM nodes WHERE id = ?');
  const updateNode = db.prepare('UPDATE nodes SET aliases = ?, sources = ?, updated_at = ? WHERE id = ?');
  for (const u of plan.nodeUpdates) {
    const row = selectNode.get(u.nodeId) as { aliases: string; sources: string } | undefined;
    if (!row) continue;
    const aliases = [...new Set([...parseJson<string[]>(row.aliases, []), ...u.aliases])];
    const sources = mergeRefs(parseJson<SourceRef[]>(row.sources, []), u.sources);
    updateNode.run(JSON.stringify(aliases), JSON.stringify(sources), now, u.nodeId);
  }
  const deleteChain = db.prepare('DELETE FROM chains WHERE id = ?');
  for (const id of plan.droppedChainIds) deleteChain.run(id);
  const insertChain = db.prepare('INSERT INTO chains (id, premises, conclusion, sources, chain_key, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertPremise = db.prepare('INSERT OR IGNORE INTO chain_premises (chain_id, node_id) VALUES (?, ?)');
  for (const c of plan.newChains) {
    insertChain.run(c.id, JSON.stringify(c.premises), c.conclusion, JSON.stringify(c.sources), chainKey(c.premises, c.conclusion), now);
    for (const p of c.premises) insertPremise.run(c.id, p);
  }
  const selectChain = db.prepare('SELECT sources FROM chains WHERE id = ?');
  const updateChain = db.prepare('UPDATE chains SET sources = ? WHERE id = ?');
  for (const u of plan.chainUpdates) {
    const row = selectChain.get(u.chainId) as { sources: string } | undefined;
    if (!row) continue;
    updateChain.run(JSON.stringify(mergeRefs(parseJson<SourceRef[]>(row.sources, []), u.sources)), u.chainId);
  }
}

/** Goal compiles may create placeholder nodes that a source has yet to ground. */
export function createUnverifiedNodes(db: Database, nodes: Omit<KnowledgeNode, 'status' | 'sources'>[]): void {
  const now = nowIso();
  const stmt = db.prepare(
    "INSERT INTO nodes (id, kind, name, statement, aliases, sources, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', 'unverified', ?, ?)",
  );
  for (const n of nodes) stmt.run(n.id, n.kind, n.name, n.statement, JSON.stringify(n.aliases), now, now);
}

function mergeRefs(existing: SourceRef[], added: SourceRef[]): SourceRef[] {
  const seen = new Set(existing.map((s) => `${s.sourceId}|${s.locator ?? ''}`));
  const out = [...existing];
  for (const s of added) {
    const k = `${s.sourceId}|${s.locator ?? ''}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}
