const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createConfigRepository } = require("../src/repositories/configRepository");
const { createJobRepository } = require("../src/repositories/jobRepository");
const { createConfigService } = require("../src/services/configService");
const { createQueueService } = require("../src/services/queueService");
const { WorkerManager } = require("../src/workers/workerManager");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("worker processing", () => {
  let db;
  let repo;
  let service;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);
    repo = createJobRepository(db);
    const configRepository = createConfigRepository(db);
    const configService = createConfigService({ configRepository });
    service = createQueueService({ jobRepository: repo, configService });
  });

  afterEach(() => {
    db.close();
  });

  test("worker completes successful job", async () => {
    repo.createJob({ id: "job-a", command: "echo ok", state: "pending" });

    const executor = {
      execute: jest.fn().mockResolvedValue({
        exitCode: 0,
        stdout: "hello",
        stderr: "",
      }),
    };

    const manager = new WorkerManager({
      count: 1,
      queueService: service,
      pollIntervalMs: 20,
      logger: { log: jest.fn(), error: jest.fn() },
      executor,
    });

    manager.start();
    await sleep(80);
    await manager.stop();

    const updated = repo.findById("job-a");
    expect(updated.state).toBe("completed");
    expect(updated.output).toBe("hello");
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  test("worker fails unsuccessful job", async () => {
    repo.createJob({
      id: "job-b",
      command: "exit 1",
      state: "pending",
      max_retries: 2,
    });

    const executor = {
      execute: jest.fn().mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "failure",
      }),
    };

    const manager = new WorkerManager({
      count: 1,
      queueService: service,
      pollIntervalMs: 20,
      logger: { log: jest.fn(), error: jest.fn() },
      executor,
    });

    manager.start();
    await sleep(80);
    await manager.stop();

    const updated = repo.findById("job-b");
    expect(updated.state).toBe("failed");
    expect(updated.error).toBe("failure");
  });

  test("worker passes timeout to executor", async () => {
    repo.createJob({
      id: "job-timeout-pass",
      command: "sleep 20",
      state: "pending",
      timeout: 5,
    });

    const executor = {
      execute: jest.fn().mockResolvedValue({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      }),
    };

    const manager = new WorkerManager({
      count: 1,
      queueService: service,
      pollIntervalMs: 20,
      logger: { log: jest.fn(), error: jest.fn() },
      executor,
    });

    manager.start();
    await sleep(80);
    await manager.stop();

    expect(executor.execute).toHaveBeenCalledWith("sleep 20", 5);
  });

  test("timeout failure uses existing retry and dead letter handling", async () => {
    service.enqueue({
      id: "job-timeout-retry",
      command: "sleep 20",
      max_retries: 1,
      timeout: 1,
    });

    const executor = {
      execute: jest.fn().mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "Job timed out after 1 seconds",
      }),
    };

    const manager = new WorkerManager({
      count: 1,
      queueService: service,
      pollIntervalMs: 20,
      logger: { log: jest.fn(), error: jest.fn() },
      executor,
    });

    manager.start();
    await sleep(80);
    await manager.stop();

    const updated = repo.findById("job-timeout-retry");
    expect(updated.state).toBe("dead");
    expect(updated.attempts).toBe(1);
    expect(updated.error).toBe("Job timed out after 1 seconds");
  });

  test("multiple workers do not duplicate execution", async () => {
    repo.createJob({ id: "job-c", command: "echo one", state: "pending" });

    const executor = {
      execute: jest.fn().mockImplementation(async () => {
        await sleep(20);
        return { exitCode: 0, stdout: "done", stderr: "" };
      }),
    };

    const manager = new WorkerManager({
      count: 3,
      queueService: service,
      pollIntervalMs: 20,
      logger: { log: jest.fn(), error: jest.fn() },
      executor,
    });

    manager.start();
    await sleep(150);
    await manager.stop();

    const updated = repo.findById("job-c");
    expect(updated.state).toBe("completed");
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  test("five workers process multiple jobs without duplicates", async () => {
    const jobIds = ["job-1", "job-2", "job-3", "job-4", "job-5", "job-6"];
    for (const jobId of jobIds) {
      repo.createJob({ id: jobId, command: `run ${jobId}`, state: "pending" });
    }

    const executedCommands = [];
    const executor = {
      execute: jest.fn().mockImplementation(async (command) => {
        executedCommands.push(command);
        await sleep(30);
        return { exitCode: 0, stdout: command, stderr: "" };
      }),
    };

    const manager = new WorkerManager({
      count: 5,
      queueService: service,
      pollIntervalMs: 10,
      logger: { log: jest.fn(), error: jest.fn() },
      executor,
    });

    manager.start();
    await sleep(250);
    await manager.stop();

    const completedJobs = repo.findByState("completed");
    const uniqueCommands = new Set(executedCommands);

    expect(completedJobs).toHaveLength(jobIds.length);
    expect(executedCommands).toHaveLength(jobIds.length);
    expect(uniqueCommands.size).toBe(jobIds.length);
  });
});
