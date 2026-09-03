import type { ImageAssetAnalysis } from "@video-editor/shared";
import { runFFmpegCaptureBuffer, runFFmpegCaptureLog } from "../ffmpeg/exec.js";
import { parseMetadataPrintLog } from "./metadataParser.js";
import { computeDHash } from "./perceptualHash.js";

const EDGE_KERNEL = "0 -1 0 -1 4 -1 0 -1 0";
const CONVOLUTION_FILTER = `format=gray,convolution=${EDGE_KERNEL}:${EDGE_KERNEL}:${EDGE_KERNEL}:${EDGE_KERNEL}`;

function normalizeSharpness(edgeYavg: number): number {
  return Math.max(0, Math.min(1, edgeYavg / 12));
}

function normalizeExposure(lumaYavg: number): number {
  return Math.max(0, 1 - Math.abs(lumaYavg - 128) / 128);
}

async function measureSharpnessAndExposure(inputPath: string): Promise<{ luma: number; sharpness: number }> {
  const [exposureLog, sharpnessLog] = await Promise.all([
    runFFmpegCaptureLog(["-i", inputPath, "-frames:v", "1", "-vf", "signalstats,metadata=print", "-f", "null", "-"]),
    runFFmpegCaptureLog(["-i", inputPath, "-frames:v", "1", "-vf", `${CONVOLUTION_FILTER},signalstats,metadata=print`, "-f", "null", "-"]),
  ]);
  const luma = parseMetadataPrintLog(exposureLog)[0]?.values["signalstats.YAVG"] ?? 128;
  const sharpness = parseMetadataPrintLog(sharpnessLog)[0]?.values["signalstats.YAVG"] ?? 0;
  return { luma, sharpness };
}

/** A tiny (4x4) RGB sample, quantized and bucketed by frequency — a simple, honest dominant-color estimate, not a claim of full k-means clustering. */
async function extractDominantColors(inputPath: string): Promise<string[]> {
  const raw = await runFFmpegCaptureBuffer(["-i", inputPath, "-frames:v", "1", "-vf", "scale=4:4:flags=area,format=rgb24", "-f", "rawvideo", "-"]);
  const counts = new Map<string, number>();
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const r = Math.round(raw[i]! / 32) * 32;
    const g = Math.round(raw[i + 1]! / 32) * 32;
    const b = Math.round(raw[i + 2]! / 32) * 32;
    const hex = `#${[r, g, b].map((c) => Math.min(255, c).toString(16).padStart(2, "0")).join("")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hex]) => hex);
}

async function computeImagePerceptualHash(inputPath: string): Promise<string> {
  const raw = await runFFmpegCaptureBuffer(["-i", inputPath, "-frames:v", "1", "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-"]);
  return computeDHash(raw);
}

function orientationFrom(width: number, height: number): ImageAssetAnalysis["orientation"] {
  if (Math.abs(width - height) / Math.max(width, height) < 0.05) return "square";
  return width >= height ? "landscape" : "portrait";
}

export async function analyzeImageAsset(
  inputPath: string,
  dimensions: { width: number; height: number }
): Promise<Omit<ImageAssetAnalysis, "duplicateOfAssetIds">> {
  const [{ luma, sharpness }, dominantColors, perceptualHash] = await Promise.all([
    measureSharpnessAndExposure(inputPath),
    extractDominantColors(inputPath),
    computeImagePerceptualHash(inputPath),
  ]);

  const normalizedSharpness = normalizeSharpness(sharpness);
  const exposureQuality = normalizeExposure(luma);

  return {
    kind: "image",
    version: 1,
    qualityScore: normalizedSharpness * 0.6 + exposureQuality * 0.4,
    sharpness: normalizedSharpness,
    exposureQuality,
    orientation: orientationFrom(dimensions.width, dimensions.height),
    dominantColors,
    perceptualHash,
  };
}
