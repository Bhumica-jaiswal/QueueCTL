const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createJobRepository } = require("../src/repositories/jobRepository");

const CLI_PATH = path.resolve(__dirname, "../src/cli/index.js");

describe("CLI list JSON output", () => {
  let tempDir;
  let db;
  let repo;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "queuectl-cli-"));
    db = createConnection({ databasePath: path.join(tempDir, "queuectl.db") });
    initDatabase(db);
    repo = createJobRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runList(...args) {
    return spawnSync(process.execPath, [CLI_PATH, "list", ...args], {
      cwd: tempDir,
      encoding: "utf8",
    });
  }

  test("prints complete jobs as valid JSON", () => {
    repo.createJob({ id: "json-job", command: "echo json", priority: 2 });

    const result = runList("--json");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const jobs = [repo.findById("json-job")];
    expect(result.stdout).toBe(`${JSON.stringify(jobs, null, 2)}\n`);
    expect(JSON.parse(result.stdout)).toEqual(jobs);
  });

  test("prints an empty JSON array when no jobs match", () => {
    const result = runList("--json");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("[]");
    expect(result.stderr).toBe("");
  });

  test("filters JSON output by state", () => {
    repo.createJob({ id: "pending-job", command: "echo pending", state: "pending" });
    repo.createJob({
      id: "completed-job",
      command: "echo completed",
      state: "completed",
    });

    const result = runList("--state", "completed", "--json");

    expect(JSON.parse(result.stdout)).toEqual([repo.findById("completed-job")]);
  });

  test("keeps the existing human-readable empty output", () => {
    const result = runList();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Queue is empty\n");
  });

  test("reports invalid states to stderr without JSON output", () => {
    const result = runList("--state", "invalid", "--json");

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid state 'invalid'");
  });
});
