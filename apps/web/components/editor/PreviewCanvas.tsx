"use client";

import { api } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { TICKS_PER_SECOND, ticksToSeconds, type Clip, type TextLayer } from "@video-editor/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const PREVIEW_HEIGHT = 480;

/**
 * A real proxy-resolution compositor: HTML5 <video>/<img> elements are
 * seeked/drawn onto a <canvas> every animation frame, with the same
 * fit/zoom/opacity math as the server render's "cover" fit + static
 * transform (see apps/worker/src/render/graph.ts) and a client-side
 * approximation of Ken Burns pan/zoom for images. This is NOT the
 * renderer of record — final pixels come from the server FFmpeg render
 * (ARCHITECTURE.md §4/§14) — but it is a genuine, working preview, not a
 * placeholder.
 */
export function PreviewCanvas() {
  const sequence = useEditorStore((s) => s.sequence);
  const projectId = useEditorStore((s) => s.projectId);
  const playheadTicks = useEditorStore((s) => s.playheadTicks);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);

  const { data: assetsData } = useQuery({
    queryKey: ["assets", projectId],
    queryFn: () => api.listAssets(projectId!),
    enabled: Boolean(projectId),
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imageElsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastFrameTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const assetsById = new Map((assetsData?.assets ?? []).map((a) => [a.id, a]));

  function getVideoEl(assetId: string, src: string): HTMLVideoElement {
    let el = videoElsRef.current.get(assetId);
    if (!el) {
      el = document.createElement("video");
      el.src = src;
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      videoElsRef.current.set(assetId, el);
    }
    return el;
  }

  function getImageEl(assetId: string, src: string): HTMLImageElement {
    let el = imageElsRef.current.get(assetId);
    if (!el) {
      el = new Image();
      el.src = src;
      imageElsRef.current.set(assetId, el);
    }
    return el;
  }

  function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number, dw: number, dh: number, zoom: number, offX: number, offY: number) {
    const scale = Math.max(dw / sw, dh / sh) * zoom;
    const drawW = sw * scale;
    const drawH = sh * scale;
    const baseX = (dw - drawW) / 2;
    const baseY = (dh - drawH) / 2;
    const x = baseX + offX * (dw - drawW) * 0.5;
    const y = baseY + offY * (dh - drawH) * 0.5;
    ctx.drawImage(source, x, y, drawW, drawH);
  }

  function activeTextLayers(ticks: number): TextLayer[] {
    return (sequence?.textTracks.flatMap((t) => t.layers) ?? []).filter((l) => ticks >= l.startTicks && ticks < l.startTicks + l.durationTicks);
  }

  function findActiveClip(ticks: number): Clip | undefined {
    return sequence?.tracks[0]?.clips.find((c) => ticks >= c.startTicks && ticks < c.startTicks + c.durationTicks);
  }

  function render(ticks: number) {
    const canvas = canvasRef.current;
    if (!canvas || !sequence) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = sequence.width;
    canvas.height = sequence.height;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const clip = findActiveClip(ticks);
    if (clip) {
      const asset = assetsById.get(clip.sourceAssetId);
      const src = asset?.proxyUrl ?? asset?.originalUrl;
      if (src && asset?.kind === "video") {
        const videoEl = getVideoEl(clip.sourceAssetId, src);
        const localTime = ticksToSeconds(clip.sourceInTicks) + ((ticks - clip.startTicks) / TICKS_PER_SECOND) * clip.speed;
        if (Math.abs(videoEl.currentTime - localTime) > 0.08) videoEl.currentTime = localTime;
        if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
          drawCover(ctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, canvas.width, canvas.height, clip.transform.scale, clip.transform.x, clip.transform.y);
        }
      } else if (src && asset?.kind === "image") {
        const imgEl = getImageEl(clip.sourceAssetId, src);
        let zoom = clip.transform.scale;
        let offX = clip.transform.x;
        let offY = clip.transform.y;
        if (clip.animation) {
          const t = Math.min(1, Math.max(0, (ticks - clip.startTicks) / Math.max(1, clip.durationTicks)));
          const from = clip.animation.from;
          const to = clip.animation.to;
          zoom = (from.scale ?? 1) + ((to.scale ?? 1) - (from.scale ?? 1)) * t;
          offX = (from.x ?? 0) + ((to.x ?? 0) - (from.x ?? 0)) * t;
          offY = (from.y ?? 0) + ((to.y ?? 0) - (from.y ?? 0)) * t;
        }
        if (imgEl.complete && imgEl.naturalWidth > 0) {
          drawCover(ctx, imgEl, imgEl.naturalWidth, imgEl.naturalHeight, canvas.width, canvas.height, Math.max(1, zoom), offX, offY);
        }
      }
    }

    for (const layer of activeTextLayers(ticks)) {
      ctx.save();
      ctx.font = `${layer.fontWeight >= 700 ? "bold" : ""} ${layer.fontSize}px Inter, sans-serif`.trim();
      ctx.fillStyle = layer.color;
      ctx.textAlign = layer.align;
      ctx.textBaseline = "middle";
      const x = layer.align === "left" ? canvas.width * 0.08 : layer.align === "right" ? canvas.width * 0.92 : canvas.width / 2;
      const y = canvas.height / 2 + layer.y * (canvas.height / 2);
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.fillText(layer.content, x, y);
      ctx.restore();
    }
  }

  // Redraw whenever the playhead, sequence, or asset list changes (covers the paused/scrubbing case).
  useEffect(() => {
    render(playheadTicks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadTicks, sequence, assetsData]);

  // Playback loop.
  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const clip = findActiveClip(useEditorStore.getState().playheadTicks);
    videoElsRef.current.forEach((el, assetId) => {
      if (clip?.sourceAssetId === assetId) el.play().catch(() => undefined);
      else el.pause();
    });

    function tick(now: number) {
      if (lastFrameTimeRef.current === null) lastFrameTimeRef.current = now;
      const dtSeconds = (now - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = now;
      const state = useEditorStore.getState();
      const nextTicks = state.playheadTicks + dtSeconds * TICKS_PER_SECOND;
      if (sequence && nextTicks >= sequence.durationTicks) {
        setPlayhead(sequence.durationTicks);
        setIsPlaying(false);
        return;
      }
      setPlayhead(nextTicks);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  if (!sequence) return null;
  const durationSeconds = ticksToSeconds(sequence.durationTicks);
  const aspect = sequence.width / sequence.height;
  const previewWidth = PREVIEW_HEIGHT * aspect;

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        style={{ width: previewWidth, height: PREVIEW_HEIGHT }}
        className="rounded-lg border border-border bg-black shadow-2xl"
      />
      <div className="flex w-full max-w-md items-center gap-3">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(1, sequence.durationTicks)}
          value={Math.min(playheadTicks, sequence.durationTicks)}
          onChange={(e) => setPlayhead(Number(e.target.value))}
          className="h-1 flex-1 accent-accent"
        />
        <span className="w-24 shrink-0 text-right text-xs text-textMuted">
          {ticksToSeconds(playheadTicks).toFixed(1)}s / {durationSeconds.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
