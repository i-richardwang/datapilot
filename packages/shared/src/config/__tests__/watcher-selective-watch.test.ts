/**
 * Regression tests for DB-mode selective workspace watching.
 *
 * In DB mode the ConfigWatcher no longer recursively watches the whole
 * workspace root (which would register a watch per sessions/{id} directory —
 * tens of seconds at startup for large workspaces). Instead it watches the
 * root non-recursively plus the sources/, skills/, statuses/ subtrees.
 * These tests pin both halves of that contract: the watch scope itself, and
 * that subtree events still reach the existing relative-path routing with
 * the subtree prefix restored.
 */
import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConfigWatcher as ConfigWatcherClass } from '../watcher.ts';

// CONFIG_DIR is captured at module load from DATAPILOT_CONFIG_DIR, so point it
// at a tmpdir BEFORE importing watcher.ts — start() mkdirs/watches inside it.
// (Best-effort: if another test file in the same process already loaded
// paths.ts, the cached value wins; this still isolates standalone runs.)
const configDir = mkdtempSync(join(tmpdir(), 'watcher-config-'));
process.env.DATAPILOT_CONFIG_DIR = configDir;

let ConfigWatcher: typeof ConfigWatcherClass;

beforeAll(async () => {
  ({ ConfigWatcher } = await import('../watcher.ts'));
});

const EVENT_TIMEOUT_MS = 3000;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms)),
  ]);
}

describe('ConfigWatcher selective watching (DB mode)', () => {
  let tempDir: string | undefined;
  let watcher: ConfigWatcherClass | undefined;

  afterEach(() => {
    watcher?.stop();
    watcher = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('never watches the workspace root (and so sessions/) recursively', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'watcher-selective-'));
    mkdirSync(join(tempDir, 'sessions', '260101-some-session'), { recursive: true });

    watcher = new ConfigWatcher(tempDir, {});
    watcher.start();

    const roots = watcher._getWorkspaceWatchRoots();

    // The workspace root itself must be watched non-recursively
    const rootEntries = roots.filter((r) => !r.recursive);
    expect(rootEntries).toHaveLength(1);

    // Recursive watches are allowed only on the explicit subtree allowlist —
    // never on the root and never on sessions/
    const recursiveBasenames = roots.filter((r) => r.recursive).map((r) => basename(r.path));
    expect(recursiveBasenames.sort()).toEqual(['skills', 'sources', 'statuses']);
  });

  it('still delivers source permissions.json changes from the sources/ subtree watcher', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'watcher-selective-'));
    // Create the source folder before start() — Bun's recursive watch on
    // Linux doesn't track directories created after the watcher starts.
    const sourceDir = join(tempDir, 'sources', 'my-source');
    mkdirSync(sourceDir, { recursive: true });

    const changed = deferred<string>();
    watcher = new ConfigWatcher(tempDir, {
      onSourcePermissionsChange: (slug) => changed.resolve(slug),
    });
    watcher.start();

    // Give the watchers a moment to attach before producing the event
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(sourceDir, 'permissions.json'), '{}', 'utf-8');

    const slug = await withTimeout(changed.promise, EVENT_TIMEOUT_MS);
    expect(slug).toBe('my-source');
  });

  it('does not emit session metadata changes for sessions/ file writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'watcher-selective-'));
    const sessionDir = join(tempDir, 'sessions', '260101-test-session');
    mkdirSync(sessionDir, { recursive: true });

    const sessionEvent = deferred<string>();
    watcher = new ConfigWatcher(tempDir, {
      onSessionMetadataChange: (sessionId) => sessionEvent.resolve(sessionId),
    });
    watcher.start();

    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(sessionDir, 'session.jsonl'), '{}\n', 'utf-8');

    // DB mode must not surface filesystem session events (they arrive via
    // dbEvents instead); 500ms comfortably covers the 100-300ms debounce.
    const result = await withTimeout(sessionEvent.promise, 500);
    expect(result).toBe('timeout');
  });
});
