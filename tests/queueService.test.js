const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createConfigRepository } = require("../src/repositories/configRepository");
const { createJobRepository } = require("../src/repositories/jobRepository");
const { createConfigService } = require("../src/services/configService");
const {
  createQueueService,
  QueueValidationError,
} = require("../src/services/queueService");

describe("queueService", () => {
  let db;
  let service;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);
    const jobRepository = createJobRepository(db);
    const configRepository = createConfigRepository(db);
    const configService = createConfigService({ configRepository });
    service = createQueueService({ jobRepository, configService });
  });

  afterEach(() => {
    db.close();
  });

  test("enqueue stores job with pending state", () => {
    const created = service.enqueue({ id: "job1", command: "echo hello" });

    expect(created.id).toBe("job1");
    expect(created.state).toBe("pending");
    expect(created.attempts).toBe(0);
  });

  test("enqueue normal job stores current next_run_at", () => {
    const before = Date.now();
    const created = service.enqueue({ id: "job-normal", command: "echo hello" });
    const after = Date.now();
    const nextRunAt = Date.parse(created.next_run_at);

    expect(nextRunAt).toBeGreaterThanOrEqual(before);
    expect(nextRunAt).toBeLessThanOrEqual(after);
  });

  test("enqueue with future run_at stores next_run_at", () => {
    const runAt = "2026-07-10T10:00:00";
    const created = service.enqueue({
      id: "job-future",
      command: "echo later",
      run_at: runAt,
    });

    expect(created.state).toBe("pending");
    expect(created.next_run_at).toBe(new Date(runAt).toISOString());
  });

  test("enqueue rejects invalid run_at", () => {
    expect(() =>
      service.enqueue({
        id: "job-invalid-run-at",
        command: "echo nope",
        run_at: "abc",
      })
    ).toThrow(QueueValidationError);
    expect(() =>
      service.enqueue({
        id: "job-invalid-run-at",
        command: "echo nope",
        run_at: "abc",
      })
    ).toThrow("Invalid run_at timestamp");
  });

  test("enqueue validates missing command", () => {
    expect(() => service.enqueue({ id: "job2" })).toThrow(QueueValidationError);
    expect(() => service.enqueue({ id: "job2" })).toThrow(
      "Missing required field: command"
    );
  });

  test("enqueue prevents duplicate ids", () => {
    service.enqueue({ id: "job3", command: "echo one" });

    expect(() => service.enqueue({ id: "job3", command: "echo two" })).toThrow(
      QueueValidationError
    );
    expect(() => service.enqueue({ id: "job3", command: "echo two" })).toThrow(
      "already exists"
    );
  });

  test("list filters by state and supports empty queue", () => {
    expect(service.list()).toEqual([]);

    service.enqueue({ id: "job4", command: "echo pending" });
    service.enqueue({ id: "job5", command: "echo pending-2" });

    expect(service.list({ state: "pending" })).toHaveLength(2);
    expect(service.list({ state: "completed" })).toEqual([]);
  });

  test("list rejects invalid state filter", () => {
    expect(() => service.list({ state: "bogus" })).toThrow(QueueValidationError);
    expect(() => service.list({ state: "bogus" })).toThrow(
      "Invalid state 'bogus'. Allowed values: pending, processing, completed, failed, dead"
    );
  });

  test("status returns expected counters", () => {
    service.enqueue({ id: "job6", command: "echo a" });
    service.enqueue({ id: "job7", command: "echo b" });

    const status = service.status();

    expect(status.pending).toBe(2);
    expect(status.processing).toBe(0);
    expect(status.completed).toBe(0);
    expect(status.failed).toBe(0);
    expect(status.dead).toBe(0);
  });

  test("failJob schedules retry with exponential backoff", () => {
    const created = service.enqueue({
      id: "job8",
      command: "echo retry",
      max_retries: 3,
    });

    service.claimNextJob("worker-1");
    const failed = service.failJob(created.id, "boom");

    expect(failed.state).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.error).toBe("boom");
    expect(Date.parse(failed.next_run_at)).toBeGreaterThan(Date.now());
  });

  test("failJob sends exhausted retries to dead letter queue", () => {
    const created = service.enqueue({
      id: "job9",
      command: "echo dead",
      max_retries: 1,
    });

    service.claimNextJob("worker-1");
    const dead = service.failJob(created.id, "nope");

    expect(dead.state).toBe("dead");
    expect(dead.attempts).toBe(1);
    expect(service.listDeadJobs()).toHaveLength(1);
  });

  test("retryDeadJob moves dead job back to pending and resets attempts", () => {
    service.enqueue({ id: "job10", command: "echo again", max_retries: 1 });
    service.claimNextJob("worker-1");
    service.failJob("job10", "failed");

    const retried = service.retryDeadJob("job10");

    expect(retried.state).toBe("pending");
    expect(retried.attempts).toBe(0);
    expect(retried.error).toBeNull();
  });
});
