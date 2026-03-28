/**
 * Integration test for DB infrastructure.
 *
 * Verifies that:
 * 1. Database creation and migration works
 * 2. All tables are created correctly
 * 3. Basic CRUD operations work via Drizzle ORM
 * 4. SQLite pragmas are applied
 * 5. Connection lifecycle (open, close) works
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { eq, sql } from 'drizzle-orm';
import { autoRegisterDriver } from '../driver.ts';
import { getWorkspaceDb, closeWorkspaceDb } from '../connection.ts';

beforeAll(async () => {
  await autoRegisterDriver();
});
import {
  statuses, statusMeta,
  labelConfig,
  viewsConfig,
  workspaceConfig,
  sources,
  sessions, messages,
  automationHistory,
  batchState, batchTestResults,
} from '../schema/index.ts';
import { dbEvents } from '../events.ts';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'datapilot-db-test-'));
});

afterEach(async () => {
  closeWorkspaceDb(testDir);
  rmSync(testDir, { recursive: true, force: true });
});

describe('DB Infrastructure', () => {
  test('creates database and runs migrations', async () => {
    const db = getWorkspaceDb(testDir);
    expect(db).toBeDefined();

    // Verify migration tracking table exists
    const migrations = db.all<{ name: string }>(sql`SELECT name FROM _migrations`);
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].name).toBe('0000_initial');
  });

  test('applies WAL pragma', async () => {
    const db = getWorkspaceDb(testDir);
    const result = db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
    expect(result[0].journal_mode).toBe('wal');
  });

  test('applies foreign_keys pragma', async () => {
    const db = getWorkspaceDb(testDir);
    const result = db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
    expect(result[0].foreign_keys).toBe(1);
  });

  test('returns cached connection on second call', async () => {
    const db1 = getWorkspaceDb(testDir);
    const db2 = getWorkspaceDb(testDir);
    expect(db1).toBe(db2);
  });

  test('closes connection cleanly', async () => {
    getWorkspaceDb(testDir);
    closeWorkspaceDb(testDir);

    // Should create a new connection after close
    const db = getWorkspaceDb(testDir);
    expect(db).toBeDefined();
  });
});

describe('Statuses table', () => {
  test('CRUD operations', async () => {
    const db = getWorkspaceDb(testDir);

    // Insert meta
    db.insert(statusMeta).values({ id: 1, version: 1, defaultStatusId: 'todo' }).run();

    // Insert status
    db.insert(statuses).values({
      id: 'todo',
      label: 'Todo',
      color: JSON.stringify({ hue: 200 }),
      category: 'open',
      isFixed: true,
      isDefault: true,
      order: 0,
    }).run();

    // Read
    const rows = db.select().from(statuses).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('todo');
    expect(rows[0].label).toBe('Todo');
    expect(rows[0].category).toBe('open');
    expect(rows[0].isFixed).toBe(true);

    // Update
    db.update(statuses).set({ label: 'To Do' }).where(eq(statuses.id, 'todo')).run();
    const updated = db.select().from(statuses).where(eq(statuses.id, 'todo')).get();
    expect(updated?.label).toBe('To Do');

    // Delete
    db.delete(statuses).where(eq(statuses.id, 'todo')).run();
    const deleted = db.select().from(statuses).all();
    expect(deleted).toHaveLength(0);
  });
});

describe('Labels table', () => {
  test('stores and retrieves JSON tree', async () => {
    const db = getWorkspaceDb(testDir);
    const tree = [
      { id: 'dev', name: 'Development', color: { hue: 200 }, children: [
        { id: 'code', name: 'Code', color: { hue: 210 } },
      ]},
    ];

    db.insert(labelConfig).values({ id: 1, version: 1, labels: tree }).run();
    const row = db.select().from(labelConfig).get();
    expect(row?.labels).toEqual(tree);
  });
});

describe('Views table', () => {
  test('stores and retrieves JSON array', async () => {
    const db = getWorkspaceDb(testDir);
    const viewsList = [
      { id: 'v1', name: 'Active', expression: 'status = "todo"' },
    ];

    db.insert(viewsConfig).values({ id: 1, version: 1, views: viewsList }).run();
    const row = db.select().from(viewsConfig).get();
    expect(row?.views).toEqual(viewsList);
  });
});

describe('Sources table', () => {
  test('CRUD with JSON config', async () => {
    const db = getWorkspaceDb(testDir);
    const now = Date.now();

    db.insert(sources).values({
      slug: 'github',
      name: 'GitHub',
      type: 'mcp',
      config: { slug: 'github', name: 'GitHub', type: 'mcp' },
      guide: { scope: 'Read/write access' },
      guideRaw: '# GitHub\nRead/write access',
      permissions: { blockedTools: [] },
      createdAt: now,
      updatedAt: now,
    }).run();

    const source = db.select().from(sources).where(eq(sources.slug, 'github')).get();
    expect(source?.name).toBe('GitHub');
    expect(source?.type).toBe('mcp');
    expect(source?.guide).toEqual({ scope: 'Read/write access' });
  });
});

describe('Sessions and Messages tables', () => {
  test('creates session with messages', async () => {
    const db = getWorkspaceDb(testDir);
    const now = Date.now();

    db.insert(sessions).values({
      id: '260328-swift-river',
      createdAt: now,
      lastUsedAt: now,
      sessionStatus: 'todo',
      messageCount: 2,
      preview: 'Hello world',
      tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, contextTokens: 0, costUsd: 0.01 },
    }).run();

    db.insert(messages).values([
      { id: 'msg1', sessionId: '260328-swift-river', position: 0, content: { type: 'user', text: 'Hello' } },
      { id: 'msg2', sessionId: '260328-swift-river', position: 1, content: { type: 'assistant', text: 'Hi!' } },
    ]).run();

    // Query session
    const session = db.select().from(sessions).where(eq(sessions.id, '260328-swift-river')).get();
    expect(session?.preview).toBe('Hello world');
    expect(session?.messageCount).toBe(2);

    // Query messages in order
    const msgs = db.select().from(messages)
      .where(eq(messages.sessionId, '260328-swift-river'))
      .orderBy(messages.position)
      .all();
    expect(msgs).toHaveLength(2);
    expect((msgs[0].content as { text: string }).text).toBe('Hello');
    expect((msgs[1].content as { text: string }).text).toBe('Hi!');
  });

  test('cascade deletes messages when session is deleted', async () => {
    const db = getWorkspaceDb(testDir);
    const now = Date.now();

    db.insert(sessions).values({
      id: 'test-cascade',
      createdAt: now,
      lastUsedAt: now,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    }).run();

    db.insert(messages).values({
      id: 'msg-cascade',
      sessionId: 'test-cascade',
      position: 0,
      content: { type: 'user', text: 'test' },
    }).run();

    // Delete session
    db.delete(sessions).where(eq(sessions.id, 'test-cascade')).run();

    // Messages should be gone
    const msgs = db.select().from(messages).where(eq(messages.sessionId, 'test-cascade')).all();
    expect(msgs).toHaveLength(0);
  });
});

describe('Automation history table', () => {
  test('append and query', async () => {
    const db = getWorkspaceDb(testDir);
    const now = Date.now();

    db.insert(automationHistory).values([
      { automationId: 'auto-1', entry: { action: 'run', result: 'ok' }, createdAt: now },
      { automationId: 'auto-1', entry: { action: 'run', result: 'fail' }, createdAt: now + 1000 },
      { automationId: 'auto-2', entry: { action: 'run', result: 'ok' }, createdAt: now + 2000 },
    ]).run();

    const auto1 = db.select().from(automationHistory)
      .where(eq(automationHistory.automationId, 'auto-1'))
      .all();
    expect(auto1).toHaveLength(2);
  });
});

describe('Batch state table', () => {
  test('upsert and read', async () => {
    const db = getWorkspaceDb(testDir);
    const now = Date.now();

    db.insert(batchState).values({
      batchId: 'batch-1',
      state: { status: 'running', totalItems: 10, completed: 3 },
      updatedAt: now,
    }).run();

    const batch = db.select().from(batchState).where(eq(batchState.batchId, 'batch-1')).get();
    expect((batch?.state as { status: string }).status).toBe('running');
  });
});

describe('DB events', () => {
  test('emits and receives typed events', () => {
    let received = false;
    const handler = (sessionId: string) => {
      expect(sessionId).toBe('test-123');
      received = true;
    };

    dbEvents.on('session:saved', handler);
    dbEvents.emit('session:saved', 'test-123');
    dbEvents.off('session:saved', handler);

    expect(received).toBe(true);
  });
});
