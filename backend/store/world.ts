/**
 * World layer: nodes and chains. Reads are open to everyone; the only write path is `applyMergePlan`
 * and `createUnverifiedNodes` (goal compile), both merger-owned entry points.
 */
import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { chainKey } from '../core/chains';
import type { MergePlan } from '../core/merge';
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
  const verifyNode = db.prepare("UPDATE nodes SET status = 'verified' WHERE id = ?");
  for (const u of plan.nodeUpdates) {
    const row = selectNode.get(u.nodeId) as { aliases: string; sources: string } | undefined;
    if (!row) continue;
    const aliases = [...new Set([...parseJson<string[]>(row.aliases, []), ...u.aliases])];
    const sources = mergeRefs(parseJson<SourceRef[]>(row.sources, []), u.sources);
    updateNode.run(JSON.stringify(aliases), JSON.stringify(sources), now, u.nodeId);
    if (u.verify) verifyNode.run(u.nodeId);
  }
  const deleteChain = db.prepare('DELETE FROM chains WHERE id = ?');
  for (const id of plan.droppedChainIds) deleteChain.run(id);
  const insertChain = db.prepare('INSERT INTO chains (id, premises, conclusion, sources, chain_key, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertPremise = db.prepare('INSERT OR IGNORE INTO chain_premises (chain_id, node_id) VALUES (?, ?)');
  for (const c of plan.newChains) {
    insertChain.run(c.id, JSON.stringify(c.premises), c.conclusion, JSON.stringify(c.sources), chainKey(c.premises, c.conclusion), now);
    for (const p of c.premises) insertPremise.run(c.id, p);
  }
  const insertExample = db.prepare('INSERT INTO examples (id, node_id, source_id, locator, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const e of plan.examples) insertExample.run(e.id, e.nodeId, e.sourceId, e.locator, e.title, e.body, now);
  const selectChain = db.prepare('SELECT sources FROM chains WHERE id = ?');
  const updateChain = db.prepare('UPDATE chains SET sources = ? WHERE id = ?');
  for (const u of plan.chainUpdates) {
    const row = selectChain.get(u.chainId) as { sources: string } | undefined;
    if (!row) continue;
    updateChain.run(JSON.stringify(mergeRefs(parseJson<SourceRef[]>(row.sources, []), u.sources)), u.chainId);
  }
}

/**
 * Remove ideas nothing depends on any more (a source read again into larger ideas). Every chain that
 * uses one goes too; worked examples, embeddings and goal targets on them go by cascade. The caller
 * makes sure none has evidence: evidence is deleted only when the learner erases ideas from Settings
 * (services/erase.ts), which removes it first.
 */
export function retireNodes(db: Database, ids: Iterable<string>): void {
  const dropChains = db.prepare('DELETE FROM chains WHERE conclusion = ? OR id IN (SELECT chain_id FROM chain_premises WHERE node_id = ?)');
  const dropNode = db.prepare('DELETE FROM nodes WHERE id = ?');
  for (const id of ids) {
    dropChains.run(id, id);
    dropNode.run(id);
  }
}

/**
 * A source was erased: ideas and chains that stay (another source backs them) lose their citations of
 * it, so no card points at a source that is gone.
 */
export function dropSourceRefs(db: Database, sourceId: string): void {
  // LIKE only narrows the rows to parse; the exact match is on the parsed refs.
  const like = `%${sourceId}%`;
  const now = nowIso();
  const updateNode = db.prepare('UPDATE nodes SET sources = ?, updated_at = ? WHERE id = ?');
  for (const r of db.prepare('SELECT id, sources FROM nodes WHERE sources LIKE ?').all(like) as { id: string; sources: string }[]) {
    updateNode.run(JSON.stringify(parseJson<SourceRef[]>(r.sources, []).filter((s) => s.sourceId !== sourceId)), now, r.id);
  }
  const updateChain = db.prepare('UPDATE chains SET sources = ? WHERE id = ?');
  for (const r of db.prepare('SELECT id, sources FROM chains WHERE sources LIKE ?').all(like) as { id: string; sources: string }[]) {
    updateChain.run(JSON.stringify(parseJson<SourceRef[]>(r.sources, []).filter((s) => s.sourceId !== sourceId)), r.id);
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
