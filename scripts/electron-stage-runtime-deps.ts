import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
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
