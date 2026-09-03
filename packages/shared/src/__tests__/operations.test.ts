import { describe, expect, it } from "vitest";
import { createEmptySequence, secondsToTicks, type Clip } from "../timeline.js";
import {
  addAudio,
  addText,
  applyOperations,
  insertClip,
  moveClip,
  OperationError,
  removeClip,
  setDuration,
  setSpeed,
  splitClip,
  trimClip,
} from "../operations.js";

function baseClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    sourceAssetId: "asset-1",
    trackId: "seq-track-0",
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

describe("createEmptySequence", () => {
  it("creates one video track, one audio track, one text track, zero duration", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    expect(seq.tracks).toHaveLength(1);
    expect(seq.audioTracks).toHaveLength(1);
    expect(seq.textTracks).toHaveLength(1);
    expect(seq.durationTicks).toBe(0);
  });
});

describe("insertClip / removeClip", () => {
  it("inserts a clip and recomputes sequence duration", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const next = insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id }) });
    expect(next.tracks[0]!.clips).toHaveLength(1);
    expect(next.durationTicks).toBe(secondsToTicks(4));
  });

  it("throws inserting into a non-existent track", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    expect(() => insertClip(seq, { trackId: "nope", clip: baseClip() })).toThrow(OperationError);
  });

  it("removes a clip and recomputes duration back to 0", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const withClip = insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id }) });
    const next = removeClip(withClip, { clipId: "clip-1" });
    expect(next.tracks[0]!.clips).toHaveLength(0);
    expect(next.durationTicks).toBe(0);
  });

  it("removes an audio clip too, without the caller needing to know which kind it is", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const audioTrack = seq.audioTracks[0]!;
    const withAudio = addAudio(seq, {
      audioTrackId: audioTrack.id,
      clip: {
        id: "audio-1",
        sourceAssetId: "asset-audio",
        trackId: audioTrack.id,
        startTicks: 0,
        durationTicks: secondsToTicks(4),
        sourceInTicks: 0,
        sourceOutTicks: secondsToTicks(4),
        gainDb: 0,
        fadeInTicks: 0,
        fadeOutTicks: 0,
        gainKeyframes: [],
      },
    });
    expect(withAudio.audioTracks[0]!.clips).toHaveLength(1);
    const next = removeClip(withAudio, { clipId: "audio-1" });
    expect(next.audioTracks[0]!.clips).toHaveLength(0);
  });

  it("throws when removing a clip id that exists nowhere", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    expect(() => removeClip(seq, { clipId: "nope" })).toThrow(OperationError);
  });
});

describe("trimClip", () => {
  function seqWithClip() {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    return insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id, startTicks: secondsToTicks(2) }) });
  }

  it("trimming the 'in' edge shortens duration and shifts source-in and start together", () => {
    const seq = seqWithClip();
    const next = trimClip(seq, { clipId: "clip-1", edge: "in", deltaTicks: secondsToTicks(1) });
    const clip = next.tracks[0]!.clips[0]!;
    expect(clip.startTicks).toBe(secondsToTicks(3));
    expect(clip.sourceInTicks).toBe(secondsToTicks(1));
    expect(clip.durationTicks).toBe(secondsToTicks(3));
  });

  it("trimming the 'out' edge shortens duration and source-out only", () => {
    const seq = seqWithClip();
    const next = trimClip(seq, { clipId: "clip-1", edge: "out", deltaTicks: -secondsToTicks(1) });
    const clip = next.tracks[0]!.clips[0]!;
    expect(clip.startTicks).toBe(secondsToTicks(2));
    expect(clip.sourceOutTicks).toBe(secondsToTicks(3));
    expect(clip.durationTicks).toBe(secondsToTicks(3));
  });

  it("rejects a trim that would invert in/out points", () => {
    const seq = seqWithClip();
    expect(() => trimClip(seq, { clipId: "clip-1", edge: "out", deltaTicks: -secondsToTicks(10) })).toThrow(OperationError);
  });

  it("rejects a trim that would move the in-point negative", () => {
    const seq = seqWithClip();
    expect(() => trimClip(seq, { clipId: "clip-1", edge: "in", deltaTicks: -secondsToTicks(5) })).toThrow(OperationError);
  });
});

describe("splitClip", () => {
  it("splits a clip into two contiguous clips whose durations sum to the original", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const withClip = insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id, durationTicks: secondsToTicks(10) }) });
    const next = splitClip(withClip, { clipId: "clip-1", atTicks: secondsToTicks(4), newClipId: "clip-2" });
    const clips = next.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.durationTicks + clips[1]!.durationTicks).toBe(secondsToTicks(10));
    expect(clips[0]!.startTicks).toBe(0);
    expect(clips[1]!.startTicks).toBe(secondsToTicks(4));
    // source in/out points must also be contiguous
    expect(clips[0]!.sourceOutTicks).toBe(clips[1]!.sourceInTicks);
  });

  it("rejects a split point outside the clip", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const withClip = insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id, durationTicks: secondsToTicks(10) }) });
    expect(() => splitClip(withClip, { clipId: "clip-1", atTicks: secondsToTicks(20), newClipId: "clip-2" })).toThrow(OperationError);
    expect(() => splitClip(withClip, { clipId: "clip-1", atTicks: 0, newClipId: "clip-2" })).toThrow(OperationError);
  });
});

describe("moveClip", () => {
  it("moves a clip to a new start time on the same track", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const withClip = insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id }) });
    const next = moveClip(withClip, { clipId: "clip-1", newStartTicks: secondsToTicks(5) });
    expect(next.tracks[0]!.clips[0]!.startTicks).toBe(secondsToTicks(5));
    expect(next.durationTicks).toBe(secondsToTicks(9));
  });
});

describe("setDuration", () => {
  it("extends a clip's duration and proportionally extends the source out-point", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const withClip = insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id }) });
    const next = setDuration(withClip, { clipId: "clip-1", durationTicks: secondsToTicks(6) });
    const clip = next.tracks[0]!.clips[0]!;
    expect(clip.durationTicks).toBe(secondsToTicks(6));
    expect(clip.sourceOutTicks).toBe(secondsToTicks(6));
  });
});

describe("setSpeed", () => {
  it("doubling speed halves the on-timeline duration, source range unchanged", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const withClip = insertClip(seq, { trackId: track.id, clip: baseClip({ trackId: track.id }) });
    const next = setSpeed(withClip, { clipId: "clip-1", speed: 2 });
    const clip = next.tracks[0]!.clips[0]!;
    expect(clip.speed).toBe(2);
    expect(clip.durationTicks).toBe(secondsToTicks(2));
    expect(clip.sourceInTicks).toBe(0);
    expect(clip.sourceOutTicks).toBe(secondsToTicks(4));
  });
});

describe("addText", () => {
  it("adds a text layer and recomputes sequence duration if it extends past the clips", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const textTrack = seq.textTracks[0]!;
    const next = addText(seq, {
      textTrackId: textTrack.id,
      layer: {
        id: "text-1",
        startTicks: 0,
        durationTicks: secondsToTicks(3),
        content: "Hello",
        fontFamily: "Inter",
        fontSize: 48,
        fontWeight: 600,
        color: "#fff",
        align: "center",
        x: 0,
        y: 0,
        animation: "fadeIn",
        isCaption: false,
        wordTimings: [],
      },
    });
    expect(next.textTracks[0]!.layers).toHaveLength(1);
    expect(next.durationTicks).toBe(secondsToTicks(3));
  });
});

describe("applyOperations", () => {
  it("applies a batch of operations in order, producing one final sequence", () => {
    const seq = createEmptySequence({ id: "seq", projectId: "proj" });
    const track = seq.tracks[0]!;
    const next = applyOperations(seq, [
      { op: "insertClip", args: { trackId: track.id, clip: baseClip({ trackId: track.id, durationTicks: secondsToTicks(10) }) } },
      { op: "trimClip", args: { clipId: "clip-1", edge: "out", deltaTicks: -secondsToTicks(2) } },
      { op: "splitClip", args: { clipId: "clip-1", atTicks: secondsToTicks(4), newClipId: "clip-2" } },
      { op: "moveClip", args: { clipId: "clip-2", newStartTicks: secondsToTicks(6) } },
    ]);
    expect(next.tracks[0]!.clips).toHaveLength(2);
    expect(next.tracks[0]!.clips.find((c) => c.id === "clip-2")!.startTicks).toBe(secondsToTicks(6));
  });
});
