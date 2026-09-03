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
