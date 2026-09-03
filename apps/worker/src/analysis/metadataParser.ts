/**
 * Parses the stderr log lines ffmpeg's `metadata=print` and `showinfo`
 * filters emit at `-loglevel info` (see runFFmpegCaptureLog in
 * apps/worker/src/ffmpeg/exec.ts — both filters print through the logger,
 * not to a file, regardless of a `:file=` option, on some builds, so we
 * parse the log text directly rather than relying on a separate output
 * file).
 *
 * A `metadata=print` block looks like:
 *   [Parsed_metadata_2 @ 0x...] frame:12  pts:120  pts_time:1.2
 *   [Parsed_metadata_2 @ 0x...] lavfi.signalstats.YAVG=121.668
 *   [Parsed_metadata_2 @ 0x...] lavfi.signalstats.YDIF=1.234
 */

export interface MetadataFrame {
  ptsTime: number;
  values: Record<string, number>;
}

const FRAME_LINE = /frame:\d+\s+pts:\d+\s+pts_time:([\d.]+)/;
const KV_LINE = /lavfi\.([a-zA-Z0-9_.]+)=([\d.eE+-]+)/;

export function parseMetadataPrintLog(log: string): MetadataFrame[] {
  const frames: MetadataFrame[] = [];
  let current: MetadataFrame | null = null;

  for (const rawLine of log.split("\n")) {
    const frameMatch = FRAME_LINE.exec(rawLine);
    if (frameMatch) {
      if (current) frames.push(current);
      current = { ptsTime: Number(frameMatch[1]), values: {} };
      continue;
    }
    const kvMatch = KV_LINE.exec(rawLine);
    if (kvMatch && current) {
      current.values[kvMatch[1]!] = Number(kvMatch[2]);
    }
  }
  if (current) frames.push(current);
  return frames;
}

const SHOWINFO_PTS_TIME = /pts_time:([\d.]+)/;

/** Extracts `pts_time` values from `showinfo` log lines (used for scene-cut timestamps). */
export function parseShowinfoTimestamps(log: string): number[] {
  const timestamps: number[] = [];
  for (const line of log.split("\n")) {
    if (!line.includes("Parsed_showinfo")) continue;
    const match = SHOWINFO_PTS_TIME.exec(line);
    if (match) timestamps.push(Number(match[1]));
  }
  return timestamps;
}
