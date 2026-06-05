import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const defaultSignalHistoryPath = path.join(process.cwd(), "data", "signal-history.jsonl");
const defaultPaperAccountPath = path.join(process.cwd(), "data", "paper-account.json");
const defaultPaperTradesPath = path.join(process.cwd(), "data", "paper-trades.jsonl");
const defaultSqlitePath = path.join(process.cwd(), "data", "market-monitor.sqlite");

let defaultStore = null;

function loadSqliteModule() {
  try {
    return require("node:sqlite");
  } catch {
    return null;
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function loadJsonl(filePath) {
  if (!existsSync(filePath)) return [];

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);
}

function appendJsonl(filePath, record) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, record) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

function dataStoreMode(value) {
  const mode = String(value ?? "auto").trim().toLowerCase();
  return ["auto", "sqlite", "file"].includes(mode) ? mode : "auto";
}

export function dataStoreConfigFromEnv(env = process.env) {
  return {
    mode: dataStoreMode(env.DATA_STORE ?? env.STORAGE_BACKEND ?? "auto"),
    sqlitePath: env.SQLITE_DB_PATH ?? defaultSqlitePath,
    signalHistoryPath: env.SIGNAL_HISTORY_PATH ?? defaultSignalHistoryPath,
    paperAccountPath: env.PAPER_ACCOUNT_PATH ?? defaultPaperAccountPath,
    paperTradesPath: env.PAPER_TRADES_PATH ?? defaultPaperTradesPath
  };
}

function createFileDataStore(config) {
  return {
    kind: "file",
    ok: true,
    reason: "json_files",
    info() {
      return {
        kind: "file",
        ok: true,
        signalHistoryPath: config.signalHistoryPath,
        paperAccountPath: config.paperAccountPath,
        paperTradesPath: config.paperTradesPath
      };
    },
    appendSignalRecord(record) {
      appendJsonl(config.signalHistoryPath, record);
      return true;
    },
    loadSignalRecords() {
      return loadJsonl(config.signalHistoryPath);
    },
    loadPaperAccountState() {
      return readJson(config.paperAccountPath, null);
    },
    savePaperAccountState(state) {
      writeJson(config.paperAccountPath, state);
      return true;
    },
    appendPaperTrade(trade) {
      appendJsonl(config.paperTradesPath, trade);
      return true;
    },
    loadPaperTrades() {
      return loadJsonl(config.paperTradesPath);
    }
  };
}

function tableCount(database, table) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function ensureSqliteSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS signal_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT,
      symbol TEXT,
      direction TEXT,
      action TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_signal_history_symbol_time
      ON signal_history(symbol, generated_at);
    CREATE INDEX IF NOT EXISTS idx_signal_history_action_time
      ON signal_history(action, generated_at);

    CREATE TABLE IF NOT EXISTS paper_account_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_trades (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      direction TEXT,
      opened_at TEXT,
      closed_at TEXT,
      net_pnl REAL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol_closed
      ON paper_trades(symbol, closed_at);
  `);
}

function insertSignalRecord(database, record) {
  database.prepare(`
    INSERT INTO signal_history (generated_at, symbol, direction, action, payload)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    record.generatedAt ?? null,
    record.symbol ?? null,
    record.direction ?? null,
    record.action ?? null,
    JSON.stringify(record)
  );
}

function insertPaperTrade(database, trade) {
  database.prepare(`
    INSERT OR REPLACE INTO paper_trades
      (id, symbol, direction, opened_at, closed_at, net_pnl, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(trade.id ?? `${trade.symbol ?? "TRADE"}:${trade.closedAt ?? Date.now()}`),
    trade.symbol ?? null,
    trade.direction ?? null,
    trade.openedAt ?? null,
    trade.closedAt ?? null,
    Number.isFinite(Number(trade.netPnl)) ? Number(trade.netPnl) : null,
    JSON.stringify(trade)
  );
}

function migrateFilesIntoSqlite(database, config) {
  if (tableCount(database, "signal_history") === 0 && existsSync(config.signalHistoryPath)) {
    const records = loadJsonl(config.signalHistoryPath);
    database.exec("BEGIN");
    try {
      for (const record of records) insertSignalRecord(database, record);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  if (tableCount(database, "paper_trades") === 0 && existsSync(config.paperTradesPath)) {
    const records = loadJsonl(config.paperTradesPath);
    database.exec("BEGIN");
    try {
      for (const record of records) insertPaperTrade(database, record);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  if (tableCount(database, "paper_account_state") === 0 && existsSync(config.paperAccountPath)) {
    const state = readJson(config.paperAccountPath, null);
    if (state) {
      database.prepare(`
        INSERT OR REPLACE INTO paper_account_state (id, payload, updated_at)
        VALUES (1, ?, ?)
      `).run(JSON.stringify(state), state.updatedAt ?? new Date().toISOString());
    }
  }
}

function createSqliteDataStore(config, sqliteModule) {
  mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  const database = new sqliteModule.DatabaseSync(config.sqlitePath);
  ensureSqliteSchema(database);
  migrateFilesIntoSqlite(database, config);

  return {
    kind: "sqlite",
    ok: true,
    reason: "node_sqlite",
    info() {
      return {
        kind: "sqlite",
        ok: true,
        sqlitePath: config.sqlitePath,
        signalRecords: tableCount(database, "signal_history"),
        paperTrades: tableCount(database, "paper_trades")
      };
    },
    appendSignalRecord(record) {
      insertSignalRecord(database, record);
      return true;
    },
    loadSignalRecords() {
      return database.prepare("SELECT payload FROM signal_history ORDER BY id ASC")
        .all()
        .map((row) => parseJsonLine(row.payload))
        .filter(Boolean);
    },
    loadPaperAccountState() {
      const row = database.prepare("SELECT payload FROM paper_account_state WHERE id = 1").get();
      return row ? parseJsonLine(row.payload) : null;
    },
    savePaperAccountState(state) {
      database.prepare(`
        INSERT OR REPLACE INTO paper_account_state (id, payload, updated_at)
        VALUES (1, ?, ?)
      `).run(JSON.stringify(state), state.updatedAt ?? new Date().toISOString());
      return true;
    },
    appendPaperTrade(trade) {
      insertPaperTrade(database, trade);
      return true;
    },
    loadPaperTrades() {
      return database.prepare("SELECT payload FROM paper_trades ORDER BY closed_at ASC, created_at ASC")
        .all()
        .map((row) => parseJsonLine(row.payload))
        .filter(Boolean);
    }
  };
}

export function createDataStore(config = dataStoreConfigFromEnv()) {
  const normalized = {
    ...dataStoreConfigFromEnv({}),
    ...config,
    mode: dataStoreMode(config.mode)
  };

  if (normalized.mode === "file") return createFileDataStore(normalized);

  const sqliteModule = loadSqliteModule();
  if (sqliteModule) return createSqliteDataStore(normalized, sqliteModule);

  const fileStore = createFileDataStore(normalized);
  fileStore.ok = normalized.mode !== "sqlite";
  fileStore.reason = "node_sqlite_unavailable";
  return fileStore;
}

export function getDefaultDataStore() {
  if (!defaultStore) defaultStore = createDataStore(dataStoreConfigFromEnv());
  return defaultStore;
}

export function defaultDataStoreInfo() {
  return getDefaultDataStore().info();
}
