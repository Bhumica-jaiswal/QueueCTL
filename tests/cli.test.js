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

describe("CLI enqueue parsing", () => {
  let db;
  let queueService;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);

    const jobRepository = createJobRepository(db);
    const configRepository = createConfigRepository(db);
    const configService = createConfigService({ configRepository });
    queueService = createQueueService({ jobRepository, configService });
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
});
