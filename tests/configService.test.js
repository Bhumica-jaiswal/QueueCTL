const { createConnection } = require("../src/database/connection");
const { initDatabase } = require("../src/database/init");
const { createConfigRepository } = require("../src/repositories/configRepository");
const {
  createConfigService,
  ConfigValidationError,
} = require("../src/services/configService");

describe("configService", () => {
  let db;
  let service;

  beforeEach(() => {
    db = createConnection({ databasePath: ":memory:" });
    initDatabase(db);
    const configRepository = createConfigRepository(db);
    service = createConfigService({ configRepository });
  });

  afterEach(() => {
    db.close();
  });

  test("reads seeded numeric config", () => {
    expect(service.getNumber("max-retries")).toBe(0);
    expect(service.getNumber("backoff-base")).toBe(2);
  });

  test("sets supported numeric config", () => {
    expect(service.set("max-retries", "5")).toBe("5");
    expect(service.getNumber("max-retries")).toBe(5);
  });

  test("rejects unsupported and invalid config", () => {
    expect(() => service.set("bad-key", "1")).toThrow(ConfigValidationError);
    expect(() => service.set("max-retries", "-1")).toThrow(ConfigValidationError);
    expect(() => service.set("backoff-base", "0")).toThrow(ConfigValidationError);
  });
});
