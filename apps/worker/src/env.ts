import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().optional(),
  STORAGE_LOCAL_PUBLIC_URL: z.string().optional(),
  STORAGE_LOCAL_UPLOAD_SECRET: z.string().optional(),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_PUBLIC_URL: z.string().optional(),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  PROXY_MAX_WIDTH: z.coerce.number().int().default(960),
  PROXY_VIDEO_BITRATE: z.string().default("2000k"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid worker environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid worker environment configuration");
  }
  return parsed.data;
}

export const env = loadEnv();
