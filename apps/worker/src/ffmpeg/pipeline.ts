import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TICKS_PER_SECOND } from "@video-editor/shared";
import { env } from "../env.js";
import { parseFrameRate, runFFmpeg, runFFprobe } from "./exec.js";

export interface AssetMetadata {
  durationTicks: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
}

/** Deterministic, cheap metadata extraction via ffprobe — no AI model involved (§16/§32). */
export async function probeMetadata(inputPath: string): Promise<AssetMetadata> {
  const probe = await runFFprobe(inputPath);
  const videoStream = probe.streams.find((s) => s.codec_type === "video");
  const audioStream = probe.streams.find((s) => s.codec_type === "audio");
  const durationSeconds = Number(probe.format.duration ?? videoStream?.duration ?? 0);
  return {
    durationTicks: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * TICKS_PER_SECOND) : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    fps: parseFrameRate(videoStream?.r_frame_rate) ?? null,
    hasAudio: Boolean(audioStream),
  };
}

export function makeTempPath(suffix: string): string {
  return path.join(os.tmpdir(), `video-editor-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
}

/** Proxy = capped-resolution, capped-bitrate H.264 MP4. The editor and preview compositor edit against this; final render uses the original (see ARCHITECTURE.md §6/§27). */
export async function generateVideoProxy(inputPath: string): Promise<string> {
  const outputPath = makeTempPath(".mp4");
  await runFFmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale='min(${env.PROXY_MAX_WIDTH},iw)':-2`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    env.PROXY_VIDEO_BITRATE,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  return outputPath;
}

export async function generateImageProxy(inputPath: string): Promise<string> {
  const outputPath = makeTempPath(".jpg");
  await runFFmpeg(["-y", "-i", inputPath, "-vf", `scale='min(${env.PROXY_MAX_WIDTH * 2},iw)':-2`, "-q:v", "3", outputPath]);
  return outputPath;
}

/** Grabs a representative thumbnail frame. Seeks slightly in rather than frame 0 to avoid a common black/fade-in first frame. */
export async function generateThumbnail(inputPath: string, kind: "video" | "image"): Promise<string> {
  const outputPath = makeTempPath(".jpg");
  if (kind === "image") {
    await runFFmpeg(["-y", "-i", inputPath, "-vf", "scale=480:-2", "-q:v", "4", outputPath]);
  } else {
    await runFFmpeg(["-y", "-ss", "0.5", "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", outputPath]);
  }
  return outputPath;
}

/** Waveform peaks JSON: one min/max amplitude pair per ~100ms window, cheap to compute and cheap for the browser to render. */
export async function generateWaveform(inputPath: string): Promise<string> {
  const pcmPath = makeTempPath(".pcm");
  await runFFmpeg(["-y", "-i", inputPath, "-ac", "1", "-ar", "8000", "-f", "s16le", pcmPath]);
  const buffer = await fs.readFile(pcmPath);
  await fs.rm(pcmPath, { force: true });

  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
  const samplesPerWindow = Math.max(1, Math.floor(8000 * 0.1)); // ~100ms windows at 8kHz
  const peaks: { min: number; max: number }[] = [];
  for (let i = 0; i < samples.length; i += samplesPerWindow) {
    let min = 0;
    let max = 0;
    for (let j = i; j < Math.min(i + samplesPerWindow, samples.length); j++) {
      const v = samples[j]! / 32768;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks.push({ min: Number(min.toFixed(3)), max: Number(max.toFixed(3)) });
  }

  const outputPath = makeTempPath(".json");
  await fs.writeFile(outputPath, JSON.stringify({ windowMs: 100, peaks }));
  return outputPath;
}
