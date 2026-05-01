import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync, statSync, chmodSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT_DIR = join(import.meta.dir, '..')
const ELECTRON_DIR = join(ROOT_DIR, 'apps', 'electron')
const ROOT_NODE_MODULES = join(ROOT_DIR, 'node_modules')
const ELECTRON_NODE_MODULES = join(ELECTRON_DIR, 'node_modules')

// ── Configuration ────────────────────────────────────────────────────────────

// Pinned Bun version for reproducible builds.
// Single source of truth — build-dmg.sh and build-win.ps1 delegate to this script.
const BUN_VERSION = 'bun-v1.3.9'

const RUNTIME_PACKAGES = [
  // Thin SDK core (sdk.mjs + types). The ~210 MB native `claude` binary lives
  // in a separate per-platform optional dep (`claude-agent-sdk-{platform}-{arch}`)
  // and is staged below as the `claude-agent-sdk-binary` alias.
  '@anthropic-ai/claude-agent-sdk',
  // ripgrep, used by packages/server-core/src/services/search.ts. The actual
  // `bin/rg` binary is fetched by @vscode/ripgrep's postinstall; we sanity-check
  // it exists before staging.
  '@vscode/ripgrep',
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

const MCP_SERVERS = [
  { name: 'session-mcp-server', required: true },
  { name: 'pi-agent-server', required: false },
]

const INTERCEPTOR_FILES = [
  'unified-network-interceptor.ts',
  'interceptor-common.ts',
  'feature-flags.ts',
  'interceptor-request-utils.ts',
]

// Platform-specific Bun download names.
// Windows uses the baseline build (no AVX2 requirement) for maximum compatibility.
const BUN_DOWNLOAD_MAP: Record<string, string> = {
  'darwin-arm64': 'bun-darwin-aarch64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-arm64': 'bun-linux-aarch64',
  'linux-x64': 'bun-linux-x64',
  'win32-x64': 'bun-windows-x64-baseline',
}

// Target platform/arch — single source for all staging steps that need it.
// ELECTRON_REBUILD_ARCH lets CI cross-compile (e.g. arm64 build on x64 runner).
const TARGET_PLATFORM = process.platform
const TARGET_ARCH = process.env.ELECTRON_REBUILD_ARCH ?? process.arch

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Download a file using fetch (cross-platform, no curl/Invoke-WebRequest dependency).
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(destPath, buffer)
}

/**
 * Verify SHA-256 checksum of a file against a SHASUMS256.txt manifest.
 */
function verifyChecksum(filePath: string, checksumsPath: string, expectedFileName: string): void {
  const checksums = readFileSync(checksumsPath, 'utf-8')
  const line = checksums.split('\n').find(l => l.includes(expectedFileName))
  if (!line) throw new Error(`No checksum found for ${expectedFileName} in SHASUMS256.txt`)

  const expectedHash = line.trim().split(/\s+/)[0]!.toLowerCase()
  const fileBuffer = readFileSync(filePath)
  const actualHash = createHash('sha256').update(fileBuffer).digest('hex')

  if (actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch for ${expectedFileName}: expected ${expectedHash}, got ${actualHash}`)
  }
  console.log('Checksum verified')
}

/**
 * Extract a zip file using Bun's built-in JSZip-compatible API.
 * Falls back to the 'unzip' command on platforms where Bun.file().arrayBuffer() is available.
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Use the Decompress API available in Bun
  const zipBuffer = readFileSync(zipPath)
  const { unzipSync } = await import('node:zlib') as any

  // Bun doesn't have a built-in zip extractor in node:zlib.
  // Use a manual approach: read the zip with the JSZip-like API via Bun shell.
  const { $ } = await import('bun') as any
  if ($) {
    // Bun shell is available — use it for cross-platform unzip
    await $`unzip -o ${zipPath} -d ${destDir}`.quiet()
    return
  }

  // Fallback: use child_process (works on all platforms where unzip is available)
  const { execSync } = await import('node:child_process')
  if (process.platform === 'win32') {
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' })
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' })
  }
}

/**
 * Create a temporary directory (cross-platform, no mktemp dependency).
 */
function makeTempDir(): string {
  const base = join(tmpdir(), `bun-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(base, { recursive: true })
  return base
}

/**
 * Stage the target arch's SDK native binary package as a stable alias under
 * `apps/electron/node_modules/@anthropic-ai/claude-agent-sdk-binary/`.
 *
 * Source resolution:
 *   - Same-arch: copy from `node_modules/@anthropic-ai/claude-agent-sdk-{platform}-{arch}/`
 *     (placed there by `bun install` via the SDK's optional deps).
 *   - Cross-arch: `npm pack` the binary package, untar, copy.
 */
async function stageSdkBinaryAlias(): Promise<void> {
  const sdkBinPkgName = `claude-agent-sdk-${TARGET_PLATFORM}-${TARGET_ARCH}`
  const sdkBinPkgSource = join(ROOT_NODE_MODULES, '@anthropic-ai', sdkBinPkgName)
  const aliasDest = join(ELECTRON_NODE_MODULES, '@anthropic-ai', 'claude-agent-sdk-binary')
  const claudeBinaryName = TARGET_PLATFORM === 'win32' ? 'claude.exe' : 'claude'

  console.log(`${isDryRun ? 'Would stage' : 'Staging'} SDK native binary as claude-agent-sdk-binary alias (${TARGET_PLATFORM}-${TARGET_ARCH})`)
  if (isDryRun) return

  let cleanupTmp: string | undefined
  let actualSource = sdkBinPkgSource

  try {
    if (!existsSync(sdkBinPkgSource)) {
      console.log(`  Cross-arch build: ${sdkBinPkgName} not in node_modules — fetching via npm pack...`)

      const rootPkg = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'))
      const sdkVersion: string | undefined = rootPkg?.dependencies?.['@anthropic-ai/claude-agent-sdk']
      if (!sdkVersion) {
        throw new Error('No @anthropic-ai/claude-agent-sdk version pinned in root package.json dependencies')
      }

      const tmp = makeTempDir()
      cleanupTmp = tmp

      const { $ } = await import('bun') as any
      await $`cd ${tmp} && npm pack @anthropic-ai/${sdkBinPkgName}@${sdkVersion}`.quiet()

      const tarball = readdirSync(tmp).find(f => f.startsWith('anthropic-ai-') && f.endsWith('.tgz'))
      if (!tarball) {
        throw new Error(`npm pack produced no tarball in ${tmp}. Contents: ${readdirSync(tmp).join(', ')}`)
      }

      await $`cd ${tmp} && tar -xzf ${tarball}`.quiet()
      actualSource = join(tmp, 'package')
      if (!existsSync(actualSource)) {
        throw new Error(`Extracted tarball missing 'package/' dir at ${actualSource}`)
      }
    }

    rmSync(aliasDest, { recursive: true, force: true })
    mkdirSync(aliasDest, { recursive: true })
    cpSync(actualSource, aliasDest, { recursive: true, dereference: true })

    const binPath = join(aliasDest, claudeBinaryName)
    if (!existsSync(binPath)) {
      throw new Error(`Native claude binary not found at ${binPath} after staging`)
    }
    if (TARGET_PLATFORM !== 'win32') {
      chmodSync(binPath, 0o755)
    }

    // Sanity check: the native binary is ~210 MB. A dramatically smaller file
    // means a botched copy or wrong tarball — fail loud rather than ship a
    // broken release.
    const size = statSync(binPath).size
    if (size < 50_000_000) {
      throw new Error(`claude binary at ${binPath} is only ${size} bytes (expected ~210 MB) — staging failed`)
    }
    console.log(`  Native binary: ${Math.round(size / 1024 / 1024)} MB`)
  } finally {
    if (cleanupTmp) rmSync(cleanupTmp, { recursive: true, force: true })
  }
}

// ── 1. Stage node_modules packages ──────────────────────────────────────────

// Pre-check: @vscode/ripgrep's `bin/rg` is fetched by its postinstall script.
// If the host did `bun install --ignore-scripts`, the binary won't be present
// and we'd silently stage an unusable package. Fail early with a clear hint.
{
  const rgBinary = TARGET_PLATFORM === 'win32' ? 'rg.exe' : 'rg'
  const rgSourceBin = join(ROOT_NODE_MODULES, '@vscode', 'ripgrep', 'bin', rgBinary)
  if (!existsSync(rgSourceBin)) {
    throw new Error(
      `ripgrep binary missing at ${rgSourceBin}.\n` +
      `@vscode/ripgrep's postinstall downloads bin/rg at install time. ` +
      `Run 'bun install' from the repo root (without --ignore-scripts) and ensure ` +
      `'@vscode/ripgrep' is in package.json's trustedDependencies.`,
    )
  }
}

for (const packageName of RUNTIME_PACKAGES) {
  stagePackage(packageName)
}

console.log(`${isDryRun ? 'Checked' : 'Prepared'} Electron runtime dependency staging`)

// ── 1a. Stage SDK native binary alias ───────────────────────────────────────
// Since SDK 0.2.113 the ~210 MB native `claude` binary is shipped as a
// per-platform optional dep (`claude-agent-sdk-{platform}-{arch}`). We copy
// the target arch's package to a stable alias path
// `apps/electron/node_modules/@anthropic-ai/claude-agent-sdk-binary/` so:
//   1. electron-builder.yml stays arch-agnostic (one entry, three platforms).
//   2. runtime-resolver.ts looks here first (see resolveClaudeBinaryPath).
//
// Cross-arch builds (host arch ≠ target arch) won't have the binary package
// installed by `bun install` (optional deps respect host os/cpu filters), so
// we fall back to fetching the tarball via `npm pack` and unpacking it.
await stageSdkBinaryAlias()

// ── 2. Stage MCP servers ────────────────────────────────────────────────────
// The build step (electron:build:main) compiles these to packages/*/dist/,
// but electron-builder.yml expects them at resources/*/index.js.

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

// ── 3. Stage DataPilot CLI ──────────────────────────────────────────────────
// The wrapper script resources/bin/datapilot runs `bun run $DATAPILOT_CLI_ENTRY`,
// so the compiled bundle must be available in the packaged app.

const CLI_SOURCE = join(ROOT_DIR, 'apps', 'cli', 'dist', 'datapilot.js')
const CLI_DEST_DIR = join(ELECTRON_DIR, 'resources', 'cli')

if (existsSync(CLI_SOURCE)) {
  console.log(`${isDryRun ? 'Would stage' : 'Staging'} datapilot CLI`)
  if (!isDryRun) {
    mkdirSync(CLI_DEST_DIR, { recursive: true })
    copyFileSync(CLI_SOURCE, join(CLI_DEST_DIR, 'index.js'))
  }
} else {
  console.warn('Warning: datapilot CLI not built. CLI commands will not work in packaged app.')
}

// ── 4. Stage interceptor source files ───────────────────────────────────────
// electron-builder.yml includes packages/shared/src/*.ts under files:, which are
// resolved relative to apps/electron/.

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

// ── 5. Stage Bun runtime binary ─────────────────────────────────────────────
// The Pi agent subprocess needs a JS runtime to execute pi-agent-server/index.js.
// Uses cross-platform Node/Bun APIs (fetch, crypto, fs) — no shell dependencies.

const BUN_VENDOR_DIR = join(ELECTRON_DIR, 'vendor', 'bun')
const bunBinaryName = TARGET_PLATFORM === 'win32' ? 'bun.exe' : 'bun'
const bunDest = join(BUN_VENDOR_DIR, bunBinaryName)

const bunPlatformKey = `${TARGET_PLATFORM}-${TARGET_ARCH}`
const bunDownloadName = BUN_DOWNLOAD_MAP[bunPlatformKey]

if (existsSync(bunDest)) {
  console.log(`Bun already staged at ${bunDest}, skipping download`)
} else if (isDryRun) {
  console.log(`Would download Bun ${BUN_VERSION} for ${bunPlatformKey}`)
} else if (!bunDownloadName) {
  console.warn(`Warning: No Bun binary available for ${bunPlatformKey}. Pi agent sessions will not work.`)
} else {
  console.log(`Downloading Bun ${BUN_VERSION} for ${bunPlatformKey}...`)
  const tmpDir = makeTempDir()
  try {
    const zipFileName = `${bunDownloadName}.zip`
    const zipPath = join(tmpDir, zipFileName)
    const checksumsPath = join(tmpDir, 'SHASUMS256.txt')

    // Download binary and checksums
    const baseUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}`
    await downloadFile(`${baseUrl}/${zipFileName}`, zipPath)
    await downloadFile(`${baseUrl}/SHASUMS256.txt`, checksumsPath)

    // Verify checksum
    verifyChecksum(zipPath, checksumsPath, zipFileName)

    // Extract
    await extractZip(zipPath, tmpDir)

    // Copy binary to vendor directory
    mkdirSync(BUN_VENDOR_DIR, { recursive: true })
    copyFileSync(join(tmpDir, bunDownloadName, bunBinaryName), bunDest)
    if (TARGET_PLATFORM !== 'win32') {
      chmodSync(bunDest, 0o755)
    }
    console.log(`Bun ${BUN_VERSION} staged to ${bunDest}`)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ── 6. Rebuild native modules ───────────────────────────────────────────────
// Rebuild better-sqlite3 against the Electron ABI. Without this, the .node
// binary is compiled for the system Node.js which has a different
// NODE_MODULE_VERSION than Electron's built-in Node.js.

if (!isDryRun) {
  const { rebuild } = await import('@electron/rebuild')
  const electronPkg = JSON.parse(
    readFileSync(join(ROOT_DIR, 'node_modules', 'electron', 'package.json'), 'utf-8'),
  )
  const electronVersion: string = electronPkg.version

  console.log(`Rebuilding native modules for Electron ${electronVersion} (${TARGET_ARCH})...`)
  await rebuild({
    buildPath: ELECTRON_DIR,
    electronVersion,
    arch: TARGET_ARCH,
    onlyModules: ['better-sqlite3'],
    force: true,
  })

  console.log('Native modules rebuilt for Electron')
}
