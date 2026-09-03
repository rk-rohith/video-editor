/**
 * The intermediate render representation described in ARCHITECTURE.md §14/§30:
 *
 *   TimelineVersion.data (Sequence JSON)
 *           │  timelineToRenderGraph()
 *           ▼
 *   RenderGraph                              <- plain data, independently testable
 *           │  renderGraphToFFmpegArgs()
 *           ▼
 *   string[] argv                            <- the ONLY place numbers become a command line
 *           │  execFile('ffmpeg', argv)      <- no shell, no string interpolation of user data
 *           ▼
 *   output MP4
 *
 * Every numeric value reaching this structure has already passed through the
 * Zod timeline schema (packages/shared/src/timeline.ts) — bounded, typed —
 * so there is no path for an arbitrary user string to reach an FFmpeg
 * filtergraph or command line.
 */

export interface ResolvedAsset {
  assetId: string;
  /** Local filesystem path FFmpeg can read directly (already resolved from storage). */
  localPath: string;
  kind: "image" | "video" | "audio";
  hasAudio: boolean;
}

export interface RenderInput {
  /** Position in the eventual `-i` argument list / ffmpeg input index. */
  index: number;
  localPath: string;
  isImage: boolean;
  /** Seconds into the source to start reading (video only). */
  seekSeconds: number;
  /** Seconds of source material to read. */
  durationSeconds: number;
}

/** One node in the video filter_complex graph: `[inLabels]filterExpr[outLabel]`. */
export interface FilterNode {
  inputs: string[];
  filter: string;
  output: string;
}

export interface RenderGraph {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  inputs: RenderInput[];
  videoNodes: FilterNode[];
  audioNodes: FilterNode[];
  finalVideoLabel: string;
  finalAudioLabel: string | null;
}
