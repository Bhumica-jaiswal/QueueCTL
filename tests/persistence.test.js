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

test("initDatabase safely adds processing leases to existing job tables", () => {
  const legacyDb = createConnection({ databasePath: ":memory:" });
  legacyDb.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT,
      attempts INTEGER,
      max_retries INTEGER,
      created_at DATETIME,
      updated_at DATETIME,
      next_run_at DATETIME,
      output TEXT,
      error TEXT,
      worker_id TEXT,
      priority INTEGER DEFAULT 0,
      timeout INTEGER DEFAULT NULL
    )
  `);
  legacyDb.prepare(`
    INSERT INTO jobs (id, command, state, updated_at)
    VALUES (?, ?, ?, ?)
  `).run("legacy-processing-job", "echo legacy", "processing", "2026-01-01T00:00:00.000Z");

  initDatabase(legacyDb);

  const job = legacyDb
    .prepare("SELECT processing_started_at FROM jobs WHERE id = ?")
    .get("legacy-processing-job");
  expect(job.processing_started_at).toBe("2026-01-01T00:00:00.000Z");

  legacyDb.close();
});
