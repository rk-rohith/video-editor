import { secondsToTicks, TICKS_PER_SECOND, type VideoAssetAnalysis } from "@video-editor/shared";
import { runFFmpegCaptureLog } from "../ffmpeg/exec.js";
import { parseMetadataPrintLog, parseShowinfoTimestamps } from "./metadataParser.js";

const EDGE_KERNEL = "0 -1 0 -1 4 -1 0 -1 0";
const CONVOLUTION_FILTER = `format=gray,convolution=${EDGE_KERNEL}:${EDGE_KERNEL}:${EDGE_KERNEL}:${EDGE_KERNEL}`;

/** Empirically-derived scaling so raw signalstats YAVG values land roughly in 0..1 — see the recipe verified in apps/worker/scripts/ during development. */
function normalizeSharpness(edgeYavg: number): number {
  return Math.max(0, Math.min(1, edgeYavg / 12));
}

function normalizeExposure(lumaYavg: number): number {
  // 0 and 255 (pure black/white) score 0; mid-gray (128) scores 1 — a simple, honest proxy
  // for "well-exposed" rather than a claim of measuring true photographic exposure.
  return Math.max(0, 1 - Math.abs(lumaYavg - 128) / 128);
}

async function detectSceneCuts(inputPath: string, durationSeconds: number): Promise<number[]> {
  const log = await runFFmpegCaptureLog(["-i", inputPath, "-vf", "select='gt(scene,0.35)',showinfo", "-f", "null", "-"]);
  return parseShowinfoTimestamps(log).filter((t) => t > 0 && t < durationSeconds);
}

/** Samples one frame per second — cheap and dense enough for a "best segment" search on typical short-form clips. */
async function sampleExposureAndSharpness(inputPath: string): Promise<{ ticks: number; luma: number; sharpness: number }[]> {
  const [exposureLog, sharpnessLog] = await Promise.all([
    runFFmpegCaptureLog(["-i", inputPath, "-vf", "fps=1,signalstats,metadata=print", "-f", "null", "-"]),
    runFFmpegCaptureLog(["-i", inputPath, "-vf", `fps=1,${CONVOLUTION_FILTER},signalstats,metadata=print`, "-f", "null", "-"]),
  ]);
  const exposureFrames = parseMetadataPrintLog(exposureLog);
  const sharpnessFrames = parseMetadataPrintLog(sharpnessLog);

  return exposureFrames.map((frame, i) => ({
    ticks: secondsToTicks(frame.ptsTime),
    luma: frame.values["signalstats.YAVG"] ?? 128,
    sharpness: sharpnessFrames[i]?.values["signalstats.YAVG"] ?? 0,
  }));
}

/**
 * Picks the best contiguous window for a "hero shot" recommendation: the
 * highest-scoring run of samples (sharp + well-exposed), long enough to be
 * usable, that doesn't straddle a scene cut. See ARCHITECTURE.md §16.
 */
function pickBestSegment(
  samples: { ticks: number; luma: number; sharpness: number }[],
  sceneCutsTicks: number[],
  durationTicks: number
): { startTicks: number; endTicks: number } {
  if (samples.length === 0) return { startTicks: 0, endTicks: durationTicks };

  const minWindowSamples = Math.max(1, Math.min(samples.length, 2)); // ~2s minimum at 1 sample/sec
  let bestScore = -Infinity;
  let bestStart = 0;
  let bestEnd = Math.min(samples.length - 1, minWindowSamples - 1);

  for (let start = 0; start < samples.length; start++) {
    for (let end = start + minWindowSamples - 1; end < samples.length; end++) {
      const windowStartTicks = samples[start]!.ticks;
      const windowEndTicks = samples[end]!.ticks;
      const straddlesCut = sceneCutsTicks.some((cut) => cut > windowStartTicks && cut < windowEndTicks);
      if (straddlesCut) continue;

      const windowSamples = samples.slice(start, end + 1);
      const avgSharpness = windowSamples.reduce((sum, s) => sum + normalizeSharpness(s.sharpness), 0) / windowSamples.length;
      const avgExposure = windowSamples.reduce((sum, s) => sum + normalizeExposure(s.luma), 0) / windowSamples.length;
      const score = avgSharpness * 0.6 + avgExposure * 0.4;

      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  const startTicks = samples[bestStart]!.ticks;
  const endTicks = bestEnd + 1 < samples.length ? samples[bestEnd + 1]!.ticks : durationTicks;
  return { startTicks, endTicks: Math.max(endTicks, startTicks + 1) };
}

function classifyStability(sceneCutsTicks: number[], durationTicks: number): VideoAssetAnalysis["stability"] {
  const durationSeconds = durationTicks / TICKS_PER_SECOND;
  const cutsPerSecond = durationSeconds > 0 ? sceneCutsTicks.length / durationSeconds : 0;
  // A rough, honestly-approximate proxy: frequent scene-level change reads as "high motion" content,
  // a handful of cuts as "moderate," and a single unbroken shot as "static." True camera-shake
  // detection (vidstabdetect motion vectors) is a natural follow-up, not implemented in this pass.
  if (cutsPerSecond > 0.5) return "high-motion";
  if (sceneCutsTicks.length > 0) return "moderate";
  return "static";
}

function recommendUsage(qualityScore: number, durationTicks: number, stability: VideoAssetAnalysis["stability"]): VideoAssetAnalysis["recommendedUsage"] {
  const durationSeconds = durationTicks / TICKS_PER_SECOND;
  if (qualityScore > 0.75 && stability === "static" && durationSeconds < 8) return "opening hero shot";
  if (stability === "high-motion") return "b-roll";
  if (durationSeconds < 4) return "detail insert";
  if (qualityScore < 0.4) return "b-roll";
  return "general purpose";
}

export async function analyzeVideoAsset(inputPath: string, durationTicks: number): Promise<VideoAssetAnalysis> {
  const durationSeconds = Math.max(1, durationTicks / TICKS_PER_SECOND);

  const [sceneCutsSeconds, samples] = await Promise.all([
    detectSceneCuts(inputPath, durationSeconds),
    sampleExposureAndSharpness(inputPath),
  ]);
  const sceneCutsTicks = sceneCutsSeconds.map((s) => secondsToTicks(s));

  const avgSharpness = samples.length ? samples.reduce((sum, s) => sum + normalizeSharpness(s.sharpness), 0) / samples.length : 0;
  const avgExposure = samples.length ? samples.reduce((sum, s) => sum + normalizeExposure(s.luma), 0) / samples.length : 0;
  const qualityScore = avgSharpness * 0.6 + avgExposure * 0.4;

  const stability = classifyStability(sceneCutsTicks, durationTicks);
  const bestSegment = pickBestSegment(samples, sceneCutsTicks, durationTicks);

  return {
    kind: "video",
    version: 1,
    qualityScore,
    sharpness: avgSharpness,
    exposureQuality: avgExposure,
    stability,
    sceneCutsTicks,
    bestSegment,
    recommendedUsage: recommendUsage(qualityScore, durationTicks, stability),
    samples: samples.map((s) => ({ ticks: s.ticks, luma: s.luma, sharpness: normalizeSharpness(s.sharpness) })),
  };
}
