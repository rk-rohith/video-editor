import { z } from "zod";

/**
 * Timeline data model — the system's single source of truth for preview,
 * undo/redo, AI operations, persistence and rendering. See ARCHITECTURE.md §8.
 *
 * Time is expressed in integer "ticks" rather than seconds or frames so that
 * thousands of trims/splits over a long editing session never accumulate
 * floating-point drift, and so the model isn't tied to one frame rate.
 */
export const TICKS_PER_SECOND = 600; // divisible by 24, 25, 30, 50, 60

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

const nonNegativeTicks = z.number().int().min(0);
const positiveTicks = z.number().int().min(1);

export const easingSchema = z.enum(["linear", "easeIn", "easeOut", "easeInOut"]);
export type Easing = z.infer<typeof easingSchema>;

export function keyframeSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    ticks: nonNegativeTicks,
    value: valueSchema,
    easing: easingSchema.default("linear"),
  });
}

export const transformSchema = z.object({
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  scale: z.number().min(0.01).max(20).default(1),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
});
export type Transform = z.infer<typeof transformSchema>;

export const transformKeyframeSchema = keyframeSchema(transformSchema.partial());

export const kenBurnsAnimationSchema = z.object({
  from: transformSchema.partial(),
  to: transformSchema.partial(),
});
export type KenBurnsAnimation = z.infer<typeof kenBurnsAnimationSchema>;

export const transitionKindSchema = z.enum([
  "cut",
  "dissolve",
  "fade",
  "wipe",
  "push",
  "zoomBlur",
]);
export type TransitionKind = z.infer<typeof transitionKindSchema>;

export const transitionSchema = z.object({
  kind: transitionKindSchema,
  durationTicks: nonNegativeTicks,
  params: z.record(z.number()).default({}),
});
export type Transition = z.infer<typeof transitionSchema>;

export const effectKindSchema = z.enum(["colorGrade", "blur", "vignette", "grain"]);
export const effectSchema = z.object({
  id: z.string(),
  kind: effectKindSchema,
  params: z.record(z.number()).default({}),
});
export type Effect = z.infer<typeof effectSchema>;

export const clipSchema = z.object({
  id: z.string(),
  sourceAssetId: z.string(),
  trackId: z.string(),
  startTicks: nonNegativeTicks,
  durationTicks: positiveTicks,
  sourceInTicks: nonNegativeTicks,
  sourceOutTicks: positiveTicks,
  transform: transformSchema.default({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }),
  transformKeyframes: z.array(transformKeyframeSchema).default([]),
  speed: z.number().min(0.1).max(8).default(1),
  reversed: z.boolean().default(false),
  effects: z.array(effectSchema).default([]),
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional(),
  animation: kenBurnsAnimationSchema.optional(),
});
export type Clip = z.infer<typeof clipSchema>;

export const trackSchema = z.object({
  id: z.string(),
  kind: z.literal("video"),
  index: z.number().int().min(0),
  clips: z.array(clipSchema).default([]),
});
export type Track = z.infer<typeof trackSchema>;

export const audioClipSchema = z.object({
  id: z.string(),
  sourceAssetId: z.string(),
  trackId: z.string(),
  startTicks: nonNegativeTicks,
  durationTicks: positiveTicks,
  sourceInTicks: nonNegativeTicks,
  sourceOutTicks: positiveTicks,
  gainDb: z.number().min(-60).max(24).default(0),
  fadeInTicks: nonNegativeTicks.default(0),
  fadeOutTicks: nonNegativeTicks.default(0),
  gainKeyframes: z.array(keyframeSchema(z.object({ gainDb: z.number() }))).default([]),
});
export type AudioClip = z.infer<typeof audioClipSchema>;

export const audioTrackSchema = z.object({
  id: z.string(),
  clips: z.array(audioClipSchema).default([]),
});
export type AudioTrack = z.infer<typeof audioTrackSchema>;

export const textAnimationSchema = z.enum(["fadeIn", "slideUp", "typeOn", "none"]);

export const wordTimingSchema = z.object({
  word: z.string(),
  startTicks: nonNegativeTicks,
  endTicks: nonNegativeTicks,
});

export const textLayerSchema = z.object({
  id: z.string(),
  startTicks: nonNegativeTicks,
  durationTicks: positiveTicks,
  content: z.string().max(2000),
  fontFamily: z.string().default("Inter"),
  fontSize: z.number().min(4).max(400).default(48),
  fontWeight: z.number().min(100).max(900).default(600),
  color: z.string().default("#FFFFFF"),
  align: z.enum(["left", "center", "right"]).default("center"),
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  animation: textAnimationSchema.default("fadeIn"),
  isCaption: z.boolean().default(false),
  wordTimings: z.array(wordTimingSchema).default([]),
});
export type TextLayer = z.infer<typeof textLayerSchema>;

export const textTrackSchema = z.object({
  id: z.string(),
  layers: z.array(textLayerSchema).default([]),
});
export type TextTrack = z.infer<typeof textTrackSchema>;

export const sequenceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  fps: z.number().int().min(1).max(120).default(30),
  width: z.number().int().min(2).default(1080),
  height: z.number().int().min(2).default(1920),
  durationTicks: nonNegativeTicks.default(0),
  tracks: z.array(trackSchema).default([]),
  audioTracks: z.array(audioTrackSchema).default([]),
  textTracks: z.array(textTrackSchema).default([]),
});
export type Sequence = z.infer<typeof sequenceSchema>;

/** A brand-new, empty sequence for a project at the given aspect ratio. */
export function createEmptySequence(params: {
  id: string;
  projectId: string;
  width?: number;
  height?: number;
  fps?: number;
}): Sequence {
  return sequenceSchema.parse({
    id: params.id,
    projectId: params.projectId,
    fps: params.fps ?? 30,
    width: params.width ?? 1080,
    height: params.height ?? 1920,
    durationTicks: 0,
    tracks: [{ id: `${params.id}-track-0`, kind: "video", index: 0, clips: [] }],
    audioTracks: [{ id: `${params.id}-audio-0`, clips: [] }],
    textTracks: [{ id: `${params.id}-text-0`, layers: [] }],
  });
}

/** Recomputes sequence.durationTicks as the max extent across all tracks. */
export function computeSequenceDuration(sequence: Sequence): number {
  let max = 0;
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.startTicks + clip.durationTicks);
    }
  }
  for (const track of sequence.audioTracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.startTicks + clip.durationTicks);
    }
  }
  for (const track of sequence.textTracks) {
    for (const layer of track.layers) {
      max = Math.max(max, layer.startTicks + layer.durationTicks);
    }
  }
  return max;
}

export function withRecomputedDuration(sequence: Sequence): Sequence {
  return { ...sequence, durationTicks: computeSequenceDuration(sequence) };
}
