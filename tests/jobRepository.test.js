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
