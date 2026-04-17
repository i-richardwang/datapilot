/**
 * S3-compatible session storage (AWS S3, Cloudflare R2, MinIO, etc.).
 *
 * Configuration via environment variables:
 *   VIEWER_S3_ENDPOINT          — S3 endpoint URL
 *   VIEWER_S3_BUCKET            — Bucket name
 *   VIEWER_S3_ACCESS_KEY_ID     — Access key
 *   VIEWER_S3_SECRET_ACCESS_KEY — Secret key
 *   VIEWER_S3_REGION            — Region (default: "auto" for R2)
 */

import type { SessionStorage } from './interface'

export class S3Storage implements SessionStorage {
  private client: any
  private bucket: string

  constructor() {
    this.bucket = process.env.VIEWER_S3_BUCKET || 'shared-sessions'
  }

  async initialize(): Promise<void> {
    const { S3Client } = await import('@aws-sdk/client-s3')

    this.client = new S3Client({
      endpoint: process.env.VIEWER_S3_ENDPOINT,
      region: process.env.VIEWER_S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.VIEWER_S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.VIEWER_S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    })
  }

  private key(id: string): string {
    return `sessions/${id}.json`
  }

  private htmlKey(id: string): string {
    return `html/${id}.html`
  }

  private assetKey(id: string): string {
    return `assets/${id}`
  }

  async save(id: string, data: unknown): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id),
        Body: JSON.stringify(data),
        ContentType: 'application/json',
      })
    )
  }

  async load(id: string): Promise<unknown | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(id),
        })
      )
      const body = await response.Body?.transformToString()
      return body ? JSON.parse(body) : null
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null
      }
      throw err
    }
  }

  async delete(id: string): Promise<boolean> {
    const { DeleteObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3')
    // Check existence first (S3 DELETE is idempotent)
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(id) })
      )
    } catch {
      return false
    }

    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(id) })
    )
    return true
  }

  async saveHtml(id: string, html: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.htmlKey(id),
        Body: html,
        ContentType: 'text/html; charset=utf-8',
      })
    )
  }

  async loadHtml(id: string): Promise<string | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.htmlKey(id),
        })
      )
      const body = await response.Body?.transformToString()
      return body ?? null
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null
      }
      throw err
    }
  }

  async updateHtml(id: string, html: string): Promise<boolean> {
    const { HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.htmlKey(id) })
      )
    } catch {
      return false
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.htmlKey(id),
        Body: html,
        ContentType: 'text/html; charset=utf-8',
      })
    )
    return true
  }

  async deleteHtml(id: string): Promise<boolean> {
    const { DeleteObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.htmlKey(id) })
      )
    } catch {
      return false
    }

    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.htmlKey(id) })
    )
    return true
  }

  async saveAsset(id: string, data: Uint8Array, mimeType: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.assetKey(id),
        Body: data,
        ContentType: mimeType,
      })
    )
  }

  async loadAsset(id: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.assetKey(id),
        })
      )
      const buffer = await response.Body?.transformToByteArray()
      if (!buffer) return null
      const mimeType = response.ContentType ?? 'application/octet-stream'
      return { data: buffer as Uint8Array, mimeType }
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null
      }
      throw err
    }
  }

  async deleteAsset(id: string): Promise<boolean> {
    const { DeleteObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.assetKey(id) })
      )
    } catch {
      return false
    }

    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.assetKey(id) })
    )
    return true
  }
}
