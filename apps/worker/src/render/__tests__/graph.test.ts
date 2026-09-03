import { createEmptySequence, insertClip, secondsToTicks, type Clip } from "@video-editor/shared";
import { describe, expect, it } from "vitest";
import { timelineToRenderGraph } from "../graph.js";
import { renderGraphToFFmpegArgs } from "../ffmpegArgs.js";
import type { ResolvedAsset } from "../types.js";

function videoClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    sourceAssetId: "asset-video-1",
    trackId: "track-0",
    startTicks: 0,
    durationTicks: secondsToTicks(4),
    sourceInTicks: 0,
    sourceOutTicks: secondsToTicks(4),
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    transformKeyframes: [],
    speed: 1,
    reversed: false,
    effects: [],
    ...overrides,
  };
}

function assetsMap(entries: Record<string, ResolvedAsset>) {
  return new Map(Object.entries(entries));
}

describe("timelineToRenderGraph", () => {
  it("throws when the primary track has no clips", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    expect(() => timelineToRenderGraph({ sequence: seq, resolvedAssets: new Map() })).toThrow();
  });

  it("builds a two-clip cut sequence using concat", () => {
    let seq = createEmptySequence({ id: "seq", projectId: "proj", width: 1080, height: 1920, fps: 30 });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, { trackId: track.id, clip: videoClip({ id: "c1", trackId: track.id, startTicks: 0, durationTicks: secondsToTicks(3) }) });
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({ id: "c2", trackId: track.id, sourceAssetId: "asset-video-2", startTicks: secondsToTicks(3), durationTicks: secondsToTicks(2) }),
    });

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({
        "asset-video-1": { assetId: "asset-video-1", localPath: "/tmp/a.mp4", kind: "video", hasAudio: false },
        "asset-video-2": { assetId: "asset-video-2", localPath: "/tmp/b.mp4", kind: "video", hasAudio: false },
      }),
    });

    expect(graph.inputs).toHaveLength(2);
    const joinNode = graph.videoNodes.find((n) => n.filter.startsWith("concat"));
    expect(joinNode).toBeDefined();
    expect(graph.finalVideoLabel).toBe(joinNode!.output);
  });

  it("uses xfade with a correctly offset transition between contiguous clips", () => {
    let seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({
        id: "c1",
        trackId: track.id,
        durationTicks: secondsToTicks(5),
        transitionOut: { kind: "dissolve", durationTicks: secondsToTicks(1), params: {} },
      }),
    });
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({ id: "c2", trackId: track.id, sourceAssetId: "asset-video-2", startTicks: secondsToTicks(5), durationTicks: secondsToTicks(3) }),
    });

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({
        "asset-video-1": { assetId: "asset-video-1", localPath: "/tmp/a.mp4", kind: "video", hasAudio: false },
        "asset-video-2": { assetId: "asset-video-2", localPath: "/tmp/b.mp4", kind: "video", hasAudio: false },
      }),
    });

    const xfadeNode = graph.videoNodes.find((n) => n.filter.startsWith("xfade"));
    expect(xfadeNode).toBeDefined();
    // offset = cumulativeDuration(5s) - transitionDuration(1s) = 4
    expect(xfadeNode!.filter).toContain("offset=4");
    expect(xfadeNode!.filter).toContain("duration=1");
    expect(xfadeNode!.filter).toContain("transition=dissolve");
  });

  it("regression: a clip's embedded audio is delayed to its RENDERED start, not its raw startTicks, when a transition precedes it", () => {
    // Without this, a transitioned clip's audio starts later than its video
    // actually appears on screen, and — worse — the final output duration
    // is wrong: it's bounded by whichever mapped stream is longest, and an
    // unshifted trailing audio clip is longer than the (correctly
    // shortened) video stream. Caught via a real ffmpeg run during manual
    // verification (apps/worker/scripts/debug-graph.ts), not just inspection.
    let seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({
        id: "c1",
        trackId: track.id,
        durationTicks: secondsToTicks(3),
        transitionOut: { kind: "dissolve", durationTicks: secondsToTicks(0.5), params: {} },
      }),
    });
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({ id: "c2", trackId: track.id, sourceAssetId: "asset-video-2", startTicks: secondsToTicks(3), durationTicks: secondsToTicks(3) }),
    });

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({
        "asset-video-1": { assetId: "asset-video-1", localPath: "/tmp/a.mp4", kind: "video", hasAudio: false },
        "asset-video-2": { assetId: "asset-video-2", localPath: "/tmp/b.mp4", kind: "video", hasAudio: true },
      }),
    });

    const c2AudioNode = graph.audioNodes.find((n) => n.inputs[0] === "1:a");
    expect(c2AudioNode).toBeDefined();
    // raw startTicks would give adelay=3000|3000 — rendered start (3s - 0.5s transition) is 2.5s.
    expect(c2AudioNode!.filter).toContain("adelay=2500|2500");
    expect(c2AudioNode!.filter).not.toContain("adelay=3000");
  });

  it("does not use xfade when clips are not contiguous", () => {
    let seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({ id: "c1", trackId: track.id, durationTicks: secondsToTicks(3), transitionOut: { kind: "dissolve", durationTicks: secondsToTicks(1), params: {} } }),
    });
    // gap between clips — startTicks intentionally leaves a 1s hole
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({ id: "c2", trackId: track.id, sourceAssetId: "asset-video-2", startTicks: secondsToTicks(4), durationTicks: secondsToTicks(2) }),
    });

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({
        "asset-video-1": { assetId: "asset-video-1", localPath: "/tmp/a.mp4", kind: "video", hasAudio: false },
        "asset-video-2": { assetId: "asset-video-2", localPath: "/tmp/b.mp4", kind: "video", hasAudio: false },
      }),
    });

    expect(graph.videoNodes.some((n) => n.filter.startsWith("xfade"))).toBe(false);
    expect(graph.videoNodes.some((n) => n.filter.startsWith("concat"))).toBe(true);
  });

  it("uses zoompan for an image clip with a Ken Burns animation", () => {
    let seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, {
      trackId: track.id,
      clip: videoClip({
        id: "c1",
        trackId: track.id,
        sourceAssetId: "asset-image-1",
        animation: { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.2, x: 0.2, y: 0 } },
      }),
    });

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({ "asset-image-1": { assetId: "asset-image-1", localPath: "/tmp/img.jpg", kind: "image", hasAudio: false } }),
    });

    expect(graph.inputs[0]!.isImage).toBe(true);
    expect(graph.videoNodes[0]!.filter).toContain("zoompan");
  });

  it("mixes a dedicated audio track and per-clip embedded audio", () => {
    let seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, { trackId: track.id, clip: videoClip({ id: "c1", trackId: track.id }) });
    const audioTrack = seq.audioTracks[0]!;
    seq = {
      ...seq,
      audioTracks: seq.audioTracks.map((t) =>
        t.id !== audioTrack.id
          ? t
          : {
              ...t,
              clips: [
                {
                  id: "aclip-1",
                  sourceAssetId: "asset-music-1",
                  trackId: t.id,
                  startTicks: 0,
                  durationTicks: secondsToTicks(4),
                  sourceInTicks: 0,
                  sourceOutTicks: secondsToTicks(4),
                  gainDb: -6,
                  fadeInTicks: secondsToTicks(0.5),
                  fadeOutTicks: 0,
                  gainKeyframes: [],
                },
              ],
            }
      ),
    };

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({
        "asset-video-1": { assetId: "asset-video-1", localPath: "/tmp/a.mp4", kind: "video", hasAudio: true },
        "asset-music-1": { assetId: "asset-music-1", localPath: "/tmp/music.mp3", kind: "audio", hasAudio: true },
      }),
    });

    expect(graph.finalAudioLabel).toBe("aout");
    const amixNode = graph.audioNodes.find((n) => n.filter.startsWith("amix"));
    expect(amixNode).toBeDefined();
    expect(amixNode!.inputs).toHaveLength(2); // one video-embedded + one music track clip
  });

  it("produces no audio map when nothing has audio", () => {
    let seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, { trackId: track.id, clip: videoClip({ id: "c1", trackId: track.id }) });

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({ "asset-video-1": { assetId: "asset-video-1", localPath: "/tmp/a.mp4", kind: "video", hasAudio: false } }),
    });

    expect(graph.finalAudioLabel).toBeNull();
  });
});

describe("renderGraphToFFmpegArgs", () => {
  it("produces a well-formed argv array with matched -map entries and no shell metacharacters", () => {
    let seq = createEmptySequence({ id: "seq", projectId: "proj", width: 1080, height: 1920, fps: 30 });
    const track = seq.tracks[0]!;
    seq = insertClip(seq, { trackId: track.id, clip: videoClip({ id: "c1", trackId: track.id }) });

    const graph = timelineToRenderGraph({
      sequence: seq,
      resolvedAssets: assetsMap({ "asset-video-1": { assetId: "asset-video-1", localPath: "/tmp/a.mp4", kind: "video", hasAudio: false } }),
    });

    const args = renderGraphToFFmpegArgs(graph, "/tmp/out.mp4", { resolution: "1080p", fps: 30 });
    expect(args).toContain("-filter_complex");
    expect(args).toContain("-map");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
    expect(args.some((a) => a.includes("[0:v]") && a.includes("["))).toBe(true); // the filter_complex string itself
    // no argument should contain a shell-dangerous unescaped sequence like `;rm`
    expect(args.every((a) => !/[$`]/.test(a))).toBe(true);
  });
});
