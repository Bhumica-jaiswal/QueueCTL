const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createJobRepository } = require("../src/repositories/jobRepository");
const { createMetricsService } = require("../src/services/metricsService");

describe("metricsService", () => {
  let db;
  let jobRepository;
  let service;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);
    jobRepository = createJobRepository(db);
    service = createMetricsService({ jobRepository });
  });

  afterEach(() => {
    db.close();
  });

  test("calculates total jobs and state counts", () => {
    jobRepository.createJob({ id: "job-1", command: "echo one", state: "pending" });
    jobRepository.createJob({
      id: "job-2",
      command: "echo two",
      state: "completed",
    });
    jobRepository.createJob({ id: "job-3", command: "echo three", state: "dead" });

    expect(service.getMetrics()).toMatchObject({
      totalJobs: 3,
      states: {
        pending: 1,
        processing: 0,
        completed: 1,
        failed: 0,
        dead: 1,
      },
    });
  });

  test("calculates success percentage and average attempts", () => {
    jobRepository.createJob({
      id: "job-success-1",
      command: "echo one",
      state: "completed",
      attempts: 1,
    });
    jobRepository.createJob({
      id: "job-success-2",
      command: "echo two",
      state: "completed",
      attempts: 2,
    });
    jobRepository.createJob({
      id: "job-failed",
      command: "echo three",
      state: "failed",
      attempts: 3,
    });

    expect(service.getMetrics()).toMatchObject({
      totalJobs: 3,
      successRate: 66.67,
      averageAttempts: 2,
    });
  });

  test("handles empty database", () => {
    expect(service.getMetrics()).toEqual({
      totalJobs: 0,
      states: {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        dead: 0,
      },
      successRate: 0,
      averageAttempts: 0,
    });
  });
});
