/**
 * Storage is abstracted behind this interface so the concrete backend
 * (local disk in dev, S3-compatible object storage in production) is a
 * config choice, not a code change. See ARCHITECTURE.md §5/§13.
 *
 * Uploads always go browser -> storage directly via a signed/scoped upload
 * target; the API server issues the target but never proxies large file
 * bytes through itself. Workers use resolveForProcessing/commitFromLocalPath
 * because FFmpeg needs real local file paths to read from and write to.
 */
export interface UploadTarget {
  uploadUrl: string;
  method: "PUT";
  headers?: Record<string, string>;
  expiresAt: string;
}

export interface StorageProvider {
  readonly driver: "local" | "s3";

  /** A signed/scoped target the browser can PUT the raw file bytes to. */
  getUploadTarget(key: string, mimeType: string): Promise<UploadTarget>;

  /** A URL suitable for <video>/<img> src or downloadable output links. */
  getObjectUrl(key: string): string;

  deleteObject(key: string): Promise<void>;

  /**
   * Returns a local filesystem path FFmpeg can read `key` from. For the
   * local driver this is direct (no copy). For a remote driver this must
   * download to a temp file — callers are responsible for cleanup.
   */
  resolveForProcessing(key: string): Promise<string>;

  /** Worker writes its FFmpeg output to a local temp file, then commits it to `key`. */
  commitFromLocalPath(key: string, localPath: string, mimeType?: string): Promise<void>;
}
