import { execFile } from "node:child_process";
import { env } from "../env.js";

/**
 * The ONLY way this codebase invokes FFmpeg/ffprobe: execFile with an argv
 * array, never a shell string. Every caller builds `args` from typed,
 * already-validated values (see ARCHITECTURE.md §14/§19/§30) — nothing here
 * ever concatenates a user-controlled string into a command line.
 */
export function runFFmpeg(args: string[], opts: { onProgress?: (line: string) => void } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(env.FFMPEG_PATH, args, { maxBuffer: 1024 * 1024 * 64 }, (error) => {
      if (error) reject(new Error(`ffmpeg failed: ${error.message}`));
      else resolve();
    });
    if (opts.onProgress) {
      let buffer = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) opts.onProgress!(line);
      });
    }
  });
}

export interface FFprobeStream {
  codec_type: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
  rotation?: number;
}
export interface FFprobeResult {
  format: { duration?: string; size?: string };
  streams: FFprobeStream[];
}

export function runFFprobe(inputPath: string): Promise<FFprobeResult> {
  const args = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", inputPath];
  return new Promise((resolve, reject) => {
    execFile(env.FFPROBE_PATH, args, { maxBuffer: 1024 * 1024 * 16 }, (error, stdout) => {
      if (error) {
        reject(new Error(`ffprobe failed: ${error.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FFprobeResult);
      } catch (parseError) {
        reject(new Error(`ffprobe returned unparseable JSON: ${(parseError as Error).message}`));
      }
    });
  });
}

export function parseFrameRate(rFrameRate: string | undefined): number | undefined {
  if (!rFrameRate) return undefined;
  const [num, den] = rFrameRate.split("/").map(Number);
  if (!num || !den) return undefined;
  return num / den;
}

/**
 * Runs ffmpeg with `-loglevel info` and returns STDERR as text. This is
 * deliberately the noisier log level: filters like `showinfo` and
 * `metadata=print` (used by the analysis pipeline — see
 * apps/worker/src/analysis/) emit their per-frame output through ffmpeg's
 * own logger at "info" severity, and only to stderr, never stdout. Callers
 * regex out the specific lines they care about and ignore the rest (input
 * banner, stream mapping, etc).
 */
export function runFFmpegCaptureLog(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      env.FFMPEG_PATH,
      ["-hide_banner", "-loglevel", "info", ...args],
      { maxBuffer: 1024 * 1024 * 64 },
      (error, _stdout, stderr) => {
        if (error) reject(new Error(`ffmpeg failed: ${error.message}`));
        else resolve(stderr);
      }
    );
  });
}

/**
 * Runs ffmpeg and returns its raw stdout bytes (not decoded as text) —
 * used to pull small raw-pixel buffers out via `-f rawvideo -` for the
 * perceptual-hash duplicate-detection step, which needs actual pixel
 * values rather than a filter-computed summary statistic.
 */
export function runFFmpegCaptureBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      env.FFMPEG_PATH,
      ["-hide_banner", "-loglevel", "error", ...args],
      { maxBuffer: 1024 * 1024 * 64, encoding: "buffer" },
      (error, stdout) => {
        if (error) reject(new Error(`ffmpeg failed: ${error.message}`));
        else resolve(stdout as unknown as Buffer);
      }
    );
  });
}
