/**
 * DB-mode persistence adapter for SessionManager.
 *
 * Replaces the debounced file-based SessionPersistenceQueue with
 * synchronous SQLite writes. All queue/flush/cancel operations become
 * no-ops because DB writes are immediate (< 1ms via WAL).
 *
 * Exports `sessionPersistenceQueue` and `getHeaderMetadataSignature` with
 * the same names as persistence-queue.ts so sessions/index.ts can re-export
 * them as drop-in replacements.
 */
import type { StoredSession, SessionHeader } from './types.ts';
import { saveSession } from './storage.db.ts';

/**
 * DB-backed session persistence — synchronous, no queue.
 *
 * Implements the same public interface as SessionPersistenceQueue so
 * SessionManager can use it as a drop-in replacement.
 */
class DbSessionPersistence {
  /** Write session to DB immediately (synchronous, < 1ms). */
  enqueue(session: StoredSession): void {
    saveSession(session);
  }

  /** No-op — DB writes are immediate, nothing to flush. */
  async flush(_sessionId: string): Promise<void> { /* no-op */ }

  /** No-op — DB writes are immediate, nothing to flush. */
  async flushAll(): Promise<void> { /* no-op */ }

  /** No-op — DB writes are immediate, nothing to cancel. */
  cancel(_sessionId: string): void { /* no-op */ }

  /** Always false — DB writes are immediate, never pending. */
  hasPending(_sessionId: string): boolean { return false; }

  /**
   * Not needed in DB mode — DB is the single source of truth,
   * so there's no external-change detection via signature comparison.
   */
  getLastWrittenSignature(_sessionId: string): string | undefined { return undefined; }

  /** Always 0 — nothing is ever pending. */
  get pendingCount(): number { return 0; }
}

/**
 * Singleton — same name as the file-based persistence-queue.ts export
 * so sessions/index.ts can re-export it transparently.
 */
export const sessionPersistenceQueue = new DbSessionPersistence();

/**
 * No-op signature function for DB mode.
 * In DB mode, the DB is the single source of truth — there's no need to
 * detect self-writes vs external writes via header signature comparison.
 */
export function getHeaderMetadataSignature(_header: SessionHeader): string {
  return '';
}
