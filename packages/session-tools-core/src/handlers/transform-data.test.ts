import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionToolContext } from '../context.ts';
import { handleTransformData } from './transform-data.ts';

describe('transform_data path containment', () => {
  let rootDir: string;
  let sessionDir: string;
  let dataDir: string;
  let siblingDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'transform-data-boundary-'));
    sessionDir = join(rootDir, 'session');
    dataDir = join(sessionDir, 'data');
    siblingDir = join(rootDir, 'session-evil');

    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(siblingDir, { recursive: true });

    writeFileSync(join(sessionDir, 'in.txt'), 'hello');
    writeFileSync(join(siblingDir, 'outside.txt'), 'evil');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function ctx(): SessionToolContext {
    return {
      sessionId: 'test-session',
      workspacePath: rootDir,
      sourcesPath: join(rootDir, 'sources'),
      skillsPath: join(rootDir, 'skills'),
      plansFolderPath: join(sessionDir, 'plans'),
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
      },
      fs: {
        exists: () => false,
        readFile: () => '',
        readFileBuffer: () => Buffer.from(''),
        writeFile: () => {},
        isDirectory: () => false,
        readdir: () => [],
        stat: () => ({ size: 0, isDirectory: () => false }),
      },
      loadSourceConfig: () => null,
      sessionPath: sessionDir,
      dataPath: dataDir,
    };
  }

  it('rejects output path in sibling directory with shared prefix', async () => {
    const result = await handleTransformData(ctx(), {
      language: 'node',
      script: "require('node:fs').writeFileSync(process.argv.at(-1), 'ok')",
      inputFiles: ['in.txt'],
      outputFile: join(rootDir, 'session', 'data-evil', 'out.json'),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('outputFile must be within the session data directory');
  });

  it('rejects input path in sibling directory with shared prefix', async () => {
    const result = await handleTransformData(ctx(), {
      language: 'node',
      script: "require('node:fs').writeFileSync(process.argv.at(-1), 'ok')",
      inputFiles: [join(rootDir, 'session-evil', 'outside.txt')],
      outputFile: 'out.json',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('inputFile must be within the session directory');
  });

  it('rejects output path that escapes via symlink', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const outsideDir = join(rootDir, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, join(dataDir, 'escape-link'), 'dir');

    const result = await handleTransformData(ctx(), {
      language: 'node',
      script: "require('node:fs').writeFileSync(process.argv.at(-1), 'ok')",
      inputFiles: ['in.txt'],
      outputFile: 'escape-link/out.json',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('outputFile must be within the session data directory');
  });

  it('allows valid descendant paths and writes output', async () => {
    const result = await handleTransformData(ctx(), {
      language: 'node',
      script: "const fs=require('node:fs');fs.writeFileSync(process.argv.at(-1), JSON.stringify({ok:true}));",
      inputFiles: ['in.txt'],
      outputFile: 'out.json',
    });

    expect(result.isError).toBe(false);
    expect(existsSync(join(dataDir, 'out.json'))).toBe(true);
  });
});
