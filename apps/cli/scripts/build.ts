#!/usr/bin/env bun
/**
 * Build script for the `datapilot-cli` npm package.
 *
 * Produces a single-file ESM bundle at `dist/datapilot.js` that can run on
 * Node.js >=22 with no external dependencies. The vendored copies in
 * `src/vendor/` replace the former `@craft-agent/*` workspace imports, so the
 * bundle is self-contained.
 *
 * The old CLI (`src/index.ts`, `src/server-spawner.ts`) is intentionally not
 * bundled — it is kept in-tree for in-repo scripts but excluded from publish.
 */

import { rm, chmod, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const ENTRY = resolve(PACKAGE_ROOT, 'src/datapilot.ts')
const OUTDIR = resolve(PACKAGE_ROOT, 'dist')
const OUTFILE = resolve(OUTDIR, 'datapilot.js')

async function main(): Promise<void> {
  await rm(OUTDIR, { recursive: true, force: true })
  await mkdir(OUTDIR, { recursive: true })

  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: OUTDIR,
    target: 'node',
    format: 'esm',
    naming: 'datapilot.js',
    minify: false,
    sourcemap: 'none',
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error('bun build failed')
  }

  // bun build does not preserve shebangs in ESM output, so inject one. We also
  // chmod +x so `npm i -g` registers the bin correctly.
  const bun = Bun
  const file = bun.file(OUTFILE)
  const source = await file.text()
  const withShebang = source.startsWith('#!')
    ? source
    : `#!/usr/bin/env node\n${source}`
  await bun.write(OUTFILE, withShebang)
  await chmod(OUTFILE, 0o755)

  // eslint-disable-next-line no-console
  console.log(`Built ${OUTFILE}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
