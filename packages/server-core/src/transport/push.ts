/**
 * Re-export the dispatcher-bound `pushTyped` from rpc-engine.
 *
 * Kept here so existing call sites
 * (`import { pushTyped } from '@craft-agent/server-core/transport'`)
 * continue to work without churn.
 */

export { pushTyped } from '@craft-agent/rpc-engine'
