/**
 * Database initialization — ensures the SQLite driver is registered before any commands run.
 */

import { autoRegisterDriver } from '@craft-agent/shared/db'

export async function ensureDb(): Promise<void> {
  await autoRegisterDriver()
}
