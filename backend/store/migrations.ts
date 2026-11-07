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
  {
    version: 2,
    sql: `
      -- Unsent answers (probe questions, session cards), so leaving a screen or quitting loses nothing.
      CREATE TABLE drafts (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: `
      -- Worked examples from sources, attached to the idea they illustrate (never stored as ideas).
      CREATE TABLE examples (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        locator TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX examples_node ON examples(node_id);
    `,
  },
  {
    version: 4,
    sql: `
      -- Goals v2: what kind of goal, how it is assessed, and the material it draws on.
      ALTER TABLE goals ADD COLUMN title TEXT;
      ALTER TABLE goals ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal';
      ALTER TABLE goals ADD COLUMN assessment TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE goals ADD COLUMN target_grade TEXT;
      ALTER TABLE goals ADD COLUMN date TEXT;
      ALTER TABLE goals ADD COLUMN hours_per_week REAL;
      ALTER TABLE goals ADD COLUMN exam_profile TEXT;
      ALTER TABLE goals ADD COLUMN course_plan TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE goals ADD COLUMN profile_sources TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE goals ADD COLUMN compiled_sources TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE goals ADD COLUMN started_unverified TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE goal_materials (
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('teaching', 'practice', 'assessment', 'scope', 'reference')),
        added_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, source_id)
      );
      CREATE INDEX goal_materials_source ON goal_materials(source_id);

      -- Goals from before v2 were compiled against the whole library: keep that as their teaching material.
      INSERT INTO goal_materials (goal_id, source_id, role, added_at)
        SELECT g.id, s.id, 'teaching', s.added_at FROM goals g CROSS JOIN sources s WHERE s.kind != 'session';
      UPDATE goals SET compiled_sources = (SELECT json_group_array(source_id) FROM goal_materials WHERE goal_id = goals.id) WHERE compiled_at IS NOT NULL;
    `,
  },
  {
    version: 5,
    sql: `
      -- M5: practice sets can run inside a session; answers are graded after the solution is shown.
      ALTER TABLE practice_sets ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
      CREATE INDEX problems_set ON problems(set_id);
      CREATE INDEX answers_problem ON answers(problem_id);
    `,
  },
  {
    version: 6,
    sql: `
      -- Time budgets: the time given to a goal decides its plan; drafts are previewed before approval.
      ALTER TABLE goals ADD COLUMN budget TEXT;
      ALTER TABLE goals ADD COLUMN focus TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE goals ADD COLUMN coverage TEXT;
      ALTER TABLE goals ADD COLUMN baseline TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE goals ADD COLUMN approved_at TEXT;
      UPDATE goals SET approved_at = created_at;
      -- An hours-per-week pace becomes a weekly rate that runs to the goal's date, or for twelve weeks.
      UPDATE goals SET budget = json_object('mode', 'rate', 'hours', hours_per_week, 'per', 'week', 'length',
          CASE WHEN date IS NOT NULL AND julianday(date) > julianday('now') THEN MAX(1, CAST(ROUND((julianday(date) - julianday('now')) / 7) AS INTEGER)) ELSE 12 END,
          'lengthUnit', 'weeks')
        WHERE hours_per_week IS NOT NULL AND hours_per_week > 0;
      ALTER TABLE goals DROP COLUMN hours_per_week;

      -- The depth the plan holds for each target (the compiler's depth trimmed to the budget); NULL until planned.
      ALTER TABLE targets ADD COLUMN planned_depth INTEGER;

      -- Everything the learner does, for time tracking, pace and Stats. Time is logged as spans that grow
      -- while the same activity continues.
      CREATE TABLE activity (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        seconds REAL NOT NULL DEFAULT 0,
        goal_id TEXT,
        session_id TEXT,
        practice_set_id TEXT,
        node_id TEXT,
        source_id TEXT,
        data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX activity_at ON activity(at);
      CREATE INDEX activity_kind ON activity(kind, at);
      CREATE INDEX activity_goal ON activity(goal_id, at);
    `,
  },
  {
    version: 7,
    sql: `
      -- R3: what the goal means for its time (level and scope), what the learner already knows about it,
      -- core targets, and the depth the learner approved (automatic re-plans never go deeper).
      ALTER TABLE goals ADD COLUMN level TEXT;
      ALTER TABLE goals ADD COLUMN scope TEXT;
      ALTER TABLE goals ADD COLUMN background TEXT;
      ALTER TABLE targets ADD COLUMN core INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE targets ADD COLUMN approved_depth INTEGER;
    `,
  },
  {
    version: 8,
    sql: `
      -- R3: why an idea was simplified for a goal (taught as its core intuition, capped below the ideal).
      ALTER TABLE targets ADD COLUMN simplified TEXT;
    `,
  },
  {
    version: 9,
    sql: `
      -- R3: prerequisites the learner showed they lack, and a re-map waiting to be made or approved.
      ALTER TABLE goals ADD COLUMN gaps TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE goals ADD COLUMN remap TEXT;
    `,
  },
  {
    version: 10,
    sql: `
      -- R3: minutes the learner added to a goal by going deeper on simplified ideas, on top of its time.
      ALTER TABLE goals ADD COLUMN extra_minutes INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 11,
    sql: `
      -- Which extraction read a source: 1 = many small chunks into many small ideas, 2 = whole documents
      -- into lesson-sized ideas. Sources read before stay at 1 until they are read again.
      ALTER TABLE sources ADD COLUMN extraction INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 12,
    sql: `
      -- R5: the learner's context for a goal (reasons, purpose, constraints, what to focus on or skip),
      -- and the depth wanted for a goal with no time limit (null: the goal is fitted to its time).
      ALTER TABLE goals ADD COLUMN context TEXT;
      ALTER TABLE goals ADD COLUMN wanted_level TEXT;
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
