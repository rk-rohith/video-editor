import type { FilterNode, RenderGraph } from "./types.js";

function filterNodeToString(node: FilterNode): string {
  const inputLabels = node.inputs.map((i) => `[${i}]`).join("");
  return `${inputLabels}${node.filter}[${node.output}]`;
}

export interface EncodingOptions {
  resolution: "720p" | "1080p";
  fps: number;
}

const RESOLUTION_BITRATE: Record<EncodingOptions["resolution"], string> = {
  "720p": "4000k",
  "1080p": "8000k",
};

/**
 * The ONLY place a RenderGraph becomes an FFmpeg argv array. Every value
 * here originates from already-validated numeric/typed timeline data (see
 * ARCHITECTURE.md §14/§19) — nothing in this function accepts or
 * interpolates a raw, unvalidated user string.
 */
export function renderGraphToFFmpegArgs(graph: RenderGraph, outputPath: string, encoding: EncodingOptions): string[] {
  const args: string[] = ["-y"];

  for (const input of graph.inputs) {
    if (input.isImage) {
      args.push("-loop", "1", "-t", input.durationSeconds.toFixed(3), "-i", input.localPath);
    } else {
      args.push("-ss", input.seekSeconds.toFixed(3), "-t", input.durationSeconds.toFixed(3), "-i", input.localPath);
    }
  }

  const filterComplex = [...graph.videoNodes, ...graph.audioNodes].map(filterNodeToString).join(";");
  args.push("-filter_complex", filterComplex);

  args.push("-map", `[${graph.finalVideoLabel}]`);
  if (graph.finalAudioLabel) args.push("-map", `[${graph.finalAudioLabel}]`);

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-b:v",
    RESOLUTION_BITRATE[encoding.resolution],
    "-r",
    String(encoding.fps),
    "-pix_fmt",
    "yuv420p"
  );
  if (graph.finalAudioLabel) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push("-movflags", "+faststart", outputPath);

  return args;
}
