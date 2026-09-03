import { createStorageProvider, LocalDiskStorageProvider } from "@video-editor/storage";
import { env } from "../env.js";

export const storage = createStorageProvider({
  STORAGE_DRIVER: env.STORAGE_DRIVER,
  STORAGE_LOCAL_ROOT: env.STORAGE_LOCAL_ROOT,
  STORAGE_LOCAL_PUBLIC_URL: env.STORAGE_LOCAL_PUBLIC_URL,
  STORAGE_LOCAL_UPLOAD_SECRET: env.STORAGE_LOCAL_UPLOAD_SECRET,
  STORAGE_S3_BUCKET: env.STORAGE_S3_BUCKET,
  STORAGE_S3_REGION: env.STORAGE_S3_REGION,
  STORAGE_S3_PUBLIC_URL: env.STORAGE_S3_PUBLIC_URL,
});

/** Only meaningful when STORAGE_DRIVER=local — used by the /storage-upload route. */
export const localStorage = storage.driver === "local" ? (storage as LocalDiskStorageProvider) : undefined;
