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
