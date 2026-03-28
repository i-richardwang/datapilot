/**
 * Phase 4 Integration Tests — Automations History & Batch State
 *
 * Tests for:
 * - automations/history-store.db.ts: append + compaction retention
 * - batches/batch-state-manager.db.ts: state CRUD, test result CRUD + configHash
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sql } from 'drizzle-orm';
import { autoRegisterDriver } from '../driver.ts';
import { closeWorkspaceDb, getWorkspaceDb } from '../connection.ts';
import { automationHistory } from '../schema/automations.sql.ts';

// Automations
import {
  appendAutomationHistoryEntry,
  compactAutomationHistory,
  compactAutomationHistorySync,
} from '../../automations/history-store.db.ts';

// Batches
import {
  loadBatchState,
  saveBatchState,
  createInitialBatchState,
  updateItemState,
  computeProgress,
  isBatchDone,
  deleteBatchState,
  saveTestResult,
  loadTestResult,
  deleteTestResult,
} from '../../batches/batch-state-manager.db.ts';

import type { BatchState, TestBatchResult } from '../../batches/types.ts';

beforeAll(async () => {
  await autoRegisterDriver();
});

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'datapilot-phase4-test-'));
});

afterEach(() => {
  closeWorkspaceDb(testDir);
  rmSync(testDir, { recursive: true, force: true });
});

// ─── Automations History ─────────────────────────────────────────────────────

describe('Automation History DB Store', () => {
  test('appendAutomationHistoryEntry inserts entry', async () => {
    await appendAutomationHistoryEntry(testDir, {
      id: 'auto-1',
      event: 'test',
      timestamp: Date.now(),
    });

    const db = getWorkspaceDb(testDir);
    const rows = db.select().from(automationHistory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.automationId).toBe('auto-1');
    expect((rows[0]!.entry as Record<string, unknown>).event).toBe('test');
  });

  test('appendAutomationHistoryEntry handles multiple entries', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAutomationHistoryEntry(testDir, {
        id: `auto-${i % 2}`,
        event: `event-${i}`,
        timestamp: Date.now(),
      });
    }

    const db = getWorkspaceDb(testDir);
    const count = db.all<{ cnt: number }>(sql`SELECT count(*) as cnt FROM automation_history`);
    expect(count[0]!.cnt).toBe(5);
  });

  test('compactAutomationHistorySync per-automation retention', async () => {
    // Insert 10 entries for auto-1
    for (let i = 0; i < 10; i++) {
      await appendAutomationHistoryEntry(testDir, {
        id: 'auto-1',
        event: `event-${i}`,
        timestamp: Date.now() + i,
      });
    }

    // Compact: keep only 3 per automation
    compactAutomationHistorySync(testDir, 3, 1000);

    const db = getWorkspaceDb(testDir);
    const count = db.all<{ cnt: number }>(sql`SELECT count(*) as cnt FROM automation_history`);
    expect(count[0]!.cnt).toBe(3);
  });

  test('compactAutomationHistorySync global cap', async () => {
    // Insert 20 entries across 4 automations (5 each)
    for (let i = 0; i < 20; i++) {
      await appendAutomationHistoryEntry(testDir, {
        id: `auto-${i % 4}`,
        event: `event-${i}`,
        timestamp: Date.now() + i,
      });
    }

    // Per-automation: keep 5 (no change), global: keep 8
    compactAutomationHistorySync(testDir, 5, 8);

    const db = getWorkspaceDb(testDir);
    const count = db.all<{ cnt: number }>(sql`SELECT count(*) as cnt FROM automation_history`);
    expect(count[0]!.cnt).toBe(8);
  });

  test('compactAutomationHistory async works same as sync', async () => {
    for (let i = 0; i < 10; i++) {
      await appendAutomationHistoryEntry(testDir, {
        id: 'auto-1',
        event: `event-${i}`,
        timestamp: Date.now() + i,
      });
    }

    await compactAutomationHistory(testDir, 2, 100);

    const db = getWorkspaceDb(testDir);
    const count = db.all<{ cnt: number }>(sql`SELECT count(*) as cnt FROM automation_history`);
    expect(count[0]!.cnt).toBe(2);
  });

  test('compaction keeps most recent entries', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAutomationHistoryEntry(testDir, {
        id: 'auto-1',
        event: `event-${i}`,
        timestamp: Date.now() + i * 100,
      });
    }

    compactAutomationHistorySync(testDir, 2, 100);

    const db = getWorkspaceDb(testDir);
    const rows = db.select().from(automationHistory).all();
    expect(rows).toHaveLength(2);
    // Should keep the last 2 entries
    const events = rows.map(r => (r.entry as Record<string, unknown>).event);
    expect(events).toContain('event-3');
    expect(events).toContain('event-4');
  });
});

// ─── Batch State ─────────────────────────────────────────────────────────────

describe('Batch State DB Manager', () => {
  test('loadBatchState returns null for nonexistent', () => {
    expect(loadBatchState(testDir, 'nonexistent')).toBeNull();
  });

  test('saveBatchState and loadBatchState round-trip', () => {
    const state = createInitialBatchState('batch-1', ['item-a', 'item-b', 'item-c']);
    saveBatchState(testDir, state);

    const loaded = loadBatchState(testDir, 'batch-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.batchId).toBe('batch-1');
    expect(loaded!.totalItems).toBe(3);
    expect(loaded!.status).toBe('pending');
    expect(Object.keys(loaded!.items)).toHaveLength(3);
  });

  test('saveBatchState upserts on conflict', () => {
    const state = createInitialBatchState('batch-1', ['item-a']);
    saveBatchState(testDir, state);

    state.status = 'running';
    updateItemState(state, 'item-a', { status: 'running', startedAt: Date.now() });
    saveBatchState(testDir, state);

    const loaded = loadBatchState(testDir, 'batch-1');
    expect(loaded!.status).toBe('running');
    expect(loaded!.items['item-a']!.status).toBe('running');
  });

  test('deleteBatchState removes state', () => {
    const state = createInitialBatchState('batch-del', ['item-1']);
    saveBatchState(testDir, state);

    deleteBatchState(testDir, 'batch-del');
    expect(loadBatchState(testDir, 'batch-del')).toBeNull();
  });

  test('createInitialBatchState returns correct structure', () => {
    const state = createInitialBatchState('test-batch', ['a', 'b']);
    expect(state.batchId).toBe('test-batch');
    expect(state.status).toBe('pending');
    expect(state.totalItems).toBe(2);
    expect(state.items.a!.status).toBe('pending');
    expect(state.items.a!.retryCount).toBe(0);
    expect(state.items.b!.status).toBe('pending');
  });

  test('updateItemState mutates in place', () => {
    const state = createInitialBatchState('test', ['item-1']);
    updateItemState(state, 'item-1', { status: 'completed', completedAt: 123 });
    expect(state.items['item-1']!.status).toBe('completed');
    expect(state.items['item-1']!.completedAt).toBe(123);
  });

  test('computeProgress returns correct counts', () => {
    const state = createInitialBatchState('test', ['a', 'b', 'c', 'd']);
    updateItemState(state, 'a', { status: 'completed' });
    updateItemState(state, 'b', { status: 'failed' });
    updateItemState(state, 'c', { status: 'running' });
    // d remains pending

    const progress = computeProgress(state);
    expect(progress.completedItems).toBe(1);
    expect(progress.failedItems).toBe(1);
    expect(progress.runningItems).toBe(1);
    expect(progress.pendingItems).toBe(1);
    expect(progress.totalItems).toBe(4);
  });

  test('isBatchDone returns correct state', () => {
    const state = createInitialBatchState('test', ['a', 'b']);
    expect(isBatchDone(state)).toBe(false);

    updateItemState(state, 'a', { status: 'completed' });
    expect(isBatchDone(state)).toBe(false);

    updateItemState(state, 'b', { status: 'failed' });
    expect(isBatchDone(state)).toBe(true);
  });
});

// ─── Test Results ────────────────────────────────────────────────────────────

describe('Batch Test Results', () => {
  const makeTestResult = (batchId: string): TestBatchResult => ({
    batchId,
    testKey: `${batchId}__test`,
    sampleSize: 3,
    status: 'completed',
    durationMs: 1234,
    items: [
      { itemId: 'item-1', status: 'completed', durationMs: 400 },
      { itemId: 'item-2', status: 'completed', durationMs: 500 },
      { itemId: 'item-3', status: 'failed', error: 'timeout' },
    ],
  });

  test('loadTestResult returns null for nonexistent', () => {
    expect(loadTestResult(testDir, 'nonexistent')).toBeNull();
  });

  test('saveTestResult and loadTestResult round-trip', () => {
    const result = makeTestResult('batch-1');
    saveTestResult(testDir, result, 'hash-abc123');

    const loaded = loadTestResult(testDir, 'batch-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.result.batchId).toBe('batch-1');
    expect(loaded!.result.sampleSize).toBe(3);
    expect(loaded!.result.items).toHaveLength(3);
    expect(loaded!.configHash).toBe('hash-abc123');
    expect(loaded!.persistedAt).toBeGreaterThan(0);
  });

  test('saveTestResult upserts on conflict', () => {
    const result = makeTestResult('batch-1');
    saveTestResult(testDir, result, 'hash-v1');

    const updatedResult = { ...result, status: 'failed' as const };
    saveTestResult(testDir, updatedResult, 'hash-v2');

    const loaded = loadTestResult(testDir, 'batch-1');
    expect(loaded!.result.status).toBe('failed');
    expect(loaded!.configHash).toBe('hash-v2');
  });

  test('configHash validates staleness', () => {
    const result = makeTestResult('batch-1');
    saveTestResult(testDir, result, 'original-hash');

    const loaded = loadTestResult(testDir, 'batch-1');
    expect(loaded!.configHash).toBe('original-hash');

    // A caller would compare configHash to current config hash
    // If different, the result is stale
    expect(loaded!.configHash !== 'new-config-hash').toBe(true);
  });

  test('deleteTestResult removes result', () => {
    const result = makeTestResult('batch-del');
    saveTestResult(testDir, result, 'hash');

    deleteTestResult(testDir, 'batch-del');
    expect(loadTestResult(testDir, 'batch-del')).toBeNull();
  });

  test('deleteTestResult is safe for nonexistent', () => {
    // Should not throw
    deleteTestResult(testDir, 'nonexistent');
  });
});
