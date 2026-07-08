const fs = require("fs");
const os = require("os");
const path = require("path");
const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createConfigRepository } = require("../src/repositories/configRepository");
const { createJobRepository } = require("../src/repositories/jobRepository");
const { createConfigService } = require("../src/services/configService");
const { createQueueService } = require("../src/services/queueService");

function createServices(databasePath) {
  const db = createConnection({ databasePath });
  initDatabase(db);

  const jobRepository = createJobRepository(db);
  const configRepository = createConfigRepository(db);
  const configService = createConfigService({ configRepository });
  const queueService = createQueueService({ jobRepository, configService });

  return {
    db,
    configService,
    queueService,
  };
}

describe("persistence", () => {
  let tempDir;
  let databasePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "queuectl-"));
    databasePath = path.join(tempDir, "queuectl.db");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("jobs and config persist after database restart", () => {
    const first = createServices(databasePath);
    first.configService.set("max-retries", "4");
    first.queueService.enqueue({ id: "persisted-job", command: "echo saved" });
    first.db.close();

    const second = createServices(databasePath);
    const jobs = second.queueService.list();

    expect(second.configService.getNumber("max-retries")).toBe(4);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("persisted-job");
    expect(jobs[0].state).toBe("pending");

    second.db.close();
  });
});
