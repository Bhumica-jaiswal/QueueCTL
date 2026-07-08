const Database = require("better-sqlite3");

let sharedConnection = null;

function createConnection(options = {}) {
  const {
    databasePath = "queuectl.db",
    readonly = false,
    fileMustExist = false,
  } = options;

  try {
    const db = new Database(databasePath, {
      readonly,
      fileMustExist,
    });

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    return db;
  } catch (error) {
    throw new Error(`Failed to open SQLite database: ${error.message}`, {
      cause: error,
    });
  }
}

function getConnection(options = {}) {
  if (!sharedConnection) {
    sharedConnection = createConnection(options);
  }

  return sharedConnection;
}

function closeConnection() {
  if (!sharedConnection) {
    return;
  }

  try {
    sharedConnection.close();
    sharedConnection = null;
  } catch (error) {
    throw new Error(`Failed to close SQLite database: ${error.message}`, {
      cause: error,
    });
  }
}

module.exports = {
  createConnection,
  getConnection,
  closeConnection,
};
