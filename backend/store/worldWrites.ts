/**
 * World layer: nodes and chains, written. Only the merger (`services/merger.ts`) imports this module
 * (a lint rule says so); every function runs inside the caller's transaction.
 */
import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { chainKey } from '../core/chains';
import type { MergePlan } from '../core/merge';
import type { IdeaMergePlan } from '../core/ideaMerge';
import type { KnowledgeNode, SourceRef } from '../core/types';

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

/** The learner renamed an idea or corrected its statement (`planIdeaEdit`). */
export function applyIdeaEdit(db: Database, nodeId: string, edit: { name: string; statement: string; aliases: string[] }): void {
  db.prepare('UPDATE nodes SET name = ?, statement = ?, aliases = ?, updated_at = ? WHERE id = ?').run(edit.name, edit.statement, JSON.stringify(edit.aliases), nowIso(), nodeId);
}

/**
 * The world-layer part of merging one idea into another (`planIdeaMerge`): the kept idea's names and
 * citations, the chains rewritten, worked examples and figures moved. The dropped idea itself is
 * deleted by the caller once everything else that points at it has moved.
 */
export function applyIdeaMerge(db: Database, plan: IdeaMergePlan): void {
  const now = nowIso();
  db.prepare(`UPDATE nodes SET aliases = ?, sources = ?, status = CASE WHEN ? THEN 'verified' ELSE status END, updated_at = ? WHERE id = ?`).run(JSON.stringify(plan.node.aliases), JSON.stringify(plan.node.sources), plan.node.verified ? 1 : 0, now, plan.keepId);
  const deleteChain = db.prepare('DELETE FROM chains WHERE id = ?');
  for (const id of plan.removeChainIds) deleteChain.run(id);
  const insertChain = db.prepare('INSERT INTO chains (id, premises, conclusion, sources, chain_key, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertPremise = db.prepare('INSERT OR IGNORE INTO chain_premises (chain_id, node_id) VALUES (?, ?)');
  for (const c of plan.newChains) {
    insertChain.run(c.id, JSON.stringify(c.premises), c.conclusion, JSON.stringify(c.sources), chainKey(c.premises, c.conclusion), now);
    for (const p of c.premises) insertPremise.run(c.id, p);
  }
  const updateChain = db.prepare('UPDATE chains SET sources = ? WHERE id = ?');
  for (const u of plan.chainSourceUpdates) updateChain.run(JSON.stringify(u.sources), u.chainId);
  db.prepare('UPDATE examples SET node_id = ? WHERE node_id = ?').run(plan.keepId, plan.dropId);
  db.prepare('UPDATE OR IGNORE figure_ideas SET node_id = ? WHERE node_id = ?').run(plan.keepId, plan.dropId);
  db.prepare('UPDATE OR IGNORE source_coverage SET node_id = ? WHERE node_id = ?').run(plan.keepId, plan.dropId);
}

/** Remove an idea merged into another; whatever still pointed at it (duplicates) goes by cascade. */
export function deleteMergedNode(db: Database, nodeId: string): void {
  db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
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
