import { z } from "zod";
import { operationSchema } from "./operations.js";

/** Request/response contracts shared between apps/api and apps/web (§11). */

export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const createProjectRequestSchema = z.object({
  name: z.string().min(1).max(200),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  targetDurationTicks: z.number().int().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["draft", "processing", "ready", "archived"]).optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const requestUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.enum([
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/mpeg",
    "audio/wav",
    "audio/mp4",
  ]),
  fileSizeBytes: z.number().int().min(1).max(5 * 1024 * 1024 * 1024), // 5GB hard cap
});
export type RequestUploadUrlRequest = z.infer<typeof requestUploadUrlSchema>;

export const registerAssetRequestSchema = z.object({
  objectKey: z.string().min(1),
  originalName: z.string().min(1).max(300),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().min(1),
  role: z.enum(["raw", "reference", "logo", "music", "voiceover"]).default("raw"),
});
export type RegisterAssetRequest = z.infer<typeof registerAssetRequestSchema>;

export const applyTimelineOperationsRequestSchema = z.object({
  operations: z.array(operationSchema).min(1).max(200),
  label: z.string().max(200).optional(),
});
export type ApplyTimelineOperationsRequest = z.infer<typeof applyTimelineOperationsRequestSchema>;

export const createRenderRequestSchema = z.object({
  timelineVersionId: z.string(),
  format: z.enum(["mp4"]).default("mp4"),
  resolution: z.enum(["720p", "1080p"]).default("1080p"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
  platformPreset: z
    .enum(["instagram_reel", "instagram_post", "tiktok", "youtube_shorts", "youtube", "linkedin", "custom"])
    .default("custom"),
});
export type CreateRenderRequest = z.infer<typeof createRenderRequestSchema>;

export const PLATFORM_PRESETS: Record<string, { aspectRatio: string; maxDurationSeconds?: number; resolution: "720p" | "1080p"; fps: 24 | 25 | 30 | 60 }> = {
  instagram_reel: { aspectRatio: "9:16", maxDurationSeconds: 90, resolution: "1080p", fps: 30 },
  instagram_post: { aspectRatio: "1:1", resolution: "1080p", fps: 30 },
  tiktok: { aspectRatio: "9:16", maxDurationSeconds: 180, resolution: "1080p", fps: 30 },
  youtube_shorts: { aspectRatio: "9:16", maxDurationSeconds: 60, resolution: "1080p", fps: 30 },
  youtube: { aspectRatio: "16:9", resolution: "1080p", fps: 30 },
  linkedin: { aspectRatio: "16:9", resolution: "1080p", fps: 30 },
};
