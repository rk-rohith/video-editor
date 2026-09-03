import { z } from "zod";

/**
 * Deterministic asset analysis (ARCHITECTURE.md §16 / spec §4). Computed
 * entirely from local CV (ffmpeg's own filters — signalstats, scdet,
 * convolution edge-energy, perceptual hashing) with no multimodal model
 * call, so it's cheap enough to run on every uploaded asset. Stored as
 * `AssetAnalysis.data` (JSONB).
 *
 * A multimodal-model captioning pass ("automobile, exterior, dusk") is a
 * clearly separate, deliberately NOT-implemented-yet layer on top of this
 * — see ARCHITECTURE.md §16 and §26 for why that boundary is intentional
 * (no vision API key is assumed to exist in every deployment).
 */

const confidence = z.number().min(0).max(1);

export const videoSegmentSchema = z.object({
  startTicks: z.number().int().min(0),
  endTicks: z.number().int().min(0),
});

export const videoAssetAnalysisSchema = z.object({
  kind: z.literal("video"),
  version: z.literal(1),
  qualityScore: confidence,
  sharpness: confidence,
  exposureQuality: confidence,
  stability: z.enum(["static", "moderate", "high-motion"]),
  sceneCutsTicks: z.array(z.number().int().min(0)),
  bestSegment: videoSegmentSchema,
  recommendedUsage: z.enum(["opening hero shot", "b-roll", "detail insert", "closing shot", "general purpose"]),
  samples: z.array(
    z.object({
      ticks: z.number().int().min(0),
      luma: z.number(),
      sharpness: z.number(),
    })
  ),
});
export type VideoAssetAnalysis = z.infer<typeof videoAssetAnalysisSchema>;

export const imageAssetAnalysisSchema = z.object({
  kind: z.literal("image"),
  version: z.literal(1),
  qualityScore: confidence,
  sharpness: confidence,
  exposureQuality: confidence,
  orientation: z.enum(["landscape", "portrait", "square"]),
  dominantColors: z.array(z.string()),
  perceptualHash: z.string(), // 16-char hex, 64-bit dHash
  duplicateOfAssetIds: z.array(z.string()),
});
export type ImageAssetAnalysis = z.infer<typeof imageAssetAnalysisSchema>;

export const assetAnalysisDataSchema = z.discriminatedUnion("kind", [videoAssetAnalysisSchema, imageAssetAnalysisSchema]);
export type AssetAnalysisData = z.infer<typeof assetAnalysisDataSchema>;
