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

  test("updateJob", () => {
    repo.createJob({ id: "job-1", command: "echo hello" });

    const updated = repo.updateJob("job-1", {
      state: "completed",
      output: "done",
      attempts: 1,
    });

    expect(updated).toBeTruthy();
    expect(updated.state).toBe("completed");
    expect(updated.output).toBe("done");
    expect(updated.attempts).toBe(1);
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

  test("claimNextPendingJob claims once and marks processing", () => {
    repo.createJob({ id: "job-4", command: "echo claim", state: "pending" });

    const firstClaim = repo.claimNextPendingJob();
    expect(firstClaim).toBeTruthy();
    expect(firstClaim.id).toBe("job-4");
    expect(firstClaim.state).toBe("processing");

    const secondClaim = repo.claimNextPendingJob();
    expect(secondClaim).toBeNull();
  });

  test("markJobCompleted and markJobFailed", () => {
    repo.createJob({ id: "job-5", command: "echo done", state: "processing" });

    const completed = repo.markJobCompleted("job-5", "ok");
    expect(completed.state).toBe("completed");
    expect(completed.output).toBe("ok");

    repo.createJob({ id: "job-6", command: "echo fail", state: "processing" });
    const failed = repo.markJobFailed("job-6", "boom");
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("boom");
  });
});
