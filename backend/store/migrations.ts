import type { DatabaseSync } from 'node:sqlite';

/** Schema versions, applied in order. Never edit a shipped migration; add a new one. */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('claim', 'procedure', 'term')),
        name TEXT NOT NULL,
        statement TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        sources TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'unverified')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX nodes_name ON nodes(name);

      CREATE TABLE chains (
        id TEXT PRIMARY KEY,
        premises TEXT NOT NULL,
        conclusion TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        sources TEXT NOT NULL DEFAULT '[]',
        chain_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX chains_conclusion ON chains(conclusion);

      CREATE TABLE chain_premises (
        chain_id TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        PRIMARY KEY (chain_id, node_id)
      );
      CREATE INDEX chain_premises_node ON chain_premises(node_id);

      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT,
        hash TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        chunk_count INTEGER NOT NULL DEFAULT 0,
        chunks_done INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE source_chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        text TEXT NOT NULL,
        locator TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        node_ids TEXT NOT NULL DEFAULT '[]',
        conflicts TEXT NOT NULL DEFAULT '[]',
        UNIQUE (source_id, idx)
      );

      CREATE TABLE source_coverage (
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        PRIMARY KEY (source_id, node_id)
      );

      CREATE TABLE node_embeddings (
        node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dims INTEGER NOT NULL,
        vector BLOB NOT NULL,
        text_hash TEXT NOT NULL
      );

      CREATE TABLE node_states (
        node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        depth INTEGER NOT NULL DEFAULT 0,
        target_depth INTEGER NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'archive',
        own_statement TEXT,
        handle TEXT,
        stability REAL NOT NULL DEFAULT 0,
        difficulty REAL NOT NULL DEFAULT 0,
        last_review TEXT,
        due TEXT,
        reps INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        first_session_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX node_states_due ON node_states(due);

      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        score REAL NOT NULL,
        reasoning TEXT NOT NULL DEFAULT '',
        effort REAL,
        confidence REAL,
        context TEXT NOT NULL DEFAULT '{}',
        session_id TEXT
      );
      CREATE INDEX evidence_node ON evidence(node_id, at);
      CREATE INDEX evidence_session ON evidence(session_id);

      CREATE TABLE bugs (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX bugs_node ON bugs(node_id);

      CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        priority REAL NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        compiled_at TEXT
      );

      CREATE TABLE capabilities (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        statement TEXT NOT NULL,
        ord INTEGER NOT NULL,
        mastered_at TEXT
      );

      CREATE TABLE targets (
        capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        depth INTEGER NOT NULL,
        PRIMARY KEY (capability_id, node_id)
      );
      CREATE INDEX targets_node ON targets(node_id);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        state TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX session_events_session ON session_events(session_id, at);

      CREATE TABLE practice_sets (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
        node_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open'
      );

      CREATE TABLE problems (
        id TEXT PRIMARY KEY,
        set_id TEXT REFERENCES practice_sets(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        node_ids TEXT NOT NULL DEFAULT '[]',
        rung INTEGER NOT NULL,
        cue INTEGER NOT NULL,
        presentation TEXT NOT NULL,
        statement TEXT NOT NULL,
        solution TEXT NOT NULL,
        rubric TEXT NOT NULL
      );

      CREATE TABLE answers (
        id TEXT PRIMARY KEY,
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        submitted_at TEXT NOT NULL,
        answer TEXT NOT NULL,
        think_aloud TEXT NOT NULL DEFAULT '',
        confidence REAL,
        score REAL,
        feedback TEXT,
        graded_at TEXT
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = m.version;
  }
}

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
