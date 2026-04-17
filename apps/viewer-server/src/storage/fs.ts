/**
 * Filesystem-based session storage.
 *
 * Sessions: {dataDir}/{id}.json
 * HTML artifacts: {dataDir}/html/{id}.html
 * File assets: {dataDir}/assets/{id} (raw bytes) + {dataDir}/assets/{id}.meta (mime type)
 * Suitable for single-machine deployments. Requires a mounted volume in Docker.
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { SessionStorage } from './interface'

export class FsStorage implements SessionStorage {
  private readonly htmlDir: string
  private readonly assetsDir: string

  constructor(private readonly dataDir: string) {
    this.htmlDir = join(dataDir, 'html')
    this.assetsDir = join(dataDir, 'assets')
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    await mkdir(this.htmlDir, { recursive: true })
    await mkdir(this.assetsDir, { recursive: true })
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

  async updateHtml(id: string, html: string): Promise<boolean> {
    const file = Bun.file(this.htmlPath(id))
    if (!(await file.exists())) return false
    await Bun.write(this.htmlPath(id), html)
    return true
  }

  async deleteHtml(id: string): Promise<boolean> {
    const { unlink } = await import('node:fs/promises')
    try {
      await unlink(this.htmlPath(id))
      return true
    } catch (err: any) {
      if (err.code === 'ENOENT') return false
      throw err
    }
  }

  private assetPath(id: string): string {
    return join(this.assetsDir, id)
  }

  private assetMetaPath(id: string): string {
    return join(this.assetsDir, `${id}.meta`)
  }

  async saveAsset(id: string, data: Uint8Array, mimeType: string): Promise<void> {
    await Bun.write(this.assetPath(id), data)
    await Bun.write(this.assetMetaPath(id), mimeType)
  }

  async loadAsset(id: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
    const file = Bun.file(this.assetPath(id))
    if (!(await file.exists())) return null
    const meta = Bun.file(this.assetMetaPath(id))
    const mimeType = (await meta.exists()) ? (await meta.text()) : 'application/octet-stream'
    const data = new Uint8Array(await file.arrayBuffer())
    return { data, mimeType }
  }

  async deleteAsset(id: string): Promise<boolean> {
    const { unlink } = await import('node:fs/promises')
    let existed = false
    try {
      await unlink(this.assetPath(id))
      existed = true
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
    try {
      await unlink(this.assetMetaPath(id))
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
    return existed
  }
}
