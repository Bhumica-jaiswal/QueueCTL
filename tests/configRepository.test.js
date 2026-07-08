const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createConfigRepository } = require("../src/repositories/configRepository");

describe("configRepository", () => {
  let db;
  let repo;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);
    repo = createConfigRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("getConfig returns null for missing keys", () => {
    expect(repo.getConfig("missing")).toBeNull();
  });

  test("setConfig writes and updates config values", () => {
    const first = repo.setConfig("worker.pollIntervalMs", "1000");
    expect(first).toBe("1000");
    expect(repo.getConfig("worker.pollIntervalMs")).toBe("1000");

    const second = repo.setConfig("worker.pollIntervalMs", "2000");
    expect(second).toBe("2000");
    expect(repo.getConfig("worker.pollIntervalMs")).toBe("2000");
  });
});
