function createConfigRepository(db) {
  const getConfigStatement = db.prepare("SELECT value FROM config WHERE key = ?");
  const setConfigStatement = db.prepare(`
    INSERT INTO config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  function getConfig(key) {
    try {
      const row = getConfigStatement.get(key);
      return row ? row.value : null;
    } catch (error) {
      throw new Error(`Failed to read config '${key}': ${error.message}`, {
        cause: error,
      });
    }
  }

  function setConfig(key, value) {
    try {
      setConfigStatement.run(key, value);
      return getConfig(key);
    } catch (error) {
      throw new Error(`Failed to write config '${key}': ${error.message}`, {
        cause: error,
      });
    }
  }

  return {
    getConfig,
    setConfig,
  };
}

module.exports = {
  createConfigRepository,
};
