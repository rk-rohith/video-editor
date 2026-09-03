import { prisma } from "@video-editor/db";
import { sequenceSchema, type Sequence } from "@video-editor/shared";
import type { Job as BullJob } from "bullmq";
import { promises as fs } from "node:fs";
import { runFFmpeg } from "../ffmpeg/exec.js";
import { makeTempPath } from "../ffmpeg/pipeline.js";
import { storage } from "../storage.js";
import { renderGraphToFFmpegArgs } from "./ffmpegArgs.js";
import { timelineToRenderGraph } from "./graph.js";
import type { ResolvedAsset } from "./types.js";

interface RenderJobData {
  renderId: string;
  jobId: string;
}

function parseFFmpegTimeSeconds(line: string): number | null {
  const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Executes the render pipeline for one Render row: load its timeline
 * version, resolve every referenced asset's ORIGINAL (not proxy) file,
 * build the RenderGraph, turn it into an FFmpeg argv array, run it, and
 * commit the output. See ARCHITECTURE.md §14.
 */
export async function runRenderJob(bullJob: BullJob<RenderJobData>): Promise<void> {
  const { renderId, jobId } = bullJob.data;

  try {
    const render = await prisma.render.findUniqueOrThrow({ where: { id: renderId } });
    await prisma.job.update({ where: { id: jobId }, data: { status: "processing", attempts: { increment: 1 } } });
    await prisma.render.update({ where: { id: renderId }, data: { status: "processing", progress: 0 } });

    const timelineVersion = await prisma.timelineVersion.findUniqueOrThrow({ where: { id: render.timelineVersionId } });
    const sequence: Sequence = sequenceSchema.parse(timelineVersion.data);

    const assetIds = new Set<string>();
    for (const track of sequence.tracks) for (const clip of track.clips) assetIds.add(clip.sourceAssetId);
    for (const track of sequence.audioTracks) for (const clip of track.clips) assetIds.add(clip.sourceAssetId);

    const assets = await prisma.asset.findMany({ where: { id: { in: [...assetIds] } } });
    const resolvedAssets = new Map<string, ResolvedAsset>();
    for (const asset of assets) {
      const localPath = await storage.resolveForProcessing(asset.originalKey);
      resolvedAssets.set(asset.id, {
        assetId: asset.id,
        localPath,
        kind: asset.kind as "image" | "video" | "audio",
        hasAudio: asset.kind !== "image",
      });
    }

    const graph = timelineToRenderGraph({ sequence, resolvedAssets });
    const outputPath = makeTempPath(".mp4");
    const args = renderGraphToFFmpegArgs(graph, outputPath, {
      resolution: render.resolution as "720p" | "1080p",
      fps: render.fps,
    });

    const totalDuration = Math.max(graph.durationSeconds, 1);
    let lastReportedProgress = 0;
    await runFFmpeg(args, {
      onProgress: (line) => {
        const elapsed = parseFFmpegTimeSeconds(line);
        if (elapsed === null) return;
        const progress = Math.min(99, Math.round((elapsed / totalDuration) * 100));
        if (progress > lastReportedProgress) {
          lastReportedProgress = progress;
          // Fire-and-forget: don't let a slow DB write stall the ffmpeg progress stream.
          void prisma.job.update({ where: { id: jobId }, data: { progress } }).catch(() => undefined);
          void prisma.render.update({ where: { id: renderId }, data: { progress } }).catch(() => undefined);
        }
      },
    });

    const outputKey = `renders/${renderId}/output.mp4`;
    await storage.commitFromLocalPath(outputKey, outputPath, "video/mp4");
    await fs.rm(outputPath, { force: true });

    await prisma.render.update({
      where: { id: renderId },
      data: { status: "completed", progress: 100, outputKey, completedAt: new Date() },
    });
    await prisma.job.update({ where: { id: jobId }, data: { status: "completed", progress: 100 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown render error";
    await prisma.render.update({ where: { id: renderId }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
    await prisma.job.update({ where: { id: jobId }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
    throw error;
  }
}
