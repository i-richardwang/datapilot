import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getLastApiError,
  setStoredError,
  toolMetadataStore,
} from '../interceptor-common.ts';

describe('interceptor-common', () => {
  let sessionDirA: string;
  let sessionDirB: string;

  beforeEach(() => {
    sessionDirA = mkdtempSync(join(tmpdir(), 'interceptor-a-'));
    sessionDirB = mkdtempSync(join(tmpdir(), 'interceptor-b-'));
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDirA, { recursive: true, force: true });
    rmSync(sessionDirB, { recursive: true, force: true });
  });

  it('keeps API errors session-scoped when session dir is switched', () => {
    toolMetadataStore.setSessionDir(sessionDirA);
    setStoredError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'Session A auth failed',
      timestamp: Date.now(),
    });

    toolMetadataStore.setSessionDir(sessionDirB);
    setStoredError({
      status: 429,
      statusText: 'Too Many Requests',
      message: 'Session B rate limit',
      timestamp: Date.now(),
    });

    toolMetadataStore.setSessionDir(sessionDirA);
    const errA = getLastApiError();
    expect(errA?.status).toBe(401);

    toolMetadataStore.setSessionDir(sessionDirB);
    const errB = getLastApiError();
    expect(errB?.status).toBe(429);
  });

  it('merges new metadata with existing on-disk entries', () => {
    const existing = {
      existingTool: {
        intent: 'Existing',
        displayName: 'Existing Tool',
        timestamp: Date.now() - 1000,
      },
    };

    writeFileSync(join(sessionDirA, 'tool-metadata.json'), JSON.stringify(existing), 'utf-8');
    toolMetadataStore.setSessionDir(sessionDirA);

    toolMetadataStore.set('newTool', {
      intent: 'New intent',
      displayName: 'New Tool',
      timestamp: Date.now(),
    });

    const persisted = JSON.parse(readFileSync(join(sessionDirA, 'tool-metadata.json'), 'utf-8')) as Record<string, unknown>;
    expect(persisted.existingTool).toBeDefined();
    expect(persisted.newTool).toBeDefined();
  });

  // Regression: two concurrent sessions referencing the same tool_use_id
  // must not bleed into each other's reads. Pre-fix, the in-memory map was
  // keyed by toolUseId alone, so the second setSessionDir() (or any get()
  // miss) would overwrite the first session's cached entry with the second's.
  it('isolates per-session metadata when tool_use_ids overlap across sessions', () => {
    const sharedId = 'toolu_overlap';
    const metaA = { intent: 'A intent', displayName: 'A name', timestamp: 1 };
    const metaB = { intent: 'B intent', displayName: 'B name', timestamp: 2 };

    writeFileSync(join(sessionDirA, 'tool-metadata.json'), JSON.stringify({ [sharedId]: metaA }), 'utf-8');
    writeFileSync(join(sessionDirB, 'tool-metadata.json'), JSON.stringify({ [sharedId]: metaB }), 'utf-8');

    // Simulate the main-process flow: session A registers, then session B.
    toolMetadataStore.setSessionDir(sessionDirA);
    toolMetadataStore.setSessionDir(sessionDirB);

    // Each session reads back its own intent — neither sees the other's.
    expect(toolMetadataStore.get(sharedId, sessionDirA)?.intent).toBe('A intent');
    expect(toolMetadataStore.get(sharedId, sessionDirB)?.intent).toBe('B intent');

    // Reverse order also holds (no ordering bias in the cache).
    expect(toolMetadataStore.get(sharedId, sessionDirB)?.intent).toBe('B intent');
    expect(toolMetadataStore.get(sharedId, sessionDirA)?.intent).toBe('A intent');
  });

  it('does not leak via cache-miss read path when sessions share a tool_use_id', () => {
    const sharedId = 'toolu_miss_path';
    const metaA = { intent: 'A intent', displayName: 'A', timestamp: 1 };
    const metaB = { intent: 'B intent', displayName: 'B', timestamp: 2 };

    writeFileSync(join(sessionDirA, 'tool-metadata.json'), JSON.stringify({ [sharedId]: metaA }), 'utf-8');
    writeFileSync(join(sessionDirB, 'tool-metadata.json'), JSON.stringify({ [sharedId]: metaB }), 'utf-8');

    // No setSessionDir() — exercise the cache-miss → file-read path directly.
    // First get caches under (sessionDirA, id); second get must still resolve
    // (sessionDirB, id) from disk, not return the cached A entry.
    expect(toolMetadataStore.get(sharedId, sessionDirA)?.intent).toBe('A intent');
    expect(toolMetadataStore.get(sharedId, sessionDirB)?.intent).toBe('B intent');
    expect(toolMetadataStore.get(sharedId, sessionDirA)?.intent).toBe('A intent');
  });
});
