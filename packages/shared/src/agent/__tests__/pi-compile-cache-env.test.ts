/**
 * resolveNodeCompileCacheEnv — the spawn-env hook that lets pi-agent-server
 * subprocesses reuse V8 compile artifacts across spawns (batch runs spawn one
 * subprocess per item, each otherwise re-parsing the ~27MB server bundle).
 * Must defer to an explicit NODE_COMPILE_CACHE from the caller's environment
 * (it inherits through the env spread) and honor the official opt-out.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { resolveNodeCompileCacheEnv } from '../pi-agent.ts';
import { CONFIG_DIR } from '../../config/paths.ts';

describe('resolveNodeCompileCacheEnv', () => {
  it('points the subprocess at the shared cache dir by default', () => {
    expect(resolveNodeCompileCacheEnv({})).toEqual({
      NODE_COMPILE_CACHE: join(CONFIG_DIR, 'cache', 'node-compile-cache'),
    });
  });

  it('defers to an explicit NODE_COMPILE_CACHE from the parent env', () => {
    expect(resolveNodeCompileCacheEnv({ NODE_COMPILE_CACHE: '/custom/cache' })).toEqual({});
  });

  it('respects the official NODE_DISABLE_COMPILE_CACHE opt-out', () => {
    expect(resolveNodeCompileCacheEnv({ NODE_DISABLE_COMPILE_CACHE: '1' })).toEqual({});
  });

  it('defers to a position taken via merged connection envOverrides', () => {
    // The spawn site passes { ...process.env, ...envOverrides } — a
    // per-connection override must suppress the default exactly like a
    // process-level variable would.
    const merged: NodeJS.ProcessEnv = { NODE_COMPILE_CACHE: '/override/cache' };
    expect(resolveNodeCompileCacheEnv(merged)).toEqual({});
  });
});
