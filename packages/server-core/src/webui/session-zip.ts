/**
 * Streams a session directory as a ZIP attachment.
 *
 * The response body flows out as files are read from disk — nothing is spooled
 * to memory or a temp file first. fflate's streaming Zip + ZipPassThrough writes
 * entries with the data-descriptor variant so local headers can be emitted before
 * each file's size/CRC is known.
 *
 * Files are STORED (no compression): sessions hold already-compressed artifacts
 * (images, pdfs, html) often enough that DEFLATE overhead rarely pays off, and
 * STORE keeps memory use trivially bounded.
 *
 * Realpath-based containment is defence-in-depth: even though the walker only
 * descends into paths rooted at the session dir, symlinks inside the session
 * could target elsewhere. Anything whose realpath escapes the root is skipped.
 */

import { createReadStream } from 'node:fs'
import { readdir, realpath } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import { Zip, ZipPassThrough } from 'fflate'

export interface SessionZipResponseOptions {
  /** Absolute, already realpath'd session directory to archive. */
  sessionDir: string
  /** Archive filename stem (no extension). Defaults to basename(sessionDir). */
  archiveName?: string
}

/**
 * Build an HTTP Response that streams a ZIP of the given session directory.
 * The session directory is expected to already exist and be realpath'd by the caller.
 */
export function createSessionZipResponse({ sessionDir, archiveName }: SessionZipResponseOptions): Response {
  const stem = archiveName ?? (basename(sessionDir) || 'session')
  const zipName = `${stem}.zip`
  const sessionPrefix = sessionDir.endsWith(sep) ? sessionDir : sessionDir + sep

  let zipRef: Zip | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          try { controller.error(err) } catch {}
          return
        }
        if (chunk && chunk.length > 0) {
          try { controller.enqueue(chunk) } catch {}
        }
        if (final) {
          try { controller.close() } catch {}
        }
      })
      zipRef = zip

      try {
        const files: { abs: string; zipPath: string }[] = []
        const walk = async (dir: string, prefix: string): Promise<void> => {
          const items = await readdir(dir, { withFileTypes: true })
          for (const item of items) {
            const abs = join(dir, item.name)
            // ZIP spec: forward slashes in entry names.
            const zipPath = prefix ? `${prefix}/${item.name}` : item.name
            if (item.isDirectory()) {
              await walk(abs, zipPath)
            } else if (item.isFile()) {
              let real: string
              try {
                real = await realpath(abs)
              } catch {
                // Unreadable file — skip it rather than abort the whole archive.
                continue
              }
              if (real !== sessionDir && !real.startsWith(sessionPrefix)) {
                // Symlink escape — skip.
                continue
              }
              files.push({ abs, zipPath })
            }
          }
        }

        await walk(sessionDir, '')

        // Process files sequentially: fflate buffers chunks from queued entries
        // until the previous entry releases, so running them in series keeps
        // memory bounded regardless of session size.
        for (const { abs, zipPath } of files) {
          const entry = new ZipPassThrough(zipPath)
          zip.add(entry)

          const rs = createReadStream(abs)
          try {
            for await (const chunk of rs) {
              entry.push(chunk as Uint8Array, false)
            }
          } finally {
            rs.destroy()
          }
          entry.push(new Uint8Array(0), true)
        }

        zip.end()
      } catch (err) {
        try { zip.terminate() } catch {}
        try { controller.error(err) } catch {}
      }
    },
    cancel() {
      // Consumer disconnected — stop emitting any further chunks.
      try { zipRef?.terminate() } catch {}
    },
  })

  // RFC 5987: ASCII-safe fallback + UTF-8 encoded form so browsers preserve
  // non-ASCII session names in the downloaded archive's filename.
  const asciiFallback = zipName.replace(/[^\x20-\x7e]/g, '_').replace(/["\r\n]/g, '')
  const encoded = encodeURIComponent(zipName)

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'no-store',
    },
  })
}
