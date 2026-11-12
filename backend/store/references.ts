/**
 * When two ideas are merged, everything outside the world layer and the evidence that names the
 * dropped idea points at the kept one instead: plain id columns (a pair that already exists stays
 * once), and ids inside JSON text (session logs, plans, practice, conversations, goal proposals).
 * Ids are random and fixed in length, so a quoted id in JSON text is always that id.
 */
import type { Database } from './db';

/** Tables whose rows name an idea in a column of their own, and that column. */
const ID_COLUMNS: { table: string; column: string }[] = [
  { table: 'bugs', column: 'node_id' },
  { table: 'card_ideas', column: 'node_id' },
  { table: 'activity', column: 'node_id' },
];
/** Owned elsewhere (the world layer, evidence and states, embeddings, notes) or holding no ideas. */
const NOT_HERE = new Set(['nodes', 'chains', 'chain_premises', 'evidence', 'node_states', 'node_embeddings', 'idea_notes', 'targets', 'examples', 'figure_ideas', 'source_coverage', 'settings', 'drafts', 'model_calls', 'card_reviews']);

export function repointIdeaReferences(db: Database, from: string, to: string): void {
  for (const { table, column } of ID_COLUMNS) {
    db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from);
    db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(from);
  }
  const quotedFrom = `"${from}"`;
  const quotedTo = `"${to}"`;
  for (const { table, column } of jsonColumns(db)) {
    db.prepare(`UPDATE ${table} SET ${column} = replace(${column}, ?, ?) WHERE ${column} LIKE ?`).run(quotedFrom, quotedTo, `%${quotedFrom}%`);
  }
}

/** Every text column of every table not handled elsewhere: where JSON naming ideas can live. */
function jsonColumns(db: Database): { table: string; column: string }[] {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name).filter((t) => !NOT_HERE.has(t));
  return tables.flatMap((table) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[])
      .filter((c) => c.type.toUpperCase() === 'TEXT' && !ID_COLUMNS.some((i) => i.table === table && i.column === c.name) && c.name !== 'id')
      .map((c) => ({ table, column: c.name })),
  );
}
