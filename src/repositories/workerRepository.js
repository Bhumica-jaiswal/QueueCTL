function createWorkerRepository(db) {
  const registerWorkerStatement = db.prepare(`
    INSERT INTO workers (worker_id, status, started_at, updated_at)
    VALUES (?, 'running', ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET
      status = 'running',
      started_at = excluded.started_at,
      updated_at = excluded.updated_at
  `);
  const markWorkerStoppingStatement = db.prepare(`
    UPDATE workers
    SET status = 'stopping', updated_at = ?
    WHERE worker_id = ? AND status = 'running'
  `);
  const removeWorkerStatement = db.prepare("DELETE FROM workers WHERE worker_id = ?");
  const getWorkerStatusStatement = db.prepare(
    "SELECT status FROM workers WHERE worker_id = ?"
  );
  const stopAllWorkersStatement = db.prepare(`
    UPDATE workers
    SET status = 'stopping', updated_at = ?
    WHERE status = 'running'
  `);
  const getActiveWorkerCountStatement = db.prepare(
    "SELECT COUNT(*) AS count FROM workers WHERE status = 'running'"
  );

  function registerWorker(workerId) {
    const now = new Date().toISOString();
    registerWorkerStatement.run(String(workerId), now, now);
  }

  function markWorkerStopping(workerId) {
    const result = markWorkerStoppingStatement.run(
      new Date().toISOString(),
      String(workerId)
    );
    return result.changes > 0;
  }

  function removeWorker(workerId) {
    const result = removeWorkerStatement.run(String(workerId));
    return result.changes > 0;
  }

  function getWorkerStatus(workerId) {
    return getWorkerStatusStatement.get(String(workerId))?.status ?? null;
  }

  function stopAllWorkers() {
    const result = stopAllWorkersStatement.run(new Date().toISOString());
    return result.changes;
  }

  function getActiveWorkerCount() {
    return getActiveWorkerCountStatement.get().count;
  }

  return {
    registerWorker,
    markWorkerStopping,
    removeWorker,
    getWorkerStatus,
    stopAllWorkers,
    getActiveWorkerCount,
  };
}

module.exports = {
  createWorkerRepository,
};
