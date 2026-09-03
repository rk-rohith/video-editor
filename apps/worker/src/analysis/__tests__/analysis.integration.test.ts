import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { secondsToTicks } from "@video-editor/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeImageAsset } from "../imageAnalysis.js";
import { hammingDistance } from "../perceptualHash.js";
import { analyzeVideoAsset } from "../videoAnalysis.js";

const execFileAsync = promisify(execFile);
const FF = process.env.FFMPEG_PATH ?? "ffmpeg";
const dir = path.join(os.tmpdir(), `video-editor-analysis-test-${Date.now()}`);

let sharpThenBlurryPath: string;
let sceneChangePath: string;
let bluePhotoPath: string;
let bluePhotoDupPath: string;
let redPortraitPath: string;

describe("asset analysis (real ffmpeg integration)", () => {
  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true });

    const sharp = path.join(dir, "sharp.mp4");
    const blurry = path.join(dir, "blurry.mp4");
    const red = path.join(dir, "red.mp4");
    sharpThenBlurryPath = path.join(dir, "sharp-then-blurry.mp4");
    sceneChangePath = path.join(dir, "scene-change.mp4");
    bluePhotoPath = path.join(dir, "blue.jpg");
    bluePhotoDupPath = path.join(dir, "blue-dup.jpg");
    redPortraitPath = path.join(dir, "red-portrait.jpg");

    await execFileAsync(FF, ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=3", "-c:v", "libx264", sharp]);
    await execFileAsync(FF, ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=3", "-vf", "boxblur=8:1", "-c:v", "libx264", blurry]);
    await execFileAsync(FF, ["-y", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=10:duration=3", "-c:v", "libx264", red]);

    const list1 = path.join(dir, "list1.txt");
    await fs.writeFile(list1, `file '${sharp}'\nfile '${blurry}'\n`);
    await execFileAsync(FF, ["-y", "-f", "concat", "-safe", "0", "-i", list1, "-c:v", "libx264", sharpThenBlurryPath]);

    const list2 = path.join(dir, "list2.txt");
    await fs.writeFile(list2, `file '${sharp}'\nfile '${red}'\n`);
    await execFileAsync(FF, ["-y", "-f", "concat", "-safe", "0", "-i", list2, "-c:v", "libx264", sceneChangePath]);

    await execFileAsync(FF, ["-y", "-f", "lavfi", "-i", "color=c=blue:size=640x480", "-frames:v", "1", bluePhotoPath]);
    await execFileAsync(FF, ["-y", "-i", bluePhotoPath, "-vf", "eq=brightness=0.01", bluePhotoDupPath]);
    await execFileAsync(FF, ["-y", "-f", "lavfi", "-i", "color=c=red:size=480x640", "-frames:v", "1", redPortraitPath]);
  }, 30000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("scores a sharp+blurry two-half video with sharpness that drops at the halfway point", async () => {
    const analysis = await analyzeVideoAsset(sharpThenBlurryPath, secondsToTicks(6));
    expect(analysis.kind).toBe("video");
    expect(analysis.samples.length).toBeGreaterThanOrEqual(5);
    const firstHalf = analysis.samples.filter((s) => s.ticks < secondsToTicks(3));
    const secondHalf = analysis.samples.filter((s) => s.ticks >= secondsToTicks(3));
    const avgSharp = (arr: typeof firstHalf) => arr.reduce((sum, s) => sum + s.sharpness, 0) / arr.length;
    expect(avgSharp(firstHalf)).toBeGreaterThan(avgSharp(secondHalf) * 2); // sharp half clearly sharper than blurred half
  });

  it("detects a real scene cut where content changes abruptly", async () => {
    const analysis = await analyzeVideoAsset(sceneChangePath, secondsToTicks(6));
    expect(analysis.sceneCutsTicks.length).toBeGreaterThan(0);
    // the cut should land near t=3s (within one sample interval)
    expect(analysis.sceneCutsTicks.some((t) => Math.abs(t - secondsToTicks(3)) < secondsToTicks(1.5))).toBe(true);
  });

  it("picks a best segment that stays within the sequence's actual duration", async () => {
    const analysis = await analyzeVideoAsset(sharpThenBlurryPath, secondsToTicks(6));
    expect(analysis.bestSegment.startTicks).toBeGreaterThanOrEqual(0);
    expect(analysis.bestSegment.endTicks).toBeLessThanOrEqual(secondsToTicks(6));
    expect(analysis.bestSegment.endTicks).toBeGreaterThan(analysis.bestSegment.startTicks);
  });

  it("analyzes a solid-color landscape image: orientation, dominant color, quality score", async () => {
    const analysis = await analyzeImageAsset(bluePhotoPath, { width: 640, height: 480 });
    expect(analysis.orientation).toBe("landscape");
    expect(analysis.dominantColors[0]).toBe("#0000ff");
    expect(analysis.qualityScore).toBeGreaterThanOrEqual(0);
    expect(analysis.qualityScore).toBeLessThanOrEqual(1);
  });

  it("gives near-identical images a small perceptual-hash Hamming distance", async () => {
    const a = await analyzeImageAsset(bluePhotoPath, { width: 640, height: 480 });
    const b = await analyzeImageAsset(bluePhotoDupPath, { width: 640, height: 480 });
    expect(hammingDistance(a.perceptualHash, b.perceptualHash)).toBeLessThanOrEqual(6);
  });

  it("detects portrait vs landscape orientation correctly", async () => {
    const portrait = await analyzeImageAsset(redPortraitPath, { width: 480, height: 640 });
    expect(portrait.orientation).toBe("portrait");
  });
});
