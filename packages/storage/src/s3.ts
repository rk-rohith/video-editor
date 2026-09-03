import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StorageProvider, UploadTarget } from "./types.js";

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Optional CDN/custom domain to serve reads through instead of the raw bucket URL. */
  publicBaseUrl?: string;
  uploadTtlSeconds?: number;
}

/**
 * Production storage provider, speaking the S3 API (works against AWS S3,
 * Cloudflare R2, MinIO, or any S3-compatible endpoint via standard AWS SDK
 * env/config). Not exercised in this pass — no cloud credentials exist in
 * this development environment — but implemented for real so switching
 * STORAGE_DRIVER=s3 in a deployed environment is a config change, not a
 * rewrite (see ARCHITECTURE.md §26).
 */
export class S3StorageProvider implements StorageProvider {
  readonly driver = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({ region: opts.region });
  }

  async getUploadTarget(key: string, mimeType: string): Promise<UploadTarget> {
    const ttl = this.opts.uploadTtlSeconds ?? 900;
    const command = new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, ContentType: mimeType });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: ttl });
    return {
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": mimeType },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  getObjectUrl(key: string): string {
    if (this.opts.publicBaseUrl) return `${this.opts.publicBaseUrl}/${key}`;
    return `https://${this.opts.bucket}.s3.${this.opts.region}.amazonaws.com/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async resolveForProcessing(key: string): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `video-editor-${Date.now()}-${path.basename(key)}`);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    const body = response.Body as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(tmpPath);
      body.pipe(ws);
      body.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => resolve());
    });
    return tmpPath;
  }

  async commitFromLocalPath(key: string, localPath: string, mimeType?: string): Promise<void> {
    const body = await fs.readFile(localPath);
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: mimeType }));
  }
}
