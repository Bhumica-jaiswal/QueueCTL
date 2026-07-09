const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createJobRepository } = require("../src/repositories/jobRepository");
const { createLogService } = require("../src/services/logService");

describe("logService", () => {
  let db;
  let jobRepository;
  let service;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);
    jobRepository = createJobRepository(db);
    service = createLogService({ jobRepository });
  });

  afterEach(() => {
    db.close();
  });

  test("returns logs for an existing job", () => {
    jobRepository.createJob({
      id: "job-logs",
      command: "echo hello",
      state: "processing",
      attempts: 1,
    });
    jobRepository.markJobCompleted("job-logs", "hello");

    expect(service.getJobLogs("job-logs")).toEqual({
      id: "job-logs",
      state: "completed",
      attempts: 1,
      output: "hello",
      error: null,
    });
  });

  test("throws clean error for missing job", () => {
    expect(() => service.getJobLogs("missing")).toThrow("Job not found: missing");
  });
});
