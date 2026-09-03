import { z } from "zod";

/**
 * "Video DNA" — the structured, reusable representation produced by the
 * Phase 3 reference-analysis pipeline. See ARCHITECTURE.md §9 and §21 for
 * the copyright-safety rationale: this schema is deliberately incapable of
 * holding reference media bytes, sub-clips, or audio — only derived
 * numeric/structural/labeled features, each carrying a confidence score
 * shown to the user rather than presented as forensic fact.
 *
 * Not implemented (no analysis pipeline ships) in this Phase 1 pass — this
 * schema exists now so the data model doesn't need to change shape later.
 */

const confidence = z.number().min(0).max(1);

export const sceneRoleSchema = z.enum(["hook", "establish", "body", "climax", "cta", "outro", "logo"]);
export const shotTypeSchema = z.enum(["wide", "medium", "closeup", "detail", "unknown"]);
export const cameraMotionSchema = z.enum(["static", "pan", "tilt", "zoomIn", "zoomOut", "handheld", "tracking"]);

export const sceneSchema = z.object({
  id: z.string(),
  startTicks: z.number().int().min(0),
  endTicks: z.number().int().min(0),
  role: sceneRoleSchema,
  shotType: shotTypeSchema,
  cameraMotion: cameraMotionSchema,
  motionDirection: z.enum(["left", "right", "up", "down", "inOut"]).optional(),
  dominantColors: z.array(z.string()),
  confidence,
});

export const transitionDnaSchema = z.object({
  afterSceneId: z.string(),
  kind: z.enum(["cut", "dissolve", "fade", "wipe", "whipPan", "zoomBlur", "flash", "unknown"]),
  durationTicks: z.number().int().min(0),
  confidence,
});

export const colorProfileSchema = z.object({
  exposure: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  temperature: z.number(),
  tint: z.number(),
  shadowsRGB: z.tuple([z.number(), z.number(), z.number()]),
  highlightsRGB: z.tuple([z.number(), z.number(), z.number()]),
  vignetteStrength: z.number().min(0).max(1),
  grainAmount: z.number().min(0).max(1),
});

export const typographyEventSchema = z.object({
  startTicks: z.number().int().min(0),
  endTicks: z.number().int().min(0),
  role: z.enum(["title", "subtitle", "lowerThird", "cta", "caption"]),
  fontCategory: z.enum(["serif", "sans", "condensed", "display", "mono"]),
  weightBucket: z.enum(["light", "regular", "bold", "black"]),
  caseStyle: z.enum(["upper", "title", "sentence"]),
  position: z.enum(["top", "center", "bottom", "lowerThird"]),
  animationStyle: z.enum(["fadeIn", "slideUp", "typeOn", "none"]),
});

export const videoDnaSchema = z.object({
  version: z.literal(1),
  sourceDurationTicks: z.number().int().min(0),
  aspectRatio: z.string(),
  genre: z.string(),
  pace: z.enum(["slow", "medium", "fast", "variable"]),
  sceneStructure: z.array(sceneSchema),
  shotPattern: z.array(z.object({ durationTicks: z.number().int(), count: z.number().int() })),
  transitions: z.array(transitionDnaSchema),
  colorProfile: colorProfileSchema,
  typography: z.object({
    events: z.array(typographyEventSchema),
    suggestedFontFamily: z.string(),
  }),
  beatMap: z.array(z.object({ ticks: z.number().int(), strength: z.number().min(0).max(1) })),
  audioEnergyCurve: z.array(z.object({ ticks: z.number().int(), energy: z.number().min(0).max(1) })),
  effects: z.array(z.object({ kind: z.string(), startTicks: z.number().int(), endTicks: z.number().int(), params: z.record(z.number()) })),
  storyArc: z.object({
    hookStrategy: z
      .enum(["curiosity", "visualImpact", "question", "surprisingFact", "resultFirst", "problemSolution", "beforeAfter"])
      .optional(),
    ctaStyle: z.enum(["textOverlay", "voiceover", "endCard"]).optional(),
  }),
  analysisMeta: z.object({
    modelVersions: z.record(z.string()),
    analyzedAt: z.string(),
    keyframesSampled: z.number().int().min(0),
  }),
});
export type VideoDNA = z.infer<typeof videoDnaSchema>;
