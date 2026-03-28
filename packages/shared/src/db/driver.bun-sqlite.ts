/**
 * bun:sqlite driver for Bun runtime.
 *
 * Used when running on the Bun server backend.
 * Zero-dependency — `bun:sqlite` is built into the Bun runtime.
 */

import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// Track raw connections so we can close them
const rawConnections = new WeakMap<BunSQLiteDatabase, Database>();

export function createBunDatabase(dbPath: string): BunSQLiteDatabase {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  rawConnections.set(db, sqlite);
  return db;
}

export function closeBunDatabase(db: BunSQLiteDatabase): void {
  const sqlite = rawConnections.get(db);
  if (sqlite) {
    sqlite.close();
    rawConnections.delete(db);
  }
}
