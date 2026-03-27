/**
 * Filesystem-based session storage.
 *
 * Each session is stored as a JSON file: {dataDir}/{id}.json
 * Suitable for single-machine deployments. Requires a mounted volume in Docker.
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { SessionStorage } from './interface'

export class FsStorage implements SessionStorage {
  constructor(private readonly dataDir: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
  }

  private filePath(id: string): string {
    return join(this.dataDir, `${id}.json`)
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
}
