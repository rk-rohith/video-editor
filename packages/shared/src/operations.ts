import { z } from "zod";
import {
  type AudioClip,
  audioClipSchema,
  type Clip,
  clipSchema,
  type Sequence,
  type TextLayer,
  textLayerSchema,
  transformKeyframeSchema,
  transformSchema,
  transitionSchema,
  withRecomputedDuration,
  keyframeSchema,
} from "./timeline.js";

/**
 * The closed set of timeline operations. This is the ONLY interface through
 * which the timeline is ever mutated — by the manual editor UI and, from
 * Phase 2 onward, by the AI natural-language editing tool-calling loop
 * (see ARCHITECTURE.md §18/§29). An LLM never edits the Sequence object
 * directly; it can only propose one of these named, schema-validated calls.
 *
 * Every function below is pure: (sequence, args) -> new sequence. This makes
 * each operation independently unit-testable and makes "undo" trivial —
 * every applied batch of operations produces one new TimelineVersion, so
 * undo is just "restore the previous version" (see ARCHITECTURE.md §22).
 */

function assertFound<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new OperationError(message);
  return value;
}

export class OperationError extends Error {}

function findTrackAndClip(sequence: Sequence, clipId: string) {
  for (const track of sequence.tracks) {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx !== -1) return { track, clip: track.clips[idx]!, idx };
  }
  return undefined;
}

function findAudioTrackAndClip(sequence: Sequence, audioClipId: string) {
  for (const track of sequence.audioTracks) {
    const idx = track.clips.findIndex((c) => c.id === audioClipId);
    if (idx !== -1) return { track, clip: track.clips[idx]!, idx };
  }
  return undefined;
}

function updateClip(sequence: Sequence, clipId: string, update: (clip: Clip) => Clip): Sequence {
  const found = assertFound(findTrackAndClip(sequence, clipId), `Clip not found: ${clipId}`);
  return {
    ...sequence,
    tracks: sequence.tracks.map((track) =>
      track.id !== found.track.id
        ? track
        : {
            ...track,
            clips: track.clips.map((c) => (c.id === clipId ? update(c) : c)),
          }
    ),
  };
}

// ---------------------------------------------------------------------------
// insertClip
// ---------------------------------------------------------------------------
export const insertClipArgsSchema = z.object({ trackId: z.string(), clip: clipSchema });
export type InsertClipArgs = z.infer<typeof insertClipArgsSchema>;

export function insertClip(sequence: Sequence, args: InsertClipArgs): Sequence {
  const trackExists = sequence.tracks.some((t) => t.id === args.trackId);
  if (!trackExists) throw new OperationError(`Track not found: ${args.trackId}`);
  const next: Sequence = {
    ...sequence,
    tracks: sequence.tracks.map((track) =>
      track.id !== args.trackId
        ? track
        : {
            ...track,
            clips: [...track.clips, { ...args.clip, trackId: args.trackId }].sort(
              (a, b) => a.startTicks - b.startTicks
            ),
          }
    ),
  };
  return withRecomputedDuration(next);
}

// ---------------------------------------------------------------------------
// removeClip
// ---------------------------------------------------------------------------
export const removeClipArgsSchema = z.object({ clipId: z.string() });
export type RemoveClipArgs = z.infer<typeof removeClipArgsSchema>;

/** Removes a clip by id — checks video tracks first, then audio tracks, so callers don't need to know which kind they're deleting. */
export function removeClip(sequence: Sequence, args: RemoveClipArgs): Sequence {
  const videoFound = findTrackAndClip(sequence, args.clipId);
  if (videoFound) {
    const next: Sequence = {
      ...sequence,
      tracks: sequence.tracks.map((track) =>
        track.id !== videoFound.track.id ? track : { ...track, clips: track.clips.filter((c) => c.id !== args.clipId) }
      ),
    };
    return withRecomputedDuration(next);
  }

  const audioFound = assertFound(findAudioTrackAndClip(sequence, args.clipId), `Clip not found: ${args.clipId}`);
  const next: Sequence = {
    ...sequence,
    audioTracks: sequence.audioTracks.map((track) =>
      track.id !== audioFound.track.id ? track : { ...track, clips: track.clips.filter((c) => c.id !== args.clipId) }
    ),
  };
  return withRecomputedDuration(next);
}

// ---------------------------------------------------------------------------
// replaceClip — swap the source asset/in-out points, keep timeline position
// ---------------------------------------------------------------------------
export const replaceClipArgsSchema = z.object({
  clipId: z.string(),
  sourceAssetId: z.string(),
  sourceInTicks: z.number().int().min(0),
  sourceOutTicks: z.number().int().min(1),
});
export type ReplaceClipArgs = z.infer<typeof replaceClipArgsSchema>;

export function replaceClip(sequence: Sequence, args: ReplaceClipArgs): Sequence {
  if (args.sourceOutTicks <= args.sourceInTicks) {
    throw new OperationError("sourceOutTicks must be greater than sourceInTicks");
  }
  return updateClip(sequence, args.clipId, (clip) => ({
    ...clip,
    sourceAssetId: args.sourceAssetId,
    sourceInTicks: args.sourceInTicks,
    sourceOutTicks: args.sourceOutTicks,
  }));
}

// ---------------------------------------------------------------------------
// trimClip — drag the in or out edge, adjusting source in/out AND the
// timeline position/duration together, the way a real trim handle behaves.
// ---------------------------------------------------------------------------
export const trimClipArgsSchema = z.object({
  clipId: z.string(),
  edge: z.enum(["in", "out"]),
  deltaTicks: z.number().int(),
});
export type TrimClipArgs = z.infer<typeof trimClipArgsSchema>;

export function trimClip(sequence: Sequence, args: TrimClipArgs): Sequence {
  const next = updateClip(sequence, args.clipId, (clip) => {
    if (args.edge === "in") {
      const newSourceIn = clip.sourceInTicks + args.deltaTicks;
      const newStart = clip.startTicks + args.deltaTicks;
      const newDuration = clip.durationTicks - args.deltaTicks;
      if (newSourceIn < 0) throw new OperationError("Trim would move source in-point before 0");
      if (newSourceIn >= clip.sourceOutTicks) throw new OperationError("Trim would invert in/out points");
      if (newStart < 0) throw new OperationError("Trim would move clip start before 0");
      if (newDuration < 1) throw new OperationError("Trim would leave a zero/negative duration clip");
      return { ...clip, sourceInTicks: newSourceIn, startTicks: newStart, durationTicks: newDuration };
    } else {
      const newSourceOut = clip.sourceOutTicks + args.deltaTicks;
      const newDuration = clip.durationTicks + args.deltaTicks;
      if (newSourceOut <= clip.sourceInTicks) throw new OperationError("Trim would invert in/out points");
      if (newDuration < 1) throw new OperationError("Trim would leave a zero/negative duration clip");
      return { ...clip, sourceOutTicks: newSourceOut, durationTicks: newDuration };
    }
  });
  return withRecomputedDuration(next);
}

// ---------------------------------------------------------------------------
// splitClip — split one clip into two contiguous clips at a timeline tick
// ---------------------------------------------------------------------------
export const splitClipArgsSchema = z.object({
  clipId: z.string(),
  atTicks: z.number().int().min(0),
  newClipId: z.string(),
});
export type SplitClipArgs = z.infer<typeof splitClipArgsSchema>;

export function splitClip(sequence: Sequence, args: SplitClipArgs): Sequence {
  const found = assertFound(findTrackAndClip(sequence, args.clipId), `Clip not found: ${args.clipId}`);
  const clip = found.clip;
  const clipEnd = clip.startTicks + clip.durationTicks;
  if (args.atTicks <= clip.startTicks || args.atTicks >= clipEnd) {
    throw new OperationError("Split point must be strictly inside the clip");
  }
  const firstDuration = args.atTicks - clip.startTicks;
  const secondDuration = clip.durationTicks - firstDuration;
  const sourceSplitOffset = Math.round(firstDuration * clip.speed);

  const first: Clip = { ...clip, durationTicks: firstDuration, sourceOutTicks: clip.sourceInTicks + sourceSplitOffset, transitionOut: undefined };
  const second: Clip = {
    ...clip,
    id: args.newClipId,
    startTicks: args.atTicks,
    durationTicks: secondDuration,
    sourceInTicks: clip.sourceInTicks + sourceSplitOffset,
    transitionIn: undefined,
  };

  const next: Sequence = {
    ...sequence,
    tracks: sequence.tracks.map((track) =>
      track.id !== found.track.id
        ? track
        : {
            ...track,
            clips: track.clips.flatMap((c) => (c.id === args.clipId ? [first, second] : [c])),
          }
    ),
  };
  return withRecomputedDuration(next);
}

// ---------------------------------------------------------------------------
// moveClip — reposition a clip in time and/or move it to a different track
// ---------------------------------------------------------------------------
export const moveClipArgsSchema = z.object({
  clipId: z.string(),
  newStartTicks: z.number().int().min(0),
  newTrackId: z.string().optional(),
});
export type MoveClipArgs = z.infer<typeof moveClipArgsSchema>;

export function moveClip(sequence: Sequence, args: MoveClipArgs): Sequence {
  const found = assertFound(findTrackAndClip(sequence, args.clipId), `Clip not found: ${args.clipId}`);
  const targetTrackId = args.newTrackId ?? found.track.id;
  if (!sequence.tracks.some((t) => t.id === targetTrackId)) {
    throw new OperationError(`Track not found: ${targetTrackId}`);
  }
  const movedClip: Clip = { ...found.clip, startTicks: args.newStartTicks, trackId: targetTrackId };

  const next: Sequence = {
    ...sequence,
    tracks: sequence.tracks.map((track) => {
      if (track.id === found.track.id && track.id === targetTrackId) {
        return { ...track, clips: track.clips.map((c) => (c.id === args.clipId ? movedClip : c)).sort((a, b) => a.startTicks - b.startTicks) };
      }
      if (track.id === found.track.id) {
        return { ...track, clips: track.clips.filter((c) => c.id !== args.clipId) };
      }
      if (track.id === targetTrackId) {
        return { ...track, clips: [...track.clips, movedClip].sort((a, b) => a.startTicks - b.startTicks) };
      }
      return track;
    }),
  };
  return withRecomputedDuration(next);
}

// ---------------------------------------------------------------------------
// setDuration — resize a clip's on-timeline duration (right-edge resize),
// keeping the in-point fixed and adjusting the source out-point to match.
// ---------------------------------------------------------------------------
export const setDurationArgsSchema = z.object({ clipId: z.string(), durationTicks: z.number().int().min(1) });
export type SetDurationArgs = z.infer<typeof setDurationArgsSchema>;

export function setDuration(sequence: Sequence, args: SetDurationArgs): Sequence {
  const next = updateClip(sequence, args.clipId, (clip) => ({
    ...clip,
    durationTicks: args.durationTicks,
    sourceOutTicks: clip.sourceInTicks + Math.round(args.durationTicks * clip.speed),
  }));
  return withRecomputedDuration(next);
}

// ---------------------------------------------------------------------------
// setTransform
// ---------------------------------------------------------------------------
export const setTransformArgsSchema = z.object({ clipId: z.string(), transform: transformSchema.partial() });
export type SetTransformArgs = z.infer<typeof setTransformArgsSchema>;

export function setTransform(sequence: Sequence, args: SetTransformArgs): Sequence {
  return updateClip(sequence, args.clipId, (clip) => ({ ...clip, transform: { ...clip.transform, ...args.transform } }));
}

// ---------------------------------------------------------------------------
// addTransition / removeTransition
// ---------------------------------------------------------------------------
export const addTransitionArgsSchema = z.object({
  clipId: z.string(),
  edge: z.enum(["in", "out"]),
  transition: transitionSchema,
});
export type AddTransitionArgs = z.infer<typeof addTransitionArgsSchema>;

export function addTransition(sequence: Sequence, args: AddTransitionArgs): Sequence {
  return updateClip(sequence, args.clipId, (clip) =>
    args.edge === "in" ? { ...clip, transitionIn: args.transition } : { ...clip, transitionOut: args.transition }
  );
}

export const removeTransitionArgsSchema = z.object({ clipId: z.string(), edge: z.enum(["in", "out"]) });
export type RemoveTransitionArgs = z.infer<typeof removeTransitionArgsSchema>;

export function removeTransition(sequence: Sequence, args: RemoveTransitionArgs): Sequence {
  return updateClip(sequence, args.clipId, (clip) =>
    args.edge === "in" ? { ...clip, transitionIn: undefined } : { ...clip, transitionOut: undefined }
  );
}

// ---------------------------------------------------------------------------
// addText / updateText / addCaption
// ---------------------------------------------------------------------------
export const addTextArgsSchema = z.object({ textTrackId: z.string(), layer: textLayerSchema });
export type AddTextArgs = z.infer<typeof addTextArgsSchema>;

export function addText(sequence: Sequence, args: AddTextArgs): Sequence {
  if (!sequence.textTracks.some((t) => t.id === args.textTrackId)) {
    throw new OperationError(`Text track not found: ${args.textTrackId}`);
  }
  const next: Sequence = {
    ...sequence,
    textTracks: sequence.textTracks.map((track) =>
      track.id !== args.textTrackId ? track : { ...track, layers: [...track.layers, args.layer].sort((a, b) => a.startTicks - b.startTicks) }
    ),
  };
  return withRecomputedDuration(next);
}

export const updateTextArgsSchema = z.object({ layerId: z.string(), patch: textLayerSchema.partial() });
export type UpdateTextArgs = z.infer<typeof updateTextArgsSchema>;

export function updateText(sequence: Sequence, args: UpdateTextArgs): Sequence {
  let found = false;
  const next: Sequence = {
    ...sequence,
    textTracks: sequence.textTracks.map((track) => ({
      ...track,
      layers: track.layers.map((layer) => {
        if (layer.id !== args.layerId) return layer;
        found = true;
        return { ...layer, ...args.patch };
      }),
    })),
  };
  if (!found) throw new OperationError(`Text layer not found: ${args.layerId}`);
  return withRecomputedDuration(next);
}

export const addCaptionArgsSchema = z.object({ textTrackId: z.string(), layer: textLayerSchema });
export type AddCaptionArgs = z.infer<typeof addCaptionArgsSchema>;

export function addCaption(sequence: Sequence, args: AddCaptionArgs): Sequence {
  return addText(sequence, { textTrackId: args.textTrackId, layer: { ...args.layer, isCaption: true } });
}

// ---------------------------------------------------------------------------
// setSpeed — recomputes on-timeline duration from the (fixed) source range
// ---------------------------------------------------------------------------
export const setSpeedArgsSchema = z.object({ clipId: z.string(), speed: z.number().min(0.1).max(8) });
export type SetSpeedArgs = z.infer<typeof setSpeedArgsSchema>;

export function setSpeed(sequence: Sequence, args: SetSpeedArgs): Sequence {
  const next = updateClip(sequence, args.clipId, (clip) => {
    const sourceRange = clip.sourceOutTicks - clip.sourceInTicks;
    const durationTicks = Math.max(1, Math.round(sourceRange / args.speed));
    return { ...clip, speed: args.speed, durationTicks };
  });
  return withRecomputedDuration(next);
}

// ---------------------------------------------------------------------------
// setColorGrade — upsert a `colorGrade` effect on a clip
// ---------------------------------------------------------------------------
export const setColorGradeArgsSchema = z.object({ clipId: z.string(), effectId: z.string(), params: z.record(z.number()) });
export type SetColorGradeArgs = z.infer<typeof setColorGradeArgsSchema>;

export function setColorGrade(sequence: Sequence, args: SetColorGradeArgs): Sequence {
  return updateClip(sequence, args.clipId, (clip) => {
    const existingIdx = clip.effects.findIndex((e) => e.kind === "colorGrade");
    if (existingIdx === -1) {
      return { ...clip, effects: [...clip.effects, { id: args.effectId, kind: "colorGrade", params: args.params }] };
    }
    return {
      ...clip,
      effects: clip.effects.map((e, i) => (i === existingIdx ? { ...e, params: { ...e.params, ...args.params } } : e)),
    };
  });
}

// ---------------------------------------------------------------------------
// addAudio / adjustVolume
// ---------------------------------------------------------------------------
export const addAudioArgsSchema = z.object({ audioTrackId: z.string(), clip: audioClipSchema });
export type AddAudioArgs = z.infer<typeof addAudioArgsSchema>;

export function addAudio(sequence: Sequence, args: AddAudioArgs): Sequence {
  if (!sequence.audioTracks.some((t) => t.id === args.audioTrackId)) {
    throw new OperationError(`Audio track not found: ${args.audioTrackId}`);
  }
  const next: Sequence = {
    ...sequence,
    audioTracks: sequence.audioTracks.map((track) =>
      track.id !== args.audioTrackId
        ? track
        : { ...track, clips: [...track.clips, { ...args.clip, trackId: args.audioTrackId }].sort((a, b) => a.startTicks - b.startTicks) }
    ),
  };
  return withRecomputedDuration(next);
}

export const adjustVolumeArgsSchema = z.object({ audioClipId: z.string(), gainDb: z.number().min(-60).max(24) });
export type AdjustVolumeArgs = z.infer<typeof adjustVolumeArgsSchema>;

export function adjustVolume(sequence: Sequence, args: AdjustVolumeArgs): Sequence {
  const found = assertFound(findAudioTrackAndClip(sequence, args.audioClipId), `Audio clip not found: ${args.audioClipId}`);
  return {
    ...sequence,
    audioTracks: sequence.audioTracks.map((track) =>
      track.id !== found.track.id
        ? track
        : { ...track, clips: track.clips.map((c) => (c.id === args.audioClipId ? { ...c, gainDb: args.gainDb } : c)) }
    ),
  };
}

// ---------------------------------------------------------------------------
// addKeyframe — either a clip transform keyframe or an audio-gain keyframe
// ---------------------------------------------------------------------------
export const addKeyframeArgsSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("transform"), clipId: z.string(), keyframe: transformKeyframeSchema }),
  z.object({ target: z.literal("audioGain"), audioClipId: z.string(), keyframe: keyframeSchema(z.object({ gainDb: z.number() })) }),
]);
export type AddKeyframeArgs = z.infer<typeof addKeyframeArgsSchema>;

export function addKeyframe(sequence: Sequence, args: AddKeyframeArgs): Sequence {
  if (args.target === "transform") {
    return updateClip(sequence, args.clipId, (clip) => ({
      ...clip,
      transformKeyframes: [...clip.transformKeyframes, args.keyframe].sort((a, b) => a.ticks - b.ticks),
    }));
  }
  const found = assertFound(findAudioTrackAndClip(sequence, args.audioClipId), `Audio clip not found: ${args.audioClipId}`);
  return {
    ...sequence,
    audioTracks: sequence.audioTracks.map((track) =>
      track.id !== found.track.id
        ? track
        : {
            ...track,
            clips: track.clips.map((c) =>
              c.id === args.audioClipId
                ? { ...c, gainKeyframes: [...c.gainKeyframes, args.keyframe].sort((a, b) => a.ticks - b.ticks) }
                : c
            ),
          }
    ),
  };
}

// ---------------------------------------------------------------------------
// The discriminated-union Operation type + a single applyOperation dispatcher
// ---------------------------------------------------------------------------
export const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("insertClip"), args: insertClipArgsSchema }),
  z.object({ op: z.literal("removeClip"), args: removeClipArgsSchema }),
  z.object({ op: z.literal("replaceClip"), args: replaceClipArgsSchema }),
  z.object({ op: z.literal("trimClip"), args: trimClipArgsSchema }),
  z.object({ op: z.literal("splitClip"), args: splitClipArgsSchema }),
  z.object({ op: z.literal("moveClip"), args: moveClipArgsSchema }),
  z.object({ op: z.literal("setDuration"), args: setDurationArgsSchema }),
  z.object({ op: z.literal("setTransform"), args: setTransformArgsSchema }),
  z.object({ op: z.literal("addTransition"), args: addTransitionArgsSchema }),
  z.object({ op: z.literal("removeTransition"), args: removeTransitionArgsSchema }),
  z.object({ op: z.literal("addText"), args: addTextArgsSchema }),
  z.object({ op: z.literal("updateText"), args: updateTextArgsSchema }),
  z.object({ op: z.literal("addCaption"), args: addCaptionArgsSchema }),
  z.object({ op: z.literal("setSpeed"), args: setSpeedArgsSchema }),
  z.object({ op: z.literal("setColorGrade"), args: setColorGradeArgsSchema }),
  z.object({ op: z.literal("addAudio"), args: addAudioArgsSchema }),
  z.object({ op: z.literal("adjustVolume"), args: adjustVolumeArgsSchema }),
  z.object({ op: z.literal("addKeyframe"), args: addKeyframeArgsSchema }),
]);
export type Operation = z.infer<typeof operationSchema>;

/**
 * Applies one validated Operation to a Sequence, returning a NEW Sequence
 * (never mutates the input). This is the single choke point every timeline
 * mutation passes through — the manual editor's API calls and (from Phase 2)
 * the AI tool-calling loop both bottom out here.
 */
export function applyOperation(sequence: Sequence, operation: Operation): Sequence {
  switch (operation.op) {
    case "insertClip":
      return insertClip(sequence, operation.args);
    case "removeClip":
      return removeClip(sequence, operation.args);
    case "replaceClip":
      return replaceClip(sequence, operation.args);
    case "trimClip":
      return trimClip(sequence, operation.args);
    case "splitClip":
      return splitClip(sequence, operation.args);
    case "moveClip":
      return moveClip(sequence, operation.args);
    case "setDuration":
      return setDuration(sequence, operation.args);
    case "setTransform":
      return setTransform(sequence, operation.args);
    case "addTransition":
      return addTransition(sequence, operation.args);
    case "removeTransition":
      return removeTransition(sequence, operation.args);
    case "addText":
      return addText(sequence, operation.args);
    case "updateText":
      return updateText(sequence, operation.args);
    case "addCaption":
      return addCaption(sequence, operation.args);
    case "setSpeed":
      return setSpeed(sequence, operation.args);
    case "setColorGrade":
      return setColorGrade(sequence, operation.args);
    case "addAudio":
      return addAudio(sequence, operation.args);
    case "adjustVolume":
      return adjustVolume(sequence, operation.args);
    case "addKeyframe":
      return addKeyframe(sequence, operation.args);
  }
}

export function applyOperations(sequence: Sequence, operations: Operation[]): Sequence {
  return operations.reduce((seq, op) => applyOperation(seq, op), sequence);
}
