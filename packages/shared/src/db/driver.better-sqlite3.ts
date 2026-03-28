/**
 * better-sqlite3 driver for Node.js / Electron.
 *
 * Used when running in the Electron main process or any Node.js environment.
 * better-sqlite3 provides a synchronous API which is ideal for Electron's
 * single-threaded main process.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Track raw connections so we can close them
const rawConnections = new WeakMap<BetterSQLite3Database, Database.Database>();

export function createBetterSqlite3Database(dbPath: string): BetterSQLite3Database {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  rawConnections.set(db, sqlite);
  return db;
}

export function closeBetterSqlite3Database(db: BetterSQLite3Database): void {
  const sqlite = rawConnections.get(db);
  if (sqlite) {
    sqlite.close();
    rawConnections.delete(db);
  }
}
