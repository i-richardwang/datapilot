/**
 * Runtime-adaptive SQLite driver factory.
 *
 * Uses a registration pattern: the correct driver is registered once at app
 * startup, then all subsequent calls are synchronous. This matches the
 * synchronous I/O pattern used throughout the codebase.
 *
 * Registration:
 *   - Electron main: `registerDriver(createBetterSqlite3Database, closeBetterSqlite3Database)`
 *   - Bun server: `registerDriver(createBunDatabase, closeBunDatabase)`
 *   - Auto: `await autoRegisterDriver()` — detects runtime and registers automatically
 *
 * After registration:
 *   - `createDrizzleDatabase(path)` → synchronous
 *   - `closeDrizzleDatabase(db)` → synchronous
 */

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

export type DrizzleDatabase = BaseSQLiteDatabase<'sync', unknown>;

export type CreateFn = (dbPath: string) => DrizzleDatabase;
export type CloseFn = (db: DrizzleDatabase) => void;

let _create: CreateFn | null = null;
let _close: CloseFn | null = null;

export function isBunRuntime(): boolean {
  return typeof globalThis.Bun !== 'undefined';
}

/**
 * Register the SQLite driver functions. Call once at app startup.
 */
export function registerDriver(create: CreateFn, close: CloseFn): void {
  _create = create;
  _close = close;
}

/**
 * Auto-detect runtime and register the appropriate driver.
 * Uses dynamic import (async) — call once at startup, then everything is sync.
 */
export async function autoRegisterDriver(): Promise<void> {
  if (_create) return; // Already registered
  if (isBunRuntime()) {
    const { createBunDatabase, closeBunDatabase } = await import('./driver.bun-sqlite.ts');
    registerDriver(createBunDatabase, closeBunDatabase as CloseFn);
  } else {
    const { createBetterSqlite3Database, closeBetterSqlite3Database } = await import('./driver.better-sqlite3.ts');
    registerDriver(createBetterSqlite3Database, closeBetterSqlite3Database as CloseFn);
  }
}

/**
 * Check whether a SQLite driver has been registered.
 * Used to conditionally enable DB-backed storage at module load time.
 */
export function isDriverRegistered(): boolean {
  return _create !== null;
}

/**
 * Create a Drizzle database instance. Synchronous — requires prior driver registration.
 */
export function createDrizzleDatabase(dbPath: string): DrizzleDatabase {
  if (!_create) {
    throw new Error(
      'SQLite driver not registered. Call autoRegisterDriver() or registerDriver() at app startup.'
    );
  }
  return _create(dbPath);
}

/**
 * Close a Drizzle database instance. Synchronous.
 */
export function closeDrizzleDatabase(db: DrizzleDatabase): void {
  if (!_close) {
    throw new Error(
      'SQLite driver not registered. Call autoRegisterDriver() or registerDriver() at app startup.'
    );
  }
  _close(db);
}
