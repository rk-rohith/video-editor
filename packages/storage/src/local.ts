import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider, UploadTarget } from "./types.js";

export interface LocalDiskStorageOptions {
  /** Absolute or process-relative root directory all object keys live under. */
  rootDir: string;
  /** Base URL of the API process that serves /storage-upload and /storage. */
  apiBaseUrl: string;
  /** HMAC secret used to sign short-lived scoped upload tokens. */
  uploadSecret: string;
  uploadTtlSeconds?: number;
}

interface UploadTokenPayload {
  key: string;
  mimeType: string;
  exp: number;
}

/** Signs a compact `base64url(payload).base64url(hmac)` token — no JWT dependency needed for this narrow use. */
export function signUploadToken(payload: UploadTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyUploadToken(token: string, secret: string): UploadTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Malformed upload token");
  const expectedSig = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid upload token signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadTokenPayload;
  if (Date.now() / 1000 > payload.exp) throw new Error("Upload token expired");
  return payload;
}

/**
 * Dev/local implementation of StorageProvider. Keys are relative paths
 * under `rootDir`; "uploads" are a scoped, time-limited PUT to this same
 * API process's /storage-upload/:token route rather than a real S3
 * presigned URL, since no cloud credentials exist in this environment.
 * Swapping to S3StorageProvider in production requires no caller changes.
 */
export class LocalDiskStorageProvider implements StorageProvider {
  readonly driver = "local" as const;

  constructor(private readonly opts: LocalDiskStorageOptions) {}

  private absolutePath(key: string): string {
    const resolved = path.resolve(this.opts.rootDir, key);
    const root = path.resolve(this.opts.rootDir);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error(`Object key escapes storage root: ${key}`);
    }
    return resolved;
  }

  async getUploadTarget(key: string, mimeType: string): Promise<UploadTarget> {
    const ttl = this.opts.uploadTtlSeconds ?? 900;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const token = signUploadToken({ key, mimeType, exp }, this.opts.uploadSecret);
    return {
      uploadUrl: `${this.opts.apiBaseUrl}/storage-upload/${token}`,
      method: "PUT",
      headers: { "Content-Type": mimeType },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  getObjectUrl(key: string): string {
    return `${this.opts.apiBaseUrl}/storage/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    await fs.rm(this.absolutePath(key), { force: true });
  }

  async resolveForProcessing(key: string): Promise<string> {
    return this.absolutePath(key);
  }

  async commitFromLocalPath(key: string, localPath: string): Promise<void> {
    const dest = this.absolutePath(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(localPath, dest);
  }

  /** Used by the API's /storage-upload/:token route to write an incoming stream to disk. */
  async writeUploadStream(key: string, body: NodeJS.ReadableStream): Promise<void> {
    const dest = this.absolutePath(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const { createWriteStream } = await import("node:fs");
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(dest);
      body.pipe(ws);
      body.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => resolve());
    });
  }

  verifyToken(token: string): UploadTokenPayload {
    return verifyUploadToken(token, this.opts.uploadSecret);
  }
}
