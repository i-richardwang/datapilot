/**
 * Database Change Events
 *
 * Typed event emitter for DB mutation notifications.
 * Replaces ConfigWatcher's filesystem monitoring for entities stored in SQLite.
 *
 * Usage in storage.db.ts modules:
 *   import { dbEvents } from '../db/events.ts';
 *   dbEvents.emit('session:metadata', sessionId);
 *
 * Usage in ConfigWatcher or UI:
 *   import { dbEvents } from '../db/events.ts';
 *   dbEvents.on('session:metadata', (sessionId) => { ... });
 */

import { EventEmitter } from 'events';

/** Typed event map for database mutations */
export interface DbEventMap {
  // Session events
  'session:saved': [sessionId: string];
  'session:metadata': [sessionId: string];
  'session:deleted': [sessionId: string];
  'session:messages': [sessionId: string];

  // Status events
  'status:config': [];

  // Label events
  'label:config': [];

  // View events
  'view:config': [];

  // Source events
  'source:saved': [slug: string];
  'source:deleted': [slug: string];
  'source:list': [];

  // Workspace config events
  'workspace:config': [];

  // Automation events
  'automation:history': [];

  // Batch events
  'batch:state': [batchId: string];
}

class DbEventEmitter extends EventEmitter {
  emit<K extends keyof DbEventMap>(event: K, ...args: DbEventMap[K]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof DbEventMap>(event: K, listener: (...args: DbEventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof DbEventMap>(event: K, listener: (...args: DbEventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof DbEventMap>(event: K, listener: (...args: DbEventMap[K]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
}

/** Singleton event emitter for database change notifications */
export const dbEvents = new DbEventEmitter();
