const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createJobRepository } = require("../src/repositories/jobRepository");

describe("jobRepository", () => {
  let db;
  let repo;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);
    repo = createJobRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("createJob and findById", () => {
    const created = repo.createJob({ id: "job-1", command: "echo hello" });

    expect(created).toBeTruthy();
    expect(created.id).toBe("job-1");
    expect(created.command).toBe("echo hello");

    const found = repo.findById("job-1");
    expect(found).toBeTruthy();
    expect(found.state).toBe("pending");
  });

  test("findById returns null for missing id", () => {
    expect(repo.findById("missing-job")).toBeNull();
  });

  test("findByState", () => {
    repo.createJob({ id: "job-1", command: "echo one", state: "pending" });
    repo.createJob({ id: "job-2", command: "echo two", state: "running" });

    const pendingJobs = repo.findByState("pending");
    expect(pendingJobs).toHaveLength(1);
    expect(pendingJobs[0].id).toBe("job-1");
  });

  test("getJobCounts", () => {
    repo.createJob({ id: "job-1", command: "echo one", state: "pending" });
    repo.createJob({ id: "job-2", command: "echo two", state: "pending" });
    repo.createJob({ id: "job-3", command: "echo three", state: "failed" });

    const counts = repo.getJobCounts();

    expect(counts.total).toBe(3);
    expect(counts.byState.pending).toBe(2);
    expect(counts.byState.failed).toBe(1);
  });

  test("getJobCounts returns grouped state counts", () => {
    repo.createJob({ id: "job-pending", command: "echo pending", state: "pending" });
    repo.createJob({
      id: "job-completed",
      command: "echo completed",
      state: "completed",
    });
    repo.createJob({ id: "job-dead", command: "echo dead", state: "dead" });

    const counts = repo.getJobCounts();

    expect(counts).toEqual({
      total: 3,
      byState: {
        pending: 1,
        completed: 1,
        dead: 1,
      },
    });
  });

  test("getAttemptStats calculates average attempts", () => {
    repo.createJob({
      id: "job-attempts-1",
      command: "echo one",
      attempts: 1,
    });
    repo.createJob({
      id: "job-attempts-2",
      command: "echo two",
      attempts: 2,
    });

    expect(repo.getAttemptStats()).toEqual({
      averageAttempts: 1.5,
    });
  });

  test("getAttemptStats returns zero for empty queue", () => {
    expect(repo.getAttemptStats()).toEqual({
      averageAttempts: 0,
    });
  });

  test("claimNextJob claims once, marks processing, and records worker", () => {
    repo.createJob({ id: "job-4", command: "echo claim", state: "pending" });

    const firstClaim = repo.claimNextJob("worker-1");
    expect(firstClaim).toBeTruthy();
    expect(firstClaim.id).toBe("job-4");
    expect(firstClaim.state).toBe("processing");
    expect(firstClaim.worker_id).toBe("worker-1");

    const secondClaim = repo.claimNextJob("worker-2");
    expect(secondClaim).toBeNull();
  });

  test("claimNextJob returns higher priority job first", () => {
    repo.createJob({
      id: "job-low",
      command: "echo low",
      state: "pending",
      priority: 1,
    });
    repo.createJob({
      id: "job-high",
      command: "echo high",
      state: "pending",
      priority: 10,
    });

    const claimed = repo.claimNextJob("worker-1");

    expect(claimed.id).toBe("job-high");
    expect(claimed.priority).toBe(10);
  });

  test("claimNextJob preserves FIFO for equal priority jobs", () => {
    repo.createJob({
      id: "job-old",
      command: "echo old",
      state: "pending",
      priority: 5,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      next_run_at: "2026-01-01T00:00:00.000Z",
    });
    repo.createJob({
      id: "job-new",
      command: "echo new",
      state: "pending",
      priority: 5,
      created_at: "2026-01-01T00:00:01.000Z",
      updated_at: "2026-01-01T00:00:01.000Z",
      next_run_at: "2026-01-01T00:00:00.000Z",
    });

    const claimed = repo.claimNextJob("worker-1");

    expect(claimed.id).toBe("job-old");
  });

  test("claimNextJob claims failed jobs only when retry time is reached", () => {
    repo.createJob({
      id: "job-future",
      command: "echo later",
      state: "failed",
      next_run_at: new Date(Date.now() + 60_000).toISOString(),
    });
    repo.createJob({
      id: "job-ready",
      command: "echo now",
      state: "failed",
      next_run_at: new Date(Date.now() - 1_000).toISOString(),
    });

    const claimed = repo.claimNextJob("worker-1");

    expect(claimed.id).toBe("job-ready");
    expect(claimed.state).toBe("processing");
    expect(repo.findById("job-future").state).toBe("failed");
  });

  test("claimNextJob skips future scheduled pending jobs", () => {
    repo.createJob({
      id: "job-future-pending",
      command: "echo later",
      state: "pending",
      next_run_at: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(repo.claimNextJob("worker-1")).toBeNull();
    expect(repo.findById("job-future-pending").state).toBe("pending");
  });

  test("claimNextJob claims past scheduled pending jobs", () => {
    repo.createJob({
      id: "job-past-pending",
      command: "echo now",
      state: "pending",
      next_run_at: new Date(Date.now() - 1_000).toISOString(),
    });

    const claimed = repo.claimNextJob("worker-1");

    expect(claimed.id).toBe("job-past-pending");
    expect(claimed.state).toBe("processing");
  });

  test("claimNextJob skips future high priority job for available low priority job", () => {
    repo.createJob({
      id: "job-future-high",
      command: "echo later",
      state: "pending",
      priority: 100,
      next_run_at: new Date(Date.now() + 60_000).toISOString(),
    });
    repo.createJob({
      id: "job-ready-low",
      command: "echo now",
      state: "pending",
      priority: 0,
      next_run_at: new Date(Date.now() - 1_000).toISOString(),
    });

    const claimed = repo.claimNextJob("worker-1");

    expect(claimed.id).toBe("job-ready-low");
    expect(claimed.priority).toBe(0);
  });

  test("markJobCompleted only completes processing jobs", () => {
    repo.createJob({ id: "job-5", command: "echo done", state: "processing" });

    const completed = repo.markJobCompleted("job-5", "ok");
    expect(completed.state).toBe("completed");
    expect(completed.output).toBe("ok");

    repo.createJob({ id: "job-6", command: "echo pending", state: "pending" });
    expect(repo.markJobCompleted("job-6", "nope")).toBeNull();
    expect(repo.findById("job-6").state).toBe("pending");
  });
});
