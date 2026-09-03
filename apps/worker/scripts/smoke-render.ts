/**
 * Manual smoke test for the render pipeline (graph -> ffmpeg args -> real
 * ffmpeg execution) against synthetic media, run outside the DB/queue layer.
 * Not part of the automated test suite — a throwaway verification script.
 */
import { createEmptySequence, insertClip, secondsToTicks, type Clip } from "@video-editor/shared";
import { runFFmpeg } from "../src/ffmpeg/exec.js";
import { renderGraphToFFmpegArgs } from "../src/render/ffmpegArgs.js";
import { timelineToRenderGraph } from "../src/render/graph.js";
import type { ResolvedAsset } from "../src/render/types.js";

function videoClip(overrides: Partial<Clip>): Clip {
  return {
    id: "clip",
    sourceAssetId: "asset",
    trackId: "track-0",
    startTicks: 0,
    durationTicks: secondsToTicks(3),
    sourceInTicks: 0,
    sourceOutTicks: secondsToTicks(3),
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    transformKeyframes: [],
    speed: 1,
    reversed: false,
    effects: [],
    ...overrides,
  };
}

async function main() {
  let seq = createEmptySequence({ id: "seq", projectId: "proj", width: 640, height: 360, fps: 30 });
  const track = seq.tracks[0]!;
  const textTrack = seq.textTracks[0]!;

  seq = insertClip(seq, {
    trackId: track.id,
    clip: videoClip({
      id: "c1",
      trackId: track.id,
      sourceAssetId: "clip1",
      durationTicks: secondsToTicks(3),
      sourceOutTicks: secondsToTicks(3),
      transitionOut: { kind: "dissolve", durationTicks: secondsToTicks(0.5), params: {} },
      effects: [{ id: "fx1", kind: "colorGrade", params: { brightness: 0.05, contrast: 1.1, saturation: 1.2 } }],
    }),
  });
  seq = insertClip(seq, {
    trackId: track.id,
    clip: videoClip({
      id: "c2",
      trackId: track.id,
      sourceAssetId: "clip2",
      startTicks: secondsToTicks(3),
      durationTicks: secondsToTicks(2),
      sourceOutTicks: secondsToTicks(2),
    }),
  });
  seq = insertClip(seq, {
    trackId: track.id,
    clip: videoClip({
      id: "c3",
      trackId: track.id,
      sourceAssetId: "image1",
      startTicks: secondsToTicks(5),
      durationTicks: secondsToTicks(2),
      sourceOutTicks: secondsToTicks(2),
      animation: { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.3, x: 0.3, y: -0.2 } },
    }),
  });

  seq = {
    ...seq,
    textTracks: seq.textTracks.map((t) =>
      t.id !== textTrack.id
        ? t
        : {
            ...t,
            layers: [
              {
                id: "text-1",
                startTicks: secondsToTicks(0.5),
                durationTicks: secondsToTicks(2),
                content: "Smoke Test: Hello!",
                fontFamily: "Inter",
                fontSize: 40,
                fontWeight: 700,
                color: "white",
                align: "center",
                x: 0,
                y: 0.6,
                animation: "fadeIn",
                isCaption: false,
                wordTimings: [],
              },
            ],
          }
    ),
  };

  const resolvedAssets = new Map<string, ResolvedAsset>([
    ["clip1", { assetId: "clip1", localPath: "/tmp/render-smoke/clip1.mp4", kind: "video", hasAudio: true }],
    ["clip2", { assetId: "clip2", localPath: "/tmp/render-smoke/clip2.mp4", kind: "video", hasAudio: false }],
    ["image1", { assetId: "image1", localPath: "/tmp/render-smoke/image1.jpg", kind: "image", hasAudio: false }],
  ]);

  const graph = timelineToRenderGraph({ sequence: seq, resolvedAssets });
  console.log("Render graph built. Video nodes:", graph.videoNodes.length, "Audio nodes:", graph.audioNodes.length);

  const args = renderGraphToFFmpegArgs(graph, "/tmp/render-smoke/output.mp4", { resolution: "720p", fps: 30 });
  console.log("ffmpeg args:\n", args.join(" \\\n  "));

  await runFFmpeg(args, { onProgress: (line) => (line.includes("time=") ? process.stdout.write(".") : undefined) });
  console.log("\nRender complete: /tmp/render-smoke/output.mp4");
}

main().catch((err) => {
  console.error("Smoke render FAILED:", err);
  process.exit(1);
});
