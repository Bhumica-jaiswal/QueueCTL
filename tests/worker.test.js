const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createJobRepository } = require("../src/repositories/jobRepository");
const { WorkerManager } = require("../src/workers/workerManager");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("worker processing", () => {
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
      jobRepository: repo,
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
    repo.createJob({ id: "job-b", command: "exit 1", state: "pending" });

    const executor = {
      execute: jest.fn().mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "failure",
      }),
    };

    const manager = new WorkerManager({
      count: 1,
      jobRepository: repo,
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
      jobRepository: repo,
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
});
