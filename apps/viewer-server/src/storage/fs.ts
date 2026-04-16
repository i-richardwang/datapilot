/**
 * Filesystem-based session storage.
 *
 * Sessions: {dataDir}/{id}.json
 * HTML artifacts: {dataDir}/html/{id}.html
 * Suitable for single-machine deployments. Requires a mounted volume in Docker.
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { SessionStorage } from './interface'

export class FsStorage implements SessionStorage {
  private readonly htmlDir: string

  constructor(private readonly dataDir: string) {
    this.htmlDir = join(dataDir, 'html')
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    await mkdir(this.htmlDir, { recursive: true })
  }

  private filePath(id: string): string {
    return join(this.dataDir, `${id}.json`)
  }

  private htmlPath(id: string): string {
    return join(this.htmlDir, `${id}.html`)
  }

  async save(id: string, data: unknown): Promise<void> {
    const path = this.filePath(id)
    await Bun.write(path, JSON.stringify(data))
  }

  async load(id: string): Promise<unknown | null> {
    const file = Bun.file(this.filePath(id))
    if (!(await file.exists())) return null
    return file.json()
  }

  async delete(id: string): Promise<boolean> {
    const { unlink } = await import('node:fs/promises')
    try {
      await unlink(this.filePath(id))
      return true
    } catch (err: any) {
      if (err.code === 'ENOENT') return false
      throw err
    }
  }

  async saveHtml(id: string, html: string): Promise<void> {
    await Bun.write(this.htmlPath(id), html)
  }

  async loadHtml(id: string): Promise<string | null> {
    const file = Bun.file(this.htmlPath(id))
    if (!(await file.exists())) return null
    return file.text()
  }
}
