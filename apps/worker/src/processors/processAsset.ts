import { prisma } from "@video-editor/db";
import { JOB_TYPES } from "@video-editor/shared";
import { promises as fs } from "node:fs";
import type { Job as BullJob } from "bullmq";
import { generateImageProxy, generateThumbnail, generateVideoProxy, generateWaveform, probeMetadata } from "../ffmpeg/pipeline.js";
import { analysisQueue } from "../queues.js";
import { storage } from "../storage.js";

interface ProcessAssetJobData {
  assetId: string;
  jobId: string;
}

/**
 * Runs the full upload-processing pipeline for one asset: ffprobe metadata,
 * proxy transcode, thumbnail, and (if the asset has audio) a waveform peaks
 * file. See ARCHITECTURE.md §6/§12/§27. Kept as one job in Phase 1 for
 * simplicity; splitting into per-artifact jobs (metadata/proxy/thumbnail/
 * waveform separately) is a natural follow-up once independent retry/
 * progress granularity is needed.
 */
export async function processAssetJob(bullJob: BullJob<ProcessAssetJobData>): Promise<void> {
  const { assetId, jobId } = bullJob.data;
  const tempFiles: string[] = [];

  const updateProgress = async (progress: number) => {
    await bullJob.updateProgress(progress);
    await prisma.job.update({ where: { id: jobId }, data: { progress, status: "processing" } });
  };

  try {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    await prisma.job.update({ where: { id: jobId }, data: { status: "processing", attempts: { increment: 1 } } });

    const inputPath = await storage.resolveForProcessing(asset.originalKey);
    await updateProgress(10);

    const metadata = await probeMetadata(inputPath);
    await updateProgress(25);

    let proxyKey: string | null = null;
    let thumbnailKey: string | null = null;
    let waveformKey: string | null = null;

    if (asset.kind === "video") {
      const proxyPath = await generateVideoProxy(inputPath);
      tempFiles.push(proxyPath);
      proxyKey = asset.originalKey.replace(/original\.[^/.]+$/, "proxy.mp4");
      await storage.commitFromLocalPath(proxyKey, proxyPath, "video/mp4");
      await updateProgress(55);

      const thumbPath = await generateThumbnail(inputPath, "video");
      tempFiles.push(thumbPath);
      thumbnailKey = asset.originalKey.replace(/original\.[^/.]+$/, "thumb.jpg");
      await storage.commitFromLocalPath(thumbnailKey, thumbPath, "image/jpeg");
      await updateProgress(70);

      if (metadata.hasAudio) {
        const waveformPath = await generateWaveform(inputPath);
        tempFiles.push(waveformPath);
        waveformKey = asset.originalKey.replace(/original\.[^/.]+$/, "waveform.json");
        await storage.commitFromLocalPath(waveformKey, waveformPath, "application/json");
      }
      await updateProgress(90);
    } else if (asset.kind === "image") {
      const proxyPath = await generateImageProxy(inputPath);
      tempFiles.push(proxyPath);
      proxyKey = asset.originalKey.replace(/original\.[^/.]+$/, "proxy.jpg");
      await storage.commitFromLocalPath(proxyKey, proxyPath, "image/jpeg");

      const thumbPath = await generateThumbnail(inputPath, "image");
      tempFiles.push(thumbPath);
      thumbnailKey = asset.originalKey.replace(/original\.[^/.]+$/, "thumb.jpg");
      await storage.commitFromLocalPath(thumbnailKey, thumbPath, "image/jpeg");
      await updateProgress(80);
    } else {
      // audio
      const waveformPath = await generateWaveform(inputPath);
      tempFiles.push(waveformPath);
      waveformKey = asset.originalKey.replace(/original\.[^/.]+$/, "waveform.json");
      await storage.commitFromLocalPath(waveformKey, waveformPath, "application/json");
      await updateProgress(80);
    }

    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        status: "ready",
        durationTicks: metadata.durationTicks,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        proxyKey,
        thumbnailKey,
        waveformKey,
        errorMessage: null,
      },
    });
    await prisma.job.update({ where: { id: jobId }, data: { status: "completed", progress: 100 } });

    // Chain the deterministic analysis pass now that metadata (width/height/
    // duration) is known-good — see processors/analyzeAsset.ts. Audio assets
    // are skipped inside that job itself; enqueueing unconditionally here
    // keeps this file from needing to know that decision.
    const analysisJob = await prisma.job.create({ data: { type: JOB_TYPES.analyzeAsset, refId: asset.id, status: "queued" } });
    await analysisQueue.add(JOB_TYPES.analyzeAsset, { assetId: asset.id, jobId: analysisJob.id }, { jobId: analysisJob.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    await prisma.asset.update({ where: { id: assetId }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
    await prisma.job.update({ where: { id: jobId }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
    throw error; // rethrow so BullMQ's retry/backoff policy applies
  } finally {
    await Promise.all(tempFiles.map((file) => fs.rm(file, { force: true })));
  }
}
