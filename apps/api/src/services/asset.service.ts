import { prisma } from "@video-editor/db";
import { JOB_TYPES, type RegisterAssetRequest, type RequestUploadUrlRequest } from "@video-editor/shared";
import { NotFoundError } from "../lib/errors.js";
import { createId } from "../lib/id.js";
import { storage } from "../lib/storage.js";
import { mediaProcessingQueue } from "../queues/queues.js";
import { getOwnedProject } from "./project.service.js";

function kindFromMimeType(mimeType: string): "image" | "video" | "audio" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "video";
}

export async function requestUploadUrl(projectId: string, userId: string, input: RequestUploadUrlRequest) {
  await getOwnedProject(projectId, userId);
  const extension = input.fileName.includes(".") ? input.fileName.split(".").pop() : "bin";
  const assetId = createId();
  const objectKey = `users/${userId}/projects/${projectId}/assets/${assetId}/original.${extension}`;
  const target = await storage.getUploadTarget(objectKey, input.mimeType);
  return { objectKey, assetId, ...target };
}

export async function registerAsset(projectId: string, userId: string, input: RegisterAssetRequest) {
  await getOwnedProject(projectId, userId);
  const asset = await prisma.asset.create({
    data: {
      projectId,
      kind: kindFromMimeType(input.mimeType),
      role: input.role,
      originalKey: input.objectKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      status: "uploaded",
    },
  });

  const job = await prisma.job.create({
    data: { type: JOB_TYPES.processAsset, refId: asset.id, status: "queued" },
  });
  await mediaProcessingQueue.add(JOB_TYPES.processAsset, { assetId: asset.id, jobId: job.id }, { jobId: job.id });
  await prisma.asset.update({ where: { id: asset.id }, data: { status: "processing" } });

  return { asset, jobId: job.id };
}

export async function listAssets(projectId: string, userId: string) {
  await getOwnedProject(projectId, userId);
  const assets = await prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  return assets.map((asset) => ({
    ...asset,
    originalUrl: storage.getObjectUrl(asset.originalKey),
    proxyUrl: asset.proxyKey ? storage.getObjectUrl(asset.proxyKey) : null,
    thumbnailUrl: asset.thumbnailKey ? storage.getObjectUrl(asset.thumbnailKey) : null,
    waveformUrl: asset.waveformKey ? storage.getObjectUrl(asset.waveformKey) : null,
  }));
}

export async function getOwnedAsset(assetId: string, userId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { project: true } });
  if (!asset || asset.project.userId !== userId) throw new NotFoundError("Asset not found");
  return asset;
}

export async function deleteAsset(assetId: string, userId: string) {
  const asset = await getOwnedAsset(assetId, userId);
  await Promise.all(
    [asset.originalKey, asset.proxyKey, asset.thumbnailKey, asset.waveformKey]
      .filter((key): key is string => Boolean(key))
      .map((key) => storage.deleteObject(key).catch(() => undefined))
  );
  await prisma.asset.delete({ where: { id: asset.id } });
}
