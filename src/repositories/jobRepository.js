const ALLOWED_UPDATE_FIELDS = new Set([
  "command",
  "state",
  "attempts",
  "max_retries",
  "updated_at",
  "next_run_at",
  "output",
  "error",
]);

function createJobRepository(db) {
  const insertJobStatement = db.prepare(`
    INSERT INTO jobs (
      id,
      command,
      state,
      attempts,
      max_retries,
      created_at,
      updated_at,
      next_run_at,
      output,
      error
    ) VALUES (
      @id,
      @command,
      @state,
      @attempts,
      @max_retries,
      @created_at,
      @updated_at,
      @next_run_at,
      @output,
      @error
    )
  `);

  const findByIdStatement = db.prepare("SELECT * FROM jobs WHERE id = ?");
  const findAllStatement = db.prepare("SELECT * FROM jobs ORDER BY created_at ASC");
  const findByStateStatement = db.prepare(
    "SELECT * FROM jobs WHERE state = ? ORDER BY created_at ASC"
  );
  const findNextPendingStatement = db.prepare(
    "SELECT * FROM jobs WHERE state = 'pending' ORDER BY created_at ASC LIMIT 1"
  );
  const markProcessingStatement = db.prepare(
    "UPDATE jobs SET state = 'processing', updated_at = ? WHERE id = ? AND state = 'pending'"
  );
  const markCompletedStatement = db.prepare(
    "UPDATE jobs SET state = 'completed', output = ?, error = NULL, updated_at = ? WHERE id = ?"
  );
  const markFailedStatement = db.prepare(
    "UPDATE jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?"
  );
  const getJobCountsStatement = db.prepare(
    "SELECT state, COUNT(*) AS count FROM jobs GROUP BY state"
  );

  function createJob(job) {
    const now = new Date().toISOString();
    const payload = {
      id: job.id,
      command: job.command,
      state: job.state ?? "pending",
      attempts: job.attempts ?? 0,
      max_retries: job.max_retries ?? 0,
      created_at: job.created_at ?? now,
      updated_at: job.updated_at ?? now,
      next_run_at: job.next_run_at ?? now,
      output: job.output ?? null,
      error: job.error ?? null,
    };

    try {
      insertJobStatement.run(payload);
      return findById(payload.id);
    } catch (error) {
      throw new Error(`Failed to create job '${payload.id}': ${error.message}`, {
        cause: error,
      });
    }
  }

  function findById(id) {
    try {
      return findByIdStatement.get(id) ?? null;
    } catch (error) {
      throw new Error(`Failed to fetch job '${id}': ${error.message}`, {
        cause: error,
      });
    }
  }

  function findByState(state) {
    try {
      return findByStateStatement.all(state);
    } catch (error) {
      throw new Error(`Failed to fetch jobs by state '${state}': ${error.message}`, {
        cause: error,
      });
    }
  }

  function findAll() {
    try {
      return findAllStatement.all();
    } catch (error) {
      throw new Error(`Failed to fetch jobs: ${error.message}`, {
        cause: error,
      });
    }
  }

  function updateJob(id, updates = {}) {
    const entries = Object.entries(updates).filter(
      ([key, value]) => ALLOWED_UPDATE_FIELDS.has(key) && value !== undefined
    );

    if (entries.length === 0) {
      return findById(id);
    }

    const hasUpdatedAt = entries.some(([key]) => key === "updated_at");
    if (!hasUpdatedAt) {
      entries.push(["updated_at", new Date().toISOString()]);
    }

    const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => value);

    const statement = db.prepare(`UPDATE jobs SET ${setClause} WHERE id = ?`);

    try {
      const result = statement.run(...values, id);
      if (result.changes === 0) {
        return null;
      }

      return findById(id);
    } catch (error) {
      throw new Error(`Failed to update job '${id}': ${error.message}`, {
        cause: error,
      });
    }
  }

  const claimNextPendingJobTransaction = db.transaction(() => {
    const next = findNextPendingStatement.get();
    if (!next) {
      return null;
    }

    const now = new Date().toISOString();
    const result = markProcessingStatement.run(now, next.id);
    if (result.changes === 0) {
      return null;
    }

    return findByIdStatement.get(next.id);
  });

  function claimNextPendingJob() {
    try {
      return claimNextPendingJobTransaction();
    } catch (error) {
      throw new Error(`Failed to claim pending job: ${error.message}`, {
        cause: error,
      });
    }
  }

  function markJobCompleted(id, output = null) {
    try {
      const now = new Date().toISOString();
      const result = markCompletedStatement.run(output, now, id);
      if (result.changes === 0) {
        return null;
      }

      return findById(id);
    } catch (error) {
      throw new Error(`Failed to mark job '${id}' as completed: ${error.message}`, {
        cause: error,
      });
    }
  }

  function markJobFailed(id, errorMessage = null) {
    try {
      const now = new Date().toISOString();
      const result = markFailedStatement.run(errorMessage, now, id);
      if (result.changes === 0) {
        return null;
      }

      return findById(id);
    } catch (error) {
      throw new Error(`Failed to mark job '${id}' as failed: ${error.message}`, {
        cause: error,
      });
    }
  }

  function getJobCounts() {
    try {
      const rows = getJobCountsStatement.all();
      const byState = {};
      let total = 0;

      for (const row of rows) {
        byState[row.state] = row.count;
        total += row.count;
      }

      return {
        total,
        byState,
      };
    } catch (error) {
      throw new Error(`Failed to get job counts: ${error.message}`, {
        cause: error,
      });
    }
  }

  return {
    createJob,
    findById,
    findAll,
    findByState,
    updateJob,
    claimNextPendingJob,
    markJobCompleted,
    markJobFailed,
    getJobCounts,
  };
}

module.exports = {
  createJobRepository,
};
