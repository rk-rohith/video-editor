import { prisma } from "@video-editor/db";
import { assetAnalysisDataSchema, type AssetAnalysisData } from "@video-editor/shared";
import type { Job as BullJob } from "bullmq";
import { hasOverlappingDominantColor } from "../analysis/colorSimilarity.js";
import { analyzeImageAsset } from "../analysis/imageAnalysis.js";
import { isNearDuplicate } from "../analysis/perceptualHash.js";
import { analyzeVideoAsset } from "../analysis/videoAnalysis.js";
import { storage } from "../storage.js";

interface AnalyzeAssetJobData {
  assetId: string;
  jobId: string;
}

/**
 * Deterministic asset analysis (ARCHITECTURE.md §16) — quality score,
 * best-segment recommendation for video, dominant colors/near-duplicate
 * detection for photos. No multimodal model call, so it's cheap enough to
 * run automatically on every upload (enqueued by processAssetJob once the
 * asset's metadata is known-good — see that file for why analysis waits
 * for the metadata step rather than running in parallel with it).
 */
export async function analyzeAssetJob(bullJob: BullJob<AnalyzeAssetJobData>): Promise<void> {
  const { assetId, jobId } = bullJob.data;

  try {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    await prisma.job.update({ where: { id: jobId }, data: { status: "processing", attempts: { increment: 1 } } });

    if (asset.kind === "audio") {
      // No meaningful deterministic "quality score" for audio in this pass
      // (that's the future stem-separation/loudness-analysis territory
      // described in ARCHITECTURE.md §14 Audio Intelligence, Phase 4).
      await prisma.job.update({ where: { id: jobId }, data: { status: "completed", progress: 100 } });
      return;
    }

    const inputPath = await storage.resolveForProcessing(asset.originalKey);
    await bullJob.updateProgress(20);

    let data: AssetAnalysisData;
    if (asset.kind === "video") {
      data = await analyzeVideoAsset(inputPath, asset.durationTicks ?? 0);
    } else {
      const partial = await analyzeImageAsset(inputPath, { width: asset.width ?? 0, height: asset.height ?? 0 });
      await bullJob.updateProgress(70);

      const others = await prisma.assetAnalysis.findMany({
        where: { asset: { projectId: asset.projectId, kind: "image", id: { not: asset.id } } },
        select: { assetId: true, data: true },
      });
      const duplicateOfAssetIds = others
        .map((other) => ({ assetId: other.assetId, parsed: assetAnalysisDataSchema.safeParse(other.data) }))
        .filter((other): other is { assetId: string; parsed: { success: true; data: AssetAnalysisData } } => other.parsed.success)
        .filter((other) => other.parsed.data.kind === "image")
        .filter(
          (other) =>
            other.parsed.data.kind === "image" &&
            isNearDuplicate(partial.perceptualHash, other.parsed.data.perceptualHash) &&
            hasOverlappingDominantColor(partial.dominantColors, other.parsed.data.dominantColors)
        )
        .map((other) => other.assetId);

      data = { ...partial, duplicateOfAssetIds };
    }
    await bullJob.updateProgress(90);

    await prisma.assetAnalysis.upsert({
      where: { assetId },
      create: { assetId, data, modelVersion: "deterministic-cv-v1" },
      update: { data, modelVersion: "deterministic-cv-v1" },
    });
    await prisma.job.update({ where: { id: jobId }, data: { status: "completed", progress: 100 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown analysis error";
    // Analysis failing is non-fatal to the asset itself — it's an enrichment
    // step, not a prerequisite for editing — so the Asset row is left alone;
    // only the Job is marked failed.
    await prisma.job.update({ where: { id: jobId }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
    throw error;
  }
}
