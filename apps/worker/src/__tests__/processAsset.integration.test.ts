import { prisma } from "@video-editor/db";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAssetJob } from "../processors/processAsset.js";
import { storage } from "../storage.js";

const execFileAsync = promisify(execFile);

const projectId = `test-project-${Date.now()}`;
const userId = `test-user-${Date.now()}`;
let videoAssetId: string;
let videoJobId: string;
let imageAssetId: string;
let imageJobId: string;

function fakeBullJob(data: { assetId: string; jobId: string }) {
  return { data, updateProgress: async () => undefined } as never;
}

describe("processAssetJob (worker integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.com`, passwordHash: "x" } });
    await prisma.project.create({ data: { id: projectId, userId, name: "Worker Test Project" } });

    const videoAsset = await prisma.asset.create({
      data: { projectId, kind: "video", originalKey: `users/${userId}/projects/${projectId}/assets/v1/original.mp4`, status: "uploaded" },
    });
    videoAssetId = videoAsset.id;
    const videoJob = await prisma.job.create({ data: { type: "process-asset", refId: videoAssetId, status: "queued" } });
    videoJobId = videoJob.id;

    const imageAsset = await prisma.asset.create({
      data: { projectId, kind: "image", originalKey: `users/${userId}/projects/${projectId}/assets/i1/original.jpg`, status: "uploaded" },
    });
    imageAssetId = imageAsset.id;
    const imageJob = await prisma.job.create({ data: { type: "process-asset", refId: imageAssetId, status: "queued" } });
    imageJobId = imageJob.id;

    // Seed local storage with real synthetic source media so the actual
    // ffmpeg/ffprobe pipeline runs against real files, not mocks.
    const videoPath = await storage.resolveForProcessing(videoAsset.originalKey);
    await fs.mkdir(path.dirname(videoPath), { recursive: true });
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-c:a", "aac", "-shortest", videoPath,
    ]);

    const imagePath = await storage.resolveForProcessing(imageAsset.originalKey);
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:size=400x300", "-frames:v", "1", imagePath]);
  }, 30000);

  afterAll(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await fs.rm(".test-storage", { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("processes a video asset: metadata, proxy, thumbnail, waveform", async () => {
    await processAssetJob(fakeBullJob({ assetId: videoAssetId, jobId: videoJobId }));

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: videoAssetId } });
    expect(asset.status).toBe("ready");
    expect(asset.durationTicks).toBeGreaterThan(0);
    expect(asset.width).toBe(320);
    expect(asset.height).toBe(180);
    expect(asset.proxyKey).toBeTruthy();
    expect(asset.thumbnailKey).toBeTruthy();
    expect(asset.waveformKey).toBeTruthy(); // synthetic video has a sine-wave audio track

    const proxyPath = await storage.resolveForProcessing(asset.proxyKey!);
    await expect(fs.stat(proxyPath)).resolves.toBeDefined();
    const thumbPath = await storage.resolveForProcessing(asset.thumbnailKey!);
    await expect(fs.stat(thumbPath)).resolves.toBeDefined();
    const waveformPath = await storage.resolveForProcessing(asset.waveformKey!);
    const waveformJson = JSON.parse(await fs.readFile(waveformPath, "utf8"));
    expect(Array.isArray(waveformJson.peaks)).toBe(true);
    expect(waveformJson.peaks.length).toBeGreaterThan(0);

    const job = await prisma.job.findUniqueOrThrow({ where: { id: videoJobId } });
    expect(job.status).toBe("completed");
    expect(job.progress).toBe(100);
  });

  it("processes an image asset: metadata, proxy, thumbnail, no waveform", async () => {
    await processAssetJob(fakeBullJob({ assetId: imageAssetId, jobId: imageJobId }));

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: imageAssetId } });
    expect(asset.status).toBe("ready");
    expect(asset.width).toBe(400);
    expect(asset.height).toBe(300);
    expect(asset.proxyKey).toBeTruthy();
    expect(asset.thumbnailKey).toBeTruthy();
    expect(asset.waveformKey).toBeNull();
  });

  it("marks the asset and job failed when the source file is missing", async () => {
    const brokenAsset = await prisma.asset.create({
      data: { projectId, kind: "video", originalKey: `users/${userId}/projects/${projectId}/assets/missing/original.mp4`, status: "uploaded" },
    });
    const brokenJob = await prisma.job.create({ data: { type: "process-asset", refId: brokenAsset.id, status: "queued" } });

    await expect(processAssetJob(fakeBullJob({ assetId: brokenAsset.id, jobId: brokenJob.id }))).rejects.toThrow();

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: brokenAsset.id } });
    expect(asset.status).toBe("failed");
    expect(asset.errorMessage).toBeTruthy();
    const job = await prisma.job.findUniqueOrThrow({ where: { id: brokenJob.id } });
    expect(job.status).toBe("failed");
  });
});
