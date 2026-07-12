const PROCESSING_LEASE_MS = 30_000;

function createJobRepository(db, { processingLeaseMs = PROCESSING_LEASE_MS } = {}) {
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
      error,
      worker_id,
      processing_started_at,
      priority,
      timeout
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
      @error,
      @worker_id,
      @processing_started_at,
      @priority,
      @timeout
    )
  `);

  const findByIdStatement = db.prepare("SELECT * FROM jobs WHERE id = ?");
  const findAllStatement = db.prepare("SELECT * FROM jobs ORDER BY created_at ASC");
  const findByStateStatement = db.prepare(
    "SELECT * FROM jobs WHERE state = ? ORDER BY created_at ASC"
  );
  const findNextClaimableStatement = db.prepare(`
    SELECT *
    FROM jobs
    WHERE
      (state = 'pending' AND next_run_at <= ?)
      OR (state = 'failed' AND next_run_at <= ?)
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `);
  const markClaimedStatement = db.prepare(
    "UPDATE jobs SET state = 'processing', worker_id = ?, processing_started_at = ?, updated_at = ? WHERE id = ? AND state IN ('pending', 'failed')"
  );
  const recordFailureStatement = db.prepare(
    "UPDATE jobs SET state = 'failed', attempts = ?, error = ?, next_run_at = ?, worker_id = NULL, processing_started_at = NULL, updated_at = ? WHERE id = ? AND state = 'processing'"
  );
  const markDeadStatement = db.prepare(
    "UPDATE jobs SET state = 'dead', attempts = ?, error = ?, worker_id = NULL, processing_started_at = NULL, updated_at = ? WHERE id = ? AND state = 'processing'"
  );
  const markCompletedStatement = db.prepare(
    "UPDATE jobs SET state = 'completed', output = ?, error = NULL, worker_id = NULL, processing_started_at = NULL, updated_at = ? WHERE id = ? AND state = 'processing'"
  );
  const retryDeadStatement = db.prepare(
    "UPDATE jobs SET state = 'pending', attempts = 0, error = NULL, next_run_at = ?, worker_id = NULL, processing_started_at = NULL, updated_at = ? WHERE id = ? AND state = 'dead'"
  );
  const recoverStaleJobsStatement = db.prepare(`
    UPDATE jobs
    SET state = 'pending', worker_id = NULL, processing_started_at = NULL, updated_at = ?
    WHERE state = 'processing' AND processing_started_at < ?
  `);
  const getJobCountsStatement = db.prepare(
    "SELECT state, COUNT(*) AS count FROM jobs GROUP BY state"
  );
  const getAttemptStatsStatement = db.prepare(
    "SELECT AVG(attempts) AS averageAttempts FROM jobs"
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
      worker_id: job.worker_id ?? null,
      processing_started_at: job.processing_started_at ?? null,
      priority: job.priority ?? 0,
      timeout: job.timeout ?? null,
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

  function recoverStaleJobs(now = new Date().toISOString()) {
    const leaseExpiresAt = new Date(
      Date.parse(now) - processingLeaseMs
    ).toISOString();
    const result = recoverStaleJobsStatement.run(now, leaseExpiresAt);

    return result.changes;
  }

  const claimNextJobTransaction = db.transaction((workerId, now) => {
    recoverStaleJobs(now);

    const next = findNextClaimableStatement.get(now, now);
    if (!next) {
      return null;
    }

    const result = markClaimedStatement.run(String(workerId), now, now, next.id);
    if (result.changes === 0) {
      return null;
    }

    return findByIdStatement.get(next.id);
  });

  function claimNextJob(workerId) {
    if (!workerId) {
      throw new Error("workerId is required to claim a job");
    }

    try {
      return claimNextJobTransaction.immediate(workerId, new Date().toISOString());
    } catch (error) {
      throw new Error(`Failed to claim next job: ${error.message}`, {
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

  function recordJobFailure(id, { attempts, maxRetries, backoffBase, errorMessage }) {
    try {
      const now = new Date().toISOString();
      const nextAttempts = attempts + 1;

      if (nextAttempts >= maxRetries) {
        const result = markDeadStatement.run(nextAttempts, errorMessage, now, id);
        if (result.changes === 0) {
          return null;
        }

        return findById(id);
      }

      const delaySeconds = Math.pow(backoffBase, nextAttempts);
      const nextRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      const result = recordFailureStatement.run(
        nextAttempts,
        errorMessage,
        nextRunAt,
        now,
        id
      );
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

  function retryDeadJob(id) {
    try {
      const now = new Date().toISOString();
      const result = retryDeadStatement.run(now, now, id);
      if (result.changes === 0) {
        return null;
      }

      return findById(id);
    } catch (error) {
      throw new Error(`Failed to retry dead job '${id}': ${error.message}`, {
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

  function getAttemptStats() {
    try {
      const row = getAttemptStatsStatement.get();

      return {
        averageAttempts: row.averageAttempts ?? 0,
      };
    } catch (error) {
      throw new Error(`Failed to get attempt stats: ${error.message}`, {
        cause: error,
      });
    }
  }

  return {
    createJob,
    findById,
    findAll,
    findByState,
    claimNextJob,
    recoverStaleJobs,
    markJobCompleted,
    recordJobFailure,
    retryDeadJob,
    getJobCounts,
    getAttemptStats,
  };
}

module.exports = {
  createJobRepository,
  PROCESSING_LEASE_MS,
};
