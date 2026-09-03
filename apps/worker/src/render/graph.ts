import { TICKS_PER_SECOND, ticksToSeconds, type Clip, type Effect, type Sequence, type TextLayer, type TransitionKind } from "@video-editor/shared";
import type { FilterNode, RenderGraph, RenderInput, ResolvedAsset } from "./types.js";

const XFADE_TRANSITION_NAMES: Record<Exclude<TransitionKind, "cut">, string> = {
  dissolve: "dissolve",
  fade: "fadeblack",
  wipe: "wipeleft",
  push: "slideleft",
  zoomBlur: "zoomin",
};

function fmt(n: number): string {
  // Fixed-point, locale-independent formatting for values embedded in filter expressions.
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function assetFor(resolvedAssets: Map<string, ResolvedAsset>, assetId: string): ResolvedAsset {
  const asset = resolvedAssets.get(assetId);
  if (!asset) throw new Error(`No resolved asset provided for sourceAssetId=${assetId}`);
  return asset;
}

function effectFilters(effects: Effect[]): string[] {
  const filters: string[] = [];
  for (const effect of effects) {
    const p = effect.params;
    switch (effect.kind) {
      case "colorGrade": {
        const brightness = p.brightness ?? 0;
        const contrast = p.contrast ?? 1;
        const saturation = p.saturation ?? 1;
        filters.push(`eq=brightness=${fmt(brightness)}:contrast=${fmt(contrast)}:saturation=${fmt(saturation)}`);
        if (p.temperatureKelvin !== undefined) {
          filters.push(`colortemperature=temperature=${fmt(Math.min(40000, Math.max(1000, p.temperatureKelvin)))}`);
        }
        break;
      }
      case "blur":
        filters.push(`boxblur=${fmt(Math.max(0, p.radius ?? 2))}:1`);
        break;
      case "vignette":
        filters.push("vignette");
        break;
      case "grain":
        filters.push(`noise=alls=${fmt(Math.round(Math.max(0, Math.min(1, p.amount ?? 0.3)) * 40))}:allf=t+u`);
        break;
    }
  }
  return filters;
}

/** Fit-to-canvas ("cover" mode: fills the frame, cropping overflow) + normalize fps/pixel format so every clip's stream is concat/xfade-compatible. */
function fitToCanvasFilters(width: number, height: number, fps: number): string[] {
  return [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`, `fps=${fps}`, "format=yuv420p", "setsar=1"];
}

/** Static pan/zoom from a clip's `transform` (scale>=1 zoom-in only — see ARCHITECTURE.md render-pipeline notes on scope). */
function staticTransformFilters(width: number, height: number, clip: Clip): string[] {
  const filters: string[] = [];
  const scale = Math.max(1, clip.transform.scale);
  if (scale > 1) {
    filters.push(`scale=iw*${fmt(scale)}:ih*${fmt(scale)}`);
    const xExpr = `(iw-${width})/2+${fmt(clip.transform.x)}*(iw-${width})/2`;
    const yExpr = `(ih-${height})/2+${fmt(clip.transform.y)}*(ih-${height})/2`;
    filters.push(`crop=${width}:${height}:x='${xExpr}':y='${yExpr}'`);
  }
  if (clip.transform.rotation !== 0) {
    filters.push(`rotate=${fmt((clip.transform.rotation * Math.PI) / 180)}:ow=${width}:oh=${height}:c=black`);
  }
  if (clip.transform.opacity < 1) {
    // Blend against a black canvas — concat/xfade streams carry no alpha channel.
    filters.push(`format=yuv420p,eq=brightness=${fmt(-((1 - clip.transform.opacity) * 0.5))}`);
  }
  return filters;
}

/** Ken Burns pan/zoom for a still image via zoompan, interpolating from `animation.from` to `animation.to` across the clip's full duration. See ARCHITECTURE.md §12/spec §12. */
function kenBurnsFilters(width: number, height: number, fps: number, clip: Clip, durationSeconds: number): string[] {
  const anim = clip.animation!;
  const frames = Math.max(1, Math.round(durationSeconds * fps));
  const zFrom = Math.max(1, anim.from.scale ?? 1);
  const zTo = Math.max(1, anim.to.scale ?? 1);
  const xFrom = anim.from.x ?? 0;
  const xTo = anim.to.x ?? 0;
  const yFrom = anim.from.y ?? 0;
  const yTo = anim.to.y ?? 0;
  const t = frames > 1 ? `on/${frames - 1}` : "0";

  const zExpr = `${fmt(zFrom)}+(${fmt(zTo)}-${fmt(zFrom)})*${t}`;
  const xNorm = `(${fmt(xFrom)}+(${fmt(xTo)}-${fmt(xFrom)})*${t})`;
  const yNorm = `(${fmt(yFrom)}+(${fmt(yTo)}-${fmt(yFrom)})*${t})`;
  const xExpr = `(iw-iw/zoom)/2+${xNorm}*(iw-iw/zoom)/2`;
  const yExpr = `(ih-ih/zoom)/2+${yNorm}*(ih-ih/zoom)/2`;

  return [
    // Upscale generously first so zoompan has resolution headroom to crop from.
    "scale=8000:-1",
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps}`,
    // A looped image source re-triggers zoompan's whole d-frame animation on
    // EVERY raw input frame it emits (not just once), so without this the
    // output balloons to (raw input frames) x d frames instead of d frames.
    // Hard-capping to exactly `frames` output frames here is what actually
    // bounds the clip to its intended on-timeline duration — verified
    // against a real ffmpeg run (see apps/worker/scripts/smoke-render.ts).
    `trim=end_frame=${frames}`,
    "setpts=PTS-STARTPTS",
    "format=yuv420p",
  ];
}

export interface TimelineToRenderGraphOptions {
  sequence: Sequence;
  resolvedAssets: Map<string, ResolvedAsset>;
}

/**
 * Pure function: Sequence (timeline JSON) -> RenderGraph (plain data). No
 * filesystem or FFmpeg process access here — see ARCHITECTURE.md §14/§30.
 * This is what makes the render pipeline unit-testable without ever
 * invoking FFmpeg.
 *
 * Scope for this pass (stated explicitly, not hidden — see dev rule on
 * honest limitations): only the FIRST video track is composited server-side;
 * per-clip `transformKeyframes` (multi-point animation) are not yet applied
 * in the server render — the clip's static `transform` is used instead. Both
 * are natural Phase 2 extensions once multi-track compositing and keyframe
 * interpolation are needed beyond the manual editor's own preview.
 */
export function timelineToRenderGraph(opts: TimelineToRenderGraphOptions): RenderGraph {
  const { sequence, resolvedAssets } = opts;
  const inputs: RenderInput[] = [];
  const videoNodes: FilterNode[] = [];
  const audioNodes: FilterNode[] = [];
  let inputIndex = 0;

  const primaryTrack = sequence.tracks[0];
  const clips = primaryTrack ? [...primaryTrack.clips].sort((a, b) => a.startTicks - b.startTicks) : [];
  if (clips.length === 0) {
    throw new Error("Cannot render a sequence with no clips on the primary video track");
  }

  let currentVideoLabel: string | null = null;
  let cumulativeDurationSeconds = 0;
  const audioClipLabels: string[] = [];
  // Maps each clip's ORIGINAL timeline position to where it actually lands
  // in the composited output. A transition eats into both adjacent clips'
  // durations (standard NLE behavior — see the xfade offset math below), so
  // every clip after the first transition starts earlier than its raw
  // `startTicks` would suggest. Anything keyed to timeline position — this
  // clip's own embedded audio, and dedicated audio-track clips further down
  // this function — must be placed using the RENDERED time, not the raw
  // one, or audio drifts out of sync with the cut it's supposed to align to.
  const renderedStartSecondsByClipId = new Map<string, number>();

  clips.forEach((clip, i) => {
    const asset = assetFor(resolvedAssets, clip.sourceAssetId);
    const durationSeconds = ticksToSeconds(clip.durationTicks);
    const isImage = asset.kind === "image";
    const sourceRangeSeconds = isImage
      ? durationSeconds
      : (clip.sourceOutTicks - clip.sourceInTicks) / TICKS_PER_SECOND;

    const input: RenderInput = {
      index: inputIndex,
      localPath: asset.localPath,
      isImage,
      seekSeconds: isImage ? 0 : ticksToSeconds(clip.sourceInTicks),
      durationSeconds: sourceRangeSeconds,
    };
    inputs.push(input);
    const myIndex = inputIndex;
    inputIndex += 1;

    const chain: string[] = [];
    if (clip.animation && isImage) {
      chain.push(...kenBurnsFilters(sequence.width, sequence.height, sequence.fps, clip, durationSeconds));
    } else {
      chain.push(...fitToCanvasFilters(sequence.width, sequence.height, sequence.fps));
      chain.push(...staticTransformFilters(sequence.width, sequence.height, clip));
    }
    if (clip.speed !== 1 && !isImage) {
      chain.push(`setpts=PTS/${fmt(clip.speed)}`);
    }
    chain.push(...effectFilters(clip.effects));

    const clipLabel = `vclip${i}`;
    videoNodes.push({ inputs: [`${myIndex}:v`], filter: chain.join(","), output: clipLabel });

    // Determine where this clip actually lands in the composited timeline
    // BEFORE emitting its audio node, so the audio can be placed at the
    // same rendered position as its video (see comment on the map above).
    let renderedStartSeconds = 0;
    let transitionDuration = 0;
    if (i > 0) {
      const prevClip = clips[i - 1]!;
      const isContiguous = clip.startTicks === prevClip.startTicks + prevClip.durationTicks;
      const transition = prevClip.transitionOut;
      if (transition && transition.kind !== "cut" && isContiguous) {
        transitionDuration = Math.min(ticksToSeconds(transition.durationTicks), durationSeconds * 0.9, cumulativeDurationSeconds * 0.9);
        renderedStartSeconds = Math.max(0, cumulativeDurationSeconds - transitionDuration);
      } else {
        renderedStartSeconds = cumulativeDurationSeconds;
      }
    }
    renderedStartSecondsByClipId.set(clip.id, renderedStartSeconds);

    // Per-clip embedded audio — only when speed is unchanged (pitch-correct
    // time-stretching of audio is out of scope for this pass; see
    // ARCHITECTURE.md §1.1 on approximated vs. exact capabilities).
    if (!isImage && asset.hasAudio && clip.speed === 1) {
      const startMs = Math.round(renderedStartSeconds * 1000);
      const audioLabel = `aclip${i}`;
      audioNodes.push({
        inputs: [`${myIndex}:a`],
        filter: `aformat=channel_layouts=stereo,adelay=${startMs}|${startMs}`,
        output: audioLabel,
      });
      audioClipLabels.push(audioLabel);
    }

    if (i === 0) {
      currentVideoLabel = clipLabel;
      cumulativeDurationSeconds = durationSeconds;
      return;
    }

    const outLabel = `vjoin${i}`;
    if (transitionDuration > 0) {
      const prevClip = clips[i - 1]!;
      const transition = prevClip.transitionOut!;
      videoNodes.push({
        inputs: [currentVideoLabel!, clipLabel],
        filter: `xfade=transition=${XFADE_TRANSITION_NAMES[transition.kind as Exclude<TransitionKind, "cut">]}:duration=${fmt(transitionDuration)}:offset=${fmt(renderedStartSeconds)}`,
        output: outLabel,
      });
      cumulativeDurationSeconds = renderedStartSeconds + durationSeconds;
    } else {
      videoNodes.push({ inputs: [currentVideoLabel!, clipLabel], filter: "concat=n=2:v=1:a=0", output: outLabel });
      cumulativeDurationSeconds += durationSeconds;
    }
    currentVideoLabel = outLabel;
  });

  // Dedicated audio tracks (music/voiceover) layered on top of per-clip
  // audio. These are placed at their authored `startTicks` — the RAW
  // timeline position, not the rendered one — because that's what the
  // editor's timeline UI shows the user while they're positioning a music
  // cue against a cut. The client-side preview does not yet simulate
  // transition time-eating either (see PreviewCanvas.tsx), so raw and
  // rendered timelines only diverge once a transition is involved, and only
  // by that transition's duration. Fully closing this gap means teaching
  // the preview to simulate the same compositing the server render does —
  // tracked as a follow-up, not attempted in this pass.
  sequence.audioTracks.forEach((track, trackIdx) => {
    track.clips.forEach((audioClip, clipIdx) => {
      const asset = assetFor(resolvedAssets, audioClip.sourceAssetId);
      const seekSeconds = ticksToSeconds(audioClip.sourceInTicks);
      const durationSeconds = (audioClip.sourceOutTicks - audioClip.sourceInTicks) / TICKS_PER_SECOND;
      const input: RenderInput = { index: inputIndex, localPath: asset.localPath, isImage: false, seekSeconds, durationSeconds };
      inputs.push(input);
      const myIndex = inputIndex;
      inputIndex += 1;

      const startMs = Math.round(ticksToSeconds(audioClip.startTicks) * 1000);
      const filters = [`aformat=channel_layouts=stereo`, `volume=${fmt(audioClip.gainDb)}dB`];
      const clipDurationSeconds = ticksToSeconds(audioClip.durationTicks);
      if (audioClip.fadeInTicks > 0) filters.push(`afade=t=in:st=0:d=${fmt(ticksToSeconds(audioClip.fadeInTicks))}`);
      if (audioClip.fadeOutTicks > 0) {
        const fadeOutStart = Math.max(0, clipDurationSeconds - ticksToSeconds(audioClip.fadeOutTicks));
        filters.push(`afade=t=out:st=${fmt(fadeOutStart)}:d=${fmt(ticksToSeconds(audioClip.fadeOutTicks))}`);
      }
      filters.push(`adelay=${startMs}|${startMs}`);

      const label = `atrack${trackIdx}_${clipIdx}`;
      audioNodes.push({ inputs: [`${myIndex}:a`], filter: filters.join(","), output: label });
      audioClipLabels.push(label);
    });
  });

  // Text overlays — drawtext, chained on top of the composed video stream.
  const allTextLayers: TextLayer[] = sequence.textTracks.flatMap((t) => t.layers);
  allTextLayers.forEach((layer, i) => {
    const startSec = ticksToSeconds(layer.startTicks);
    const endSec = ticksToSeconds(layer.startTicks + layer.durationTicks);
    const escapedText = layer.content.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");
    const xExpr = layer.align === "left" ? "(w*0.08)" : layer.align === "right" ? "(w*0.92-text_w)" : "(w-text_w)/2";
    const yExpr = `(h/2)+(${fmt(layer.y)}*h/2)-text_h/2`;
    const outLabel = `vtext${i}`;
    videoNodes.push({
      inputs: [currentVideoLabel!],
      filter: [
        `drawtext=text='${escapedText}'`,
        `fontsize=${Math.round(layer.fontSize)}`,
        `fontcolor=${layer.color}`,
        `x=${xExpr}`,
        `y=${yExpr}`,
        `enable='between(t,${fmt(startSec)},${fmt(endSec)})'`,
      ].join(":"),
      output: outLabel,
    });
    currentVideoLabel = outLabel;
  });

  let finalAudioLabel: string | null = null;
  if (audioClipLabels.length > 0) {
    finalAudioLabel = "aout";
    audioNodes.push({
      inputs: audioClipLabels,
      filter: `amix=inputs=${audioClipLabels.length}:duration=longest:dropout_transition=0`,
      output: "aout",
    });
  }

  return {
    width: sequence.width,
    height: sequence.height,
    fps: sequence.fps,
    durationSeconds: ticksToSeconds(sequence.durationTicks),
    inputs,
    videoNodes,
    audioNodes,
    finalVideoLabel: currentVideoLabel!,
    finalAudioLabel,
  };
}
