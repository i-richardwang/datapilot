import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT_DIR = join(import.meta.dir, '..')
const ELECTRON_DIR = join(ROOT_DIR, 'apps', 'electron')
const ROOT_NODE_MODULES = join(ROOT_DIR, 'node_modules')
const ELECTRON_NODE_MODULES = join(ELECTRON_DIR, 'node_modules')

const RUNTIME_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk',
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
  'ajv',
  'ajv-formats',
  'fast-deep-equal',
  'fast-uri',
  'json-schema-traverse',
  'require-from-string',
]

const isDryRun = process.argv.includes('--dry-run')

function stagePackage(packageName: string): void {
  const source = join(ROOT_NODE_MODULES, packageName)
  const destination = join(ELECTRON_NODE_MODULES, packageName)

  if (!existsSync(source)) {
    throw new Error(`Missing runtime package: ${packageName} at ${source}. Run 'bun install' from the repo root first.`)
  }

  console.log(`${isDryRun ? 'Would stage' : 'Staging'} ${packageName}`)

  if (isDryRun) return

  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination)) {
    rmSync(destination, { recursive: true, force: true })
  }

  // Bun uses symlinked node_modules; dereference to copy real files into the bundle input.
  cpSync(source, destination, { recursive: true, dereference: true })
}

for (const packageName of RUNTIME_PACKAGES) {
  stagePackage(packageName)
}

console.log(`${isDryRun ? 'Checked' : 'Prepared'} Electron runtime dependency staging`)

// Stage MCP servers into resources/ so they're included in the packaged app.
// The build step (electron:build:main) compiles these to packages/*/dist/,
// but electron-builder.yml expects them at resources/*/index.js.
const MCP_SERVERS = [
  { name: 'session-mcp-server', required: true },
  { name: 'pi-agent-server', required: false },
]

for (const server of MCP_SERVERS) {
  const source = join(ROOT_DIR, 'packages', server.name, 'dist', 'index.js')
  const destDir = join(ELECTRON_DIR, 'resources', server.name)

  if (existsSync(source)) {
    console.log(`${isDryRun ? 'Would stage' : 'Staging'} ${server.name}`)
    if (!isDryRun) {
      mkdirSync(destDir, { recursive: true })
      copyFileSync(source, join(destDir, 'index.js'))
    }
  } else if (server.required) {
    throw new Error(`${server.name} not built at ${source}. Run electron:build first.`)
  } else {
    console.warn(`Warning: ${server.name} not built. Related features will not work.`)
  }
}

// Stage interceptor source files so they're found by the packaged app runtime.
// electron-builder.yml includes packages/shared/src/*.ts under files:, which are
// resolved relative to apps/electron/. build-dmg.sh handles this, but the
// generic electron:dist path also needs them.
const INTERCEPTOR_FILES = [
  'unified-network-interceptor.ts',
  'interceptor-common.ts',
  'feature-flags.ts',
  'interceptor-request-utils.ts',
]
const INTERCEPTOR_SRC_DIR = join(ROOT_DIR, 'packages', 'shared', 'src')
const INTERCEPTOR_DEST_DIR = join(ELECTRON_DIR, 'packages', 'shared', 'src')

if (!isDryRun) {
  mkdirSync(INTERCEPTOR_DEST_DIR, { recursive: true })
}
for (const file of INTERCEPTOR_FILES) {
  const src = join(INTERCEPTOR_SRC_DIR, file)
  if (existsSync(src)) {
    console.log(`${isDryRun ? 'Would stage' : 'Staging'} interceptor: ${file}`)
    if (!isDryRun) {
      copyFileSync(src, join(INTERCEPTOR_DEST_DIR, file))
    }
  }
}

// Rebuild native modules (better-sqlite3) against the Electron ABI.
// Without this, the .node binary is compiled for the system Node.js which has a
// different NODE_MODULE_VERSION than Electron's built-in Node.js.
// We use @electron/rebuild's programmatic API (the official Electron tool for this)
// with an explicit buildPath to target the staged apps/electron/ directory.
if (!isDryRun) {
  const { rebuild } = await import('@electron/rebuild')
  const electronPkg = JSON.parse(
    readFileSync(join(ROOT_DIR, 'node_modules', 'electron', 'package.json'), 'utf-8'),
  )
  const electronVersion: string = electronPkg.version

  // Use ELECTRON_REBUILD_ARCH env var if set (e.g. by CI or build-dmg.sh for
  // cross-compilation), otherwise default to the current system architecture.
  const arch = process.env.ELECTRON_REBUILD_ARCH ?? process.arch

  console.log(`Rebuilding native modules for Electron ${electronVersion} (${arch})...`)
  await rebuild({
    buildPath: ELECTRON_DIR,
    electronVersion,
    arch,
    onlyModules: ['better-sqlite3'],
    force: true,
  })

  console.log('Native modules rebuilt for Electron')
}
