#!/usr/bin/env bun
/**
 * Bundle the standalone server for the Node runtime.
 *
 * The Docker image runs the server under Node (not Bun) so the real `ws`
 * package is loaded and permessage-deflate compression works — Bun replaces
 * `ws` with a native shim that silently ignores `perMessageDeflate`
 * (verified: the 101 response carries no Sec-WebSocket-Extensions header).
 * Node can't execute TypeScript directly, so this bundles the server entry
 * into a single ESM file, mirroring the proven externals/aliases of the
 * Electron main-process build (scripts/electron-build-main.ts).
 *
 * Output: packages/server/dist/index.node.mjs
 *   DATAPILOT_SERVER_TOKEN=<secret> node packages/server/dist/index.node.mjs
 *
 * Format is ESM (not CJS like Electron's main.cjs) because the server entry
 * uses top-level await. That brings two ESM-specific requirements, both
 * handled via --banner: a CommonJS `require` shim (bundled CJS deps), and
 * `__dirname`/`__filename` globals (CJS deps like @larksuiteoapi read them
 * at module init).
 */

import { spawn } from 'bun';
import { join } from 'path';

const ROOT_DIR = join(import.meta.dir, '..');

const BANNER = [
  "import { createRequire as __createRequire } from 'node:module';",
  'const require = __createRequire(import.meta.url);',
  "import { fileURLToPath as __fileURLToPath } from 'node:url';",
  "import { dirname as __pathDirname } from 'node:path';",
  'const __filename = __fileURLToPath(import.meta.url);',
  'const __dirname = __pathDirname(__filename);',
].join(' ');

const proc = spawn({
  cmd: [
    'bun', 'run', 'esbuild',
    'packages/server/src/index.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--outfile=packages/server/dist/index.node.mjs',
    // Native module — resolved from node_modules at runtime (binding is
    // fetched via prebuild-install in Dockerfile.server).
    '--external:better-sqlite3',
    // Pure-ESM SDK that calls createRequire(import.meta.url) at init; must be
    // loaded natively by Node, same as the Electron main build.
    '--external:@anthropic-ai/claude-agent-sdk',
    // bun:sqlite only exists under Bun. The driver picks better-sqlite3 at
    // runtime under Node (db/driver.ts), but an externalized `bun:` import
    // would still be hoisted as a static ESM import and rejected by Node's
    // loader — alias it to an inert stub instead.
    '--alias:bun:sqlite=./scripts/build/bun-sqlite-stub.cjs',
    // grammY polyfill replacement — same reasoning as electron-build-main.ts.
    '--alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs',
    '--alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs',
    `--banner:js=${BANNER}`,
  ],
  cwd: ROOT_DIR,
  stdout: 'inherit',
  stderr: 'inherit',
});

const exitCode = await proc.exited;
if (exitCode !== 0) {
  console.error('❌ server node bundle failed with exit code', exitCode);
  process.exit(exitCode);
}
console.log('✅ packages/server/dist/index.node.mjs built');
