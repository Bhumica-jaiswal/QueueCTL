const {
  buildEnqueuePayload,
  parseJobPayload,
  PayloadValidationError,
} = require("../src/cli/parseJobPayload");
const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createConfigRepository } = require("../src/repositories/configRepository");
const { createJobRepository } = require("../src/repositories/jobRepository");
const { createConfigService } = require("../src/services/configService");
const {
  createQueueService,
  QueueValidationError,
} = require("../src/services/queueService");
const { createWorkerRepository } = require("../src/repositories/workerRepository");
const { createWorkerService } = require("../src/services/workerService");

describe("CLI enqueue parsing", () => {
  let db;
  let queueService;
  let configService;
  let workerRepository;
  let workerService;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);

    const jobRepository = createJobRepository(db);
    workerRepository = createWorkerRepository(db);
    const configRepository = createConfigRepository(db);
    configService = createConfigService({ configRepository });
    queueService = createQueueService({ jobRepository, configService });
    workerService = createWorkerService({ workerRepository });
  });

  afterEach(() => {
    db.close();
  });

  test("valid JSON enqueue works", () => {
    expect(
      buildEnqueuePayload([
        '{"id":"job1","command":"echo hello","max_retries":2}',
      ])
    ).toEqual({
      id: "job1",
      command: "echo hello",
      max_retries: 2,
    });
  });

  test("JSON enqueue supports priority", () => {
    expect(
      buildEnqueuePayload([
        '{"id":"job1","command":"echo hello","priority":5}',
      ])
    ).toEqual({
      id: "job1",
      command: "echo hello",
      priority: 5,
    });
  });

  test("JSON enqueue supports timeout", () => {
    expect(
      buildEnqueuePayload([
        '{"id":"slow","command":"sleep 20","timeout":3}',
      ])
    ).toEqual({
      id: "slow",
      command: "sleep 20",
      timeout: 3,
    });
  });

  test("JSON enqueue supports run_at", () => {
    expect(
      buildEnqueuePayload([
        '{"id":"job1","command":"echo hello","run_at":"2026-07-10T10:00:00"}',
      ])
    ).toEqual({
      id: "job1",
      command: "echo hello",
      run_at: "2026-07-10T10:00:00",
    });
  });

  test("JSON enqueue preserves spaces when payload arrives in parts", () => {
    expect(
      buildEnqueuePayload(['{"id":"job1","command":"echo', 'hello"}'])
    ).toEqual({
      id: "job1",
      command: "echo hello",
    });
  });

  test("PowerShell-stripped JSON is repaired", () => {
    expect(buildEnqueuePayload(["{id:job1,command:echo hello}"])).toEqual({
      id: "job1",
      command: "echo hello",
    });
  });

  test("PowerShell-stripped JSON preserves run_at", () => {
    expect(
      buildEnqueuePayload([
        "{id:job1,command:echo hello,run_at:2026-07-10T10:00:00}",
      ])
    ).toEqual({
      id: "job1",
      command: "echo hello",
      run_at: "2026-07-10T10:00:00",
    });
  });

  test("PowerShell-stripped JSON preserves priority", () => {
    expect(buildEnqueuePayload(["{id:job1,command:echo hello,priority:5}"])).toEqual({
      id: "job1",
      command: "echo hello",
      priority: 5,
    });
  });

  test("PowerShell-stripped JSON preserves timeout", () => {
    expect(buildEnqueuePayload(["{id:slow,command:sleep 20,timeout:3}"])).toEqual({
      id: "slow",
      command: "sleep 20",
      timeout: 3,
    });
  });

  test("actually invalid JSON fails", () => {
    expect(() => buildEnqueuePayload(["{id:job1,command:"])).toThrow(
      PayloadValidationError
    );
    expect(() => buildEnqueuePayload(["{id:job1,command:"])).toThrow(
      "Invalid JSON payload"
    );
    expect(() => buildEnqueuePayload(["not-json-at-all"])).toThrow(
      PayloadValidationError
    );
    expect(() => buildEnqueuePayload(["not-json-at-all"])).toThrow(
      "Invalid JSON payload"
    );
  });

  test("flag based enqueue works", () => {
    expect(
      buildEnqueuePayload([], {
        id: "job1",
        command: "echo hello",
        maxRetries: "2",
      })
    ).toEqual({
      id: "job1",
      command: "echo hello",
      max_retries: 2,
    });
  });

  test("flag based enqueue supports run_at", () => {
    expect(
      buildEnqueuePayload([], {
        id: "job1",
        command: "echo hello",
        runAt: "2026-07-10T10:00:00",
      })
    ).toEqual({
      id: "job1",
      command: "echo hello",
      run_at: "2026-07-10T10:00:00",
    });
  });

  test("flag based enqueue supports priority", () => {
    expect(
      buildEnqueuePayload([], {
        id: "job1",
        command: "echo hello",
        priority: "10",
      })
    ).toEqual({
      id: "job1",
      command: "echo hello",
      priority: 10,
    });
  });

  test("flag based enqueue supports timeout", () => {
    expect(
      buildEnqueuePayload([], {
        id: "slow",
        command: "sleep 20",
        timeout: "3",
      })
    ).toEqual({
      id: "slow",
      command: "sleep 20",
      timeout: 3,
    });
  });

  test("missing id fails", () => {
    expect(() => queueService.enqueue(parseJobPayload('{"command":"echo hi"}'))).toThrow(
      QueueValidationError
    );
    expect(() =>
      queueService.enqueue(buildEnqueuePayload([], { command: "echo hi" }))
    ).toThrow("Missing required field: id");
  });

  test("missing command fails", () => {
    expect(() => queueService.enqueue(parseJobPayload('{"id":"job1"}'))).toThrow(
      QueueValidationError
    );
    expect(() =>
      queueService.enqueue(buildEnqueuePayload([], { id: "job1" }))
    ).toThrow("Missing required field: command");
  });

  test("rejects invalid max_retries", () => {
    expect(() =>
      queueService.enqueue(
        parseJobPayload('{"id":"job1","command":"echo hi","max_retries":-1}')
      )
    ).toThrow("max_retries must be a non-negative integer");
    expect(() =>
      queueService.enqueue(
        buildEnqueuePayload([], {
          id: "job1",
          command: "echo hi",
          maxRetries: "-1",
        })
      )
    ).toThrow("max_retries must be a non-negative integer");
  });

  test("worker stop request updates every running worker in the registry", () => {
    workerService.registerWorker("worker-a");
    workerService.registerWorker("worker-b");

    expect(workerService.stopAllWorkers()).toBe(2);

    expect(workerRepository.getWorkerStatus("worker-a")).toBe("stopping");
    expect(workerRepository.getWorkerStatus("worker-b")).toBe("stopping");
  });
});
