import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { buildClaudeSubprocessEnv } from '../options.ts';

/**
 * Contract tests for per-session env overrides in the Claude SDK subprocess.
 *
 * These exist to guard against a class of cross-session contamination bug
 * where the subprocess inherits a stale session scope from the parent's
 * global process.env. The fix relies on envOverrides taking precedence
 * over process.env, so these tests lock that precedence.
 */
describe('buildClaudeSubprocessEnv', () => {
  const originalSessionDir = process.env.CRAFT_SESSION_DIR;
  const originalWorkspacePath = process.env.CRAFT_WORKSPACE_PATH;

  beforeEach(() => {
    delete process.env.CRAFT_SESSION_DIR;
    delete process.env.CRAFT_WORKSPACE_PATH;
  });

  afterEach(() => {
    if (originalSessionDir === undefined) delete process.env.CRAFT_SESSION_DIR;
    else process.env.CRAFT_SESSION_DIR = originalSessionDir;
    if (originalWorkspacePath === undefined) delete process.env.CRAFT_WORKSPACE_PATH;
    else process.env.CRAFT_WORKSPACE_PATH = originalWorkspacePath;
  });

  it('applies per-session CRAFT_SESSION_DIR from envOverrides', () => {
    const env = buildClaudeSubprocessEnv({ CRAFT_SESSION_DIR: '/sessions/A' });
    expect(env.CRAFT_SESSION_DIR).toBe('/sessions/A');
  });

  it('envOverrides.CRAFT_SESSION_DIR wins over a stale process.env.CRAFT_SESSION_DIR', () => {
    // Simulate the race the bug fix addresses: a newer session's creation
    // mutated process.env before the current session spawned its subprocess.
    // The per-session override must still win so the subprocess writes to
    // the correct session's tool-metadata.json.
    process.env.CRAFT_SESSION_DIR = '/sessions/stale-from-another-session';
    const env = buildClaudeSubprocessEnv({ CRAFT_SESSION_DIR: '/sessions/current' });
    expect(env.CRAFT_SESSION_DIR).toBe('/sessions/current');
  });

  it('keeps process.env values when no override is provided', () => {
    process.env.CRAFT_SESSION_DIR = '/sessions/from-parent';
    const env = buildClaudeSubprocessEnv();
    expect(env.CRAFT_SESSION_DIR).toBe('/sessions/from-parent');
  });

  it('applies multiple per-session overrides together', () => {
    const env = buildClaudeSubprocessEnv({
      CRAFT_SESSION_DIR: '/sessions/A',
      CRAFT_WORKSPACE_PATH: '/workspaces/A',
    });
    expect(env.CRAFT_SESSION_DIR).toBe('/sessions/A');
    expect(env.CRAFT_WORKSPACE_PATH).toBe('/workspaces/A');
  });
});
