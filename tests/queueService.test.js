const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createJobRepository } = require("../src/repositories/jobRepository");
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
    service = createQueueService({ jobRepository });
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
});
