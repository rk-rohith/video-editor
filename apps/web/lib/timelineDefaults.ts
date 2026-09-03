import type { AudioClip, Clip, TextLayer } from "@video-editor/shared";

/**
 * Client-side constructors that fully populate every field a Clip/AudioClip/
 * TextLayer needs. The editor store applies operations optimistically via
 * the same pure reducers the API uses (see ARCHITECTURE.md §18/§29), but
 * that optimistic path does NOT run the objects through Zod's `.default()`
 * fill-in the way the server's request validation does — so client-built
 * objects must be complete, not rely on server-side defaulting.
 */

export function createId(): string {
  return crypto.randomUUID();
}

export function createDefaultClip(overrides: Pick<Clip, "sourceAssetId" | "trackId" | "startTicks" | "durationTicks" | "sourceOutTicks"> & Partial<Clip>): Clip {
  return {
    id: createId(),
    sourceInTicks: 0,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    transformKeyframes: [],
    speed: 1,
    reversed: false,
    effects: [],
    ...overrides,
  };
}

export function createDefaultAudioClip(
  overrides: Pick<AudioClip, "sourceAssetId" | "trackId" | "startTicks" | "durationTicks" | "sourceOutTicks"> & Partial<AudioClip>
): AudioClip {
  return {
    id: createId(),
    sourceInTicks: 0,
    gainDb: 0,
    fadeInTicks: 0,
    fadeOutTicks: 0,
    gainKeyframes: [],
    ...overrides,
  };
}

export function createDefaultTextLayer(overrides: Pick<TextLayer, "startTicks" | "durationTicks" | "content"> & Partial<TextLayer>): TextLayer {
  return {
    id: createId(),
    fontFamily: "Inter",
    fontSize: 56,
    fontWeight: 700,
    color: "#FFFFFF",
    align: "center",
    x: 0,
    y: 0.7,
    animation: "fadeIn",
    isCaption: false,
    wordTimings: [],
    ...overrides,
  };
}
