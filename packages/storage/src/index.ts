import { LocalDiskStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";
import type { StorageProvider } from "./types.js";

export * from "./types.js";
export * from "./local.js";
export * from "./s3.js";

export interface StorageEnv {
  STORAGE_DRIVER: "local" | "s3";
  STORAGE_LOCAL_ROOT?: string;
  STORAGE_LOCAL_PUBLIC_URL?: string;
  STORAGE_LOCAL_UPLOAD_SECRET?: string;
  STORAGE_S3_BUCKET?: string;
  STORAGE_S3_REGION?: string;
  STORAGE_S3_PUBLIC_URL?: string;
}

export function createStorageProvider(env: StorageEnv): StorageProvider {
  if (env.STORAGE_DRIVER === "s3") {
    if (!env.STORAGE_S3_BUCKET || !env.STORAGE_S3_REGION) {
      throw new Error("STORAGE_S3_BUCKET and STORAGE_S3_REGION are required when STORAGE_DRIVER=s3");
    }
    return new S3StorageProvider({
      bucket: env.STORAGE_S3_BUCKET,
      region: env.STORAGE_S3_REGION,
      publicBaseUrl: env.STORAGE_S3_PUBLIC_URL,
    });
  }
  if (!env.STORAGE_LOCAL_ROOT || !env.STORAGE_LOCAL_PUBLIC_URL || !env.STORAGE_LOCAL_UPLOAD_SECRET) {
    throw new Error(
      "STORAGE_LOCAL_ROOT, STORAGE_LOCAL_PUBLIC_URL and STORAGE_LOCAL_UPLOAD_SECRET are required when STORAGE_DRIVER=local"
    );
  }
  return new LocalDiskStorageProvider({
    rootDir: env.STORAGE_LOCAL_ROOT,
    apiBaseUrl: env.STORAGE_LOCAL_PUBLIC_URL,
    uploadSecret: env.STORAGE_LOCAL_UPLOAD_SECRET,
  });
}
