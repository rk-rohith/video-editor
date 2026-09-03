"use client";

import { Button } from "@/components/ui/Button";
import { useEditorStore } from "@/store/editor";
import { TICKS_PER_SECOND, secondsToTicks, ticksToSeconds, type AudioClip, type Clip, type TextLayer } from "@video-editor/shared";
import { useCallback, useRef, useState } from "react";

const SNAP_TICKS = TICKS_PER_SECOND / 10; // snap to nearest 100ms while dragging

function snap(ticks: number): number {
  return Math.round(ticks / SNAP_TICKS) * SNAP_TICKS;
}

function ticksToPx(ticks: number, pxPerSecond: number): number {
  return ticksToSeconds(ticks) * pxPerSecond;
}

function pxToTicks(px: number, pxPerSecond: number): number {
  return secondsToTicks(px / pxPerSecond);
}

// ---------------------------------------------------------------------------
// Video clip block — draggable (moveClip) with trim handles (trimClip)
// ---------------------------------------------------------------------------
function VideoClipBlock({ clip, pxPerSecond }: { clip: Clip; pxPerSecond: number }) {
  const applyOps = useEditorStore((s) => s.applyOps);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [trimEdge, setTrimEdge] = useState<"in" | "out" | null>(null);
  const dragState = useRef<{ startX: number; kind: "move" | "trim-in" | "trim-out" } | null>(null);

  const selected = selectedClipId === clip.id;

  const onPointerDown = useCallback(
    (kind: "move" | "trim-in" | "trim-out") => (e: React.PointerEvent) => {
      e.stopPropagation();
      selectClip(clip.id);
      dragState.current = { startX: e.clientX, kind };
      if (kind !== "move") setTrimEdge(kind === "trim-in" ? "in" : "out");

      const onMove = (ev: PointerEvent) => {
        if (!dragState.current) return;
        const deltaPx = ev.clientX - dragState.current.startX;
        setDragOffsetPx(deltaPx);
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!dragState.current) return;
        const deltaPx = ev.clientX - dragState.current.startX;
        const rawDeltaTicks = pxToTicks(deltaPx, pxPerSecond);
        const deltaTicks = snap(rawDeltaTicks);
        setDragOffsetPx(0);
        setTrimEdge(null);
        dragState.current = null;
        if (deltaTicks === 0) return;
        if (kind === "move") {
          void applyOps([{ op: "moveClip", args: { clipId: clip.id, newStartTicks: Math.max(0, clip.startTicks + deltaTicks) } }], "Moved clip");
        } else if (kind === "trim-in") {
          void applyOps([{ op: "trimClip", args: { clipId: clip.id, edge: "in", deltaTicks } }], "Trimmed clip");
        } else {
          void applyOps([{ op: "trimClip", args: { clipId: clip.id, edge: "out", deltaTicks } }], "Trimmed clip");
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [applyOps, clip.id, clip.startTicks, pxPerSecond, selectClip]
  );

  const left = ticksToPx(clip.startTicks, pxPerSecond) + (trimEdge === null ? dragOffsetPx : 0) + (trimEdge === "in" ? dragOffsetPx : 0);
  const width = Math.max(8, ticksToPx(clip.durationTicks, pxPerSecond) - (trimEdge === "in" ? dragOffsetPx : 0) + (trimEdge === "out" ? dragOffsetPx : 0));

  return (
    <div
      onPointerDown={onPointerDown("move")}
      style={{ left, width }}
      className={`group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border-2 ${
        selected ? "border-accent" : "border-transparent"
      } bg-gradient-to-br from-violet-700/70 to-violet-900/70 active:cursor-grabbing`}
    >
      <div className="pointer-events-none truncate px-2 py-1 text-[11px] font-medium text-white/90">
        {ticksToSeconds(clip.durationTicks).toFixed(1)}s
        {clip.transitionOut && clip.transitionOut.kind !== "cut" ? ` → ${clip.transitionOut.kind}` : ""}
      </div>
      <div
        onPointerDown={onPointerDown("trim-in")}
        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-white/0 hover:bg-white/20"
      />
      <div
        onPointerDown={onPointerDown("trim-out")}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/0 hover:bg-white/20"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text layer block — draggable + right-edge resize (both via updateText)
// ---------------------------------------------------------------------------
function TextLayerBlock({ layer, pxPerSecond }: { layer: TextLayer; pxPerSecond: number }) {
  const applyOps = useEditorStore((s) => s.applyOps);
  const selectedTextLayerId = useEditorStore((s) => s.selectedTextLayerId);
  const selectText = useEditorStore((s) => s.selectText);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [resizing, setResizing] = useState(false);
  const dragState = useRef<{ startX: number; kind: "move" | "resize" } | null>(null);

  const selected = selectedTextLayerId === layer.id;

  const onPointerDown = useCallback(
    (kind: "move" | "resize") => (e: React.PointerEvent) => {
      e.stopPropagation();
      selectText(layer.id);
      dragState.current = { startX: e.clientX, kind };
      if (kind === "resize") setResizing(true);

      const onMove = (ev: PointerEvent) => setDragOffsetPx(ev.clientX - dragState.current!.startX);
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const deltaTicks = snap(pxToTicks(ev.clientX - dragState.current!.startX, pxPerSecond));
        setDragOffsetPx(0);
        setResizing(false);
        dragState.current = null;
        if (deltaTicks === 0) return;
        if (kind === "move") {
          void applyOps([{ op: "updateText", args: { layerId: layer.id, patch: { startTicks: Math.max(0, layer.startTicks + deltaTicks) } } }], "Moved text");
        } else {
          void applyOps(
            [{ op: "updateText", args: { layerId: layer.id, patch: { durationTicks: Math.max(60, layer.durationTicks + deltaTicks) } } }],
            "Resized text"
          );
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [applyOps, layer.durationTicks, layer.id, layer.startTicks, pxPerSecond, selectText]
  );

  const left = ticksToPx(layer.startTicks, pxPerSecond) + (!resizing ? dragOffsetPx : 0);
  const width = Math.max(8, ticksToPx(layer.durationTicks, pxPerSecond) + (resizing ? dragOffsetPx : 0));

  return (
    <div
      onPointerDown={onPointerDown("move")}
      style={{ left, width }}
      className={`group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border-2 ${
        selected ? "border-accent" : "border-transparent"
      } bg-gradient-to-br from-amber-600/70 to-amber-800/70 active:cursor-grabbing`}
    >
      <div className="pointer-events-none truncate px-2 py-1 text-[11px] font-medium text-white/90">{layer.content}</div>
      <div onPointerDown={onPointerDown("resize")} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/0 hover:bg-white/20" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio clip block — selectable + removable. Repositioning after insertion
// is a scoped-out follow-up: no moveAudioClip operation exists yet in the
// closed operation set (see ARCHITECTURE.md §29) and we won't fake one.
// ---------------------------------------------------------------------------
function AudioClipBlock({ clip, pxPerSecond }: { clip: AudioClip; pxPerSecond: number }) {
  const selectedAudioClipId = useEditorStore((s) => s.selectedAudioClipId);
  const selectAudioClip = useEditorStore((s) => s.selectAudioClip);
  const selected = selectedAudioClipId === clip.id;

  return (
    <div
      onClick={() => selectAudioClip(clip.id)}
      style={{ left: ticksToPx(clip.startTicks, pxPerSecond), width: Math.max(8, ticksToPx(clip.durationTicks, pxPerSecond)) }}
      className={`absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded-md border-2 ${
        selected ? "border-accent" : "border-transparent"
      } bg-gradient-to-br from-emerald-700/70 to-emerald-900/70`}
    >
      <div className="pointer-events-none truncate px-2 py-1 text-[11px] font-medium text-white/90">{clip.gainDb.toFixed(0)}dB</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline shell: ruler, tracks, toolbar
// ---------------------------------------------------------------------------
export function Timeline() {
  const sequence = useEditorStore((s) => s.sequence);
  const playheadTicks = useEditorStore((s) => s.playheadTicks);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const pxPerSecond = useEditorStore((s) => s.pxPerSecond);
  const setPxPerSecond = useEditorStore((s) => s.setPxPerSecond);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const applyOps = useEditorStore((s) => s.applyOps);
  const rulerRef = useRef<HTMLDivElement>(null);

  if (!sequence) return null;

  const totalSeconds = Math.max(20, ticksToSeconds(sequence.durationTicks) + 5);
  const timelineWidth = totalSeconds * pxPerSecond;

  function seekFromClientX(clientX: number) {
    const el = rulerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left + el.scrollLeft;
    setPlayhead(Math.max(0, pxToTicks(px, pxPerSecond)));
  }

  function splitAtPlayhead() {
    if (!selectedClipId || !sequence) return;
    const clip = sequence.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId);
    if (!clip) return;
    if (playheadTicks <= clip.startTicks || playheadTicks >= clip.startTicks + clip.durationTicks) return;
    void applyOps([{ op: "splitClip", args: { clipId: clip.id, atTicks: playheadTicks, newClipId: crypto.randomUUID() } }], "Split clip");
  }

  function deleteSelected() {
    if (selectedClipId) void applyOps([{ op: "removeClip", args: { clipId: selectedClipId } }], "Deleted clip");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={splitAtPlayhead} disabled={!selectedClipId}>
          Split at playhead
        </Button>
        <Button variant="secondary" className="px-2 py-1 text-xs text-red-400" onClick={deleteSelected} disabled={!selectedClipId}>
          Delete
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-textMuted">
          <span>{ticksToSeconds(playheadTicks).toFixed(2)}s</span>
          <button onClick={() => setPxPerSecond(pxPerSecond - 20)} className="rounded bg-panelAlt px-2 py-0.5 hover:text-textPrimary">
            −
          </button>
          <button onClick={() => setPxPerSecond(pxPerSecond + 20)} className="rounded bg-panelAlt px-2 py-0.5 hover:text-textPrimary">
            +
          </button>
        </div>
      </div>

      <div className="timeline-scroll min-h-0 flex-1 overflow-auto">
        <div style={{ width: timelineWidth }} className="relative">
          {/* Ruler */}
          <div
            ref={rulerRef}
            onClick={(e) => seekFromClientX(e.clientX)}
            className="sticky top-0 z-10 h-6 cursor-pointer border-b border-border bg-panel"
          >
            {Array.from({ length: Math.ceil(totalSeconds) }).map((_, sec) => (
              <div key={sec} style={{ left: sec * pxPerSecond }} className="absolute top-0 h-full border-l border-border/60 pl-1 text-[10px] text-textMuted">
                {sec % 5 === 0 ? `${sec}s` : ""}
              </div>
            ))}
          </div>

          {/* Playhead */}
          <div
            style={{ left: ticksToPx(playheadTicks, pxPerSecond) }}
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent"
          />

          {/* Video track */}
          <div className="relative h-14 border-b border-border/60 bg-black/10">
            {sequence.tracks[0]?.clips.map((clip) => (
              <VideoClipBlock key={clip.id} clip={clip} pxPerSecond={pxPerSecond} />
            ))}
          </div>
          {/* Text track */}
          <div className="relative h-10 border-b border-border/60 bg-black/10">
            {sequence.textTracks[0]?.layers.map((layer) => (
              <TextLayerBlock key={layer.id} layer={layer} pxPerSecond={pxPerSecond} />
            ))}
          </div>
          {/* Audio track */}
          <div className="relative h-10 border-b border-border/60 bg-black/10">
            {sequence.audioTracks[0]?.clips.map((clip) => (
              <AudioClipBlock key={clip.id} clip={clip} pxPerSecond={pxPerSecond} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
