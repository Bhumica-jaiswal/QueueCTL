const { getConnection } = require("./connection");

const CREATE_JOBS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    state TEXT,
    attempts INTEGER,
    max_retries INTEGER,
    created_at DATETIME,
    updated_at DATETIME,
    next_run_at DATETIME,
    output TEXT,
    error TEXT,
    processing_started_at DATETIME,
    priority INTEGER DEFAULT 0,
    timeout INTEGER DEFAULT NULL
  )
`;

const ADD_JOBS_WORKER_ID_COLUMN_SQL = `
  ALTER TABLE jobs ADD COLUMN worker_id TEXT
`;

const ADD_JOBS_PROCESSING_STARTED_AT_COLUMN_SQL = `
  ALTER TABLE jobs ADD COLUMN processing_started_at DATETIME
`;

const ADD_JOBS_PRIORITY_COLUMN_SQL = `
  ALTER TABLE jobs ADD COLUMN priority INTEGER DEFAULT 0
`;

const ADD_JOBS_TIMEOUT_COLUMN_SQL = `
  ALTER TABLE jobs ADD COLUMN timeout INTEGER DEFAULT NULL
`;

const CREATE_CONFIG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`;

const CREATE_WORKERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS workers (
    worker_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT
  )
`;

const CREATE_JOBS_STATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs (state)
`;

const DEFAULT_CONFIG = {
  "max-retries": "3",
  "backoff-base": "2",
};

function initDatabase(db = getConnection()) {
  try {
    const transaction = db.transaction(() => {
      db.exec(CREATE_JOBS_TABLE_SQL);
      db.exec(CREATE_CONFIG_TABLE_SQL);
      db.exec(CREATE_WORKERS_TABLE_SQL);
      db.exec(CREATE_JOBS_STATE_INDEX_SQL);

      const jobsColumns = db.prepare("PRAGMA table_info(jobs)").all();
      const hasWorkerId = jobsColumns.some((column) => column.name === "worker_id");
      if (!hasWorkerId) {
        db.exec(ADD_JOBS_WORKER_ID_COLUMN_SQL);
      }

      const hasProcessingStartedAt = jobsColumns.some(
        (column) => column.name === "processing_started_at"
      );
      if (!hasProcessingStartedAt) {
        db.exec(ADD_JOBS_PROCESSING_STARTED_AT_COLUMN_SQL);
        db.prepare(`
          UPDATE jobs
          SET processing_started_at = updated_at
          WHERE state = 'processing' AND processing_started_at IS NULL
        `).run();
      }

      const hasPriority = jobsColumns.some((column) => column.name === "priority");
      if (!hasPriority) {
        db.exec(ADD_JOBS_PRIORITY_COLUMN_SQL);
      }

      const hasTimeout = jobsColumns.some((column) => column.name === "timeout");
      if (!hasTimeout) {
        db.exec(ADD_JOBS_TIMEOUT_COLUMN_SQL);
      }

      const setDefaultConfig = db.prepare(`
        INSERT OR IGNORE INTO config (key, value)
        VALUES (?, ?)
      `);

      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        setDefaultConfig.run(key, value);
      }
    });

    transaction();
  } catch (error) {
    throw new Error(`Failed to initialize database schema: ${error.message}`, {
      cause: error,
    });
  }
}

module.exports = {
  initDatabase,
};
